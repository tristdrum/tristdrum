import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  parseAirbnbBookingLifecycleEmail,
  parseAirbnbConversationEmail,
  parseAirbnbInitialInquiryEmail,
} from "@tristdrum/airbnb-core";
import {
  createAirbnbDatabase,
  recordJobFinish,
  recordJobStart,
  sanitizedError,
} from "@tristdrum/airbnb-db";
import { decideGuestResponse } from "./agent.mjs";
import { processDeliveryGuard } from "./delivery.mjs";
import {
  collectBookingLifecycleMessages,
  collectConversationMessages,
} from "./gmail.mjs";
import { notifySupportManagement } from "./management.mjs";
import {
  captureGuestTimeRequest,
  processTimeRequestReadiness,
  withdrawGuestTimeRequest,
} from "./operations.mjs";
import {
  ingestConversation,
  ingestSupplementalConversation,
  latestConversationEvidenceAt,
  latestSupportRun,
  loadDeliveryGuardCandidates,
  loadShadowCandidates,
  reconcileBookingLifecycle,
  reconcileGuestTimeRequestNotifications,
  storeSupportDraft,
} from "./repository.mjs";
import { assertSupportModeAllowed } from "./runtime.mjs";

function localDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function earlierOfRecentCursor(now, cursor, initialLookbackDays) {
  const initial = new Date(now.getTime() - initialLookbackDays * 86_400_000);
  if (!cursor) return initial;
  const overlap = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  return overlap > initial ? overlap : initial;
}

function optionalInstant(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw Object.assign(new Error("AIRBNB_SUPPORT_AUTOMATION_NOT_BEFORE is invalid."), {
      code: "INVALID_AUTOMATION_CUTOFF",
    });
  }
  return parsed.toISOString();
}

function fallbackDecision(error) {
  return {
    topic: "unknown",
    riskTier: "unknown",
    replyNeeded: true,
    summary: "The support decision failed; human review is required.",
    draft: null,
    autoReply: false,
    status: "needs_human",
    alertManagement: true,
    decisionSource: "decision_error",
    model: null,
    error: sanitizedError(error),
  };
}

export function canReuseStoredDecision(decision, mode, candidate = null) {
  return Boolean(
    decision?.decisionVersion === 2
    && decision?.decisionSource === "adaptive_agent"
    && !(mode === "live" && decision?.shadowMode === true)
    && !(
      decision?.deterministicGuard === "initial_inquiry_requires_airbnb_ui"
      && candidate?.replyCapable === true
    )
  );
}

export function applyReplyRouteGuard(decision, candidate) {
  if (candidate?.replyRequired !== true || candidate?.replyCapable === true) return decision;
  return {
    ...decision,
    replyNeeded: true,
    autoReply: false,
    status: "needs_human",
    alertManagement: true,
    riskTier: "high",
    deterministicGuard: "initial_inquiry_requires_airbnb_ui",
  };
}

export function summarizeDeliveryOutcomes(deliveries) {
  return {
    deliveredReplyCount: deliveries.filter((delivery) => delivery.action === "sent").length,
    reconciledReplyCount: deliveries.filter((delivery) => delivery.action === "mark_sent").length,
    deliveryAmbiguousCount: deliveries.filter((delivery) => delivery.action === "ambiguous").length,
    deliveryGuardErrorCount: deliveries.filter((delivery) => delivery.action === "guard_error").length,
  };
}

export async function runSupport({
  mode = "shadow",
  now = () => new Date(),
  collectMessages = collectConversationMessages,
  collectLifecycleMessages = collectBookingLifecycleMessages,
  decide = decideGuestResponse,
  processDelivery = processDeliveryGuard,
  notifyManagement = notifySupportManagement,
  captureTimeRequest = captureGuestTimeRequest,
  withdrawTimeRequest = withdrawGuestTimeRequest,
  processReadiness = processTimeRequestReadiness,
  reconcileLifecycle = reconcileBookingLifecycle,
  database = null,
  env = process.env,
} = {}) {
  const capabilities = assertSupportModeAllowed(mode, env);
  const runId = randomUUID();
  const startedAt = now();
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  const householdId = await ownDatabase.householdId();
  let started = false;
  try {
    await recordJobStart(ownDatabase.sql, {
      householdId,
      service: "support",
      jobName: mode === "live" ? "live-poll" : "shadow-poll",
      runId,
      targetDate: localDate(startedAt),
      startedAt,
    });
    started = true;
    const janeUserConfigured = Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_USER ?? "").trim());
    const janePasswordConfigured = Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD ?? "").trim());
    const janeConfigured = janeUserConfigured && janePasswordConfigured;
    const [cursor, janeCursor] = await Promise.all([
      latestConversationEvidenceAt(ownDatabase.sql, householdId, "tristan"),
      janeConfigured
        ? latestConversationEvidenceAt(ownDatabase.sql, householdId, "jane")
        : Promise.resolve(null),
    ]);
    const since = earlierOfRecentCursor(
      startedAt,
      cursor,
      Number.parseInt(env.AIRBNB_SUPPORT_INITIAL_LOOKBACK_DAYS ?? "90", 10),
    );
    const canonicalCollection = collectMessages({
      since,
      maxRead: Number.parseInt(env.AIRBNB_SUPPORT_MAX_EMAILS ?? "500", 10),
      mailboxScope: "tristan",
      env,
    });
    const janeSince = janeConfigured
      ? earlierOfRecentCursor(
        startedAt,
        janeCursor,
        Number.parseInt(env.AIRBNB_SUPPORT_INITIAL_LOOKBACK_DAYS ?? "90", 10),
      )
      : null;
    const supplementalCollection = janeConfigured
      ? collectMessages({
        since: janeSince,
        maxRead: Number.parseInt(env.AIRBNB_SUPPORT_JANE_MAX_EMAILS ?? env.AIRBNB_SUPPORT_MAX_EMAILS ?? "500", 10),
        mailboxScope: "jane",
        env,
      })
      : Promise.resolve({ messages: [], envelopesFound: 0 });
    const lifecycleCollection = collectLifecycleMessages({
      since,
      maxRead: Number.parseInt(env.AIRBNB_SUPPORT_LIFECYCLE_MAX_EMAILS ?? "100", 10),
      env,
    });
    const [canonicalResult, supplementalResult, lifecycleResult] = await Promise.allSettled([
      canonicalCollection,
      supplementalCollection,
      lifecycleCollection,
    ]);
    if (canonicalResult.status === "rejected") throw canonicalResult.reason;
    if (lifecycleResult.status === "rejected") throw lifecycleResult.reason;
    const collected = canonicalResult.value;
    const ingested = [];
    for (const email of collected.messages) {
      const parsed = parseAirbnbConversationEmail(email) ?? parseAirbnbInitialInquiryEmail(email);
      if (!parsed) continue;
      ingested.push(await ingestConversation(ownDatabase.sql, { householdId, email, parsed }));
    }

    let supplemental = { messages: [], envelopesFound: 0 };
    const supplementalIngested = [];
    let supplementalError = null;
    if (janeConfigured) {
      if (supplementalResult.status === "fulfilled") {
        supplemental = supplementalResult.value;
        for (const email of supplemental.messages) {
          const parsed = parseAirbnbConversationEmail(email);
          if (!parsed) continue;
          supplementalIngested.push(await ingestSupplementalConversation(
            ownDatabase.sql,
            { householdId, email, parsed },
          ));
        }
      } else {
        supplementalError = sanitizedError(supplementalResult.reason);
      }
    } else if (janeUserConfigured || janePasswordConfigured) {
      supplementalError = sanitizedError(new Error("Jane's supplemental Gmail credentials are incomplete."));
    }
    const janeMailboxAvailable = janeConfigured && supplementalResult.status === "fulfilled";
    const lifecycleCollected = lifecycleResult.value;
    const lifecycleOutcomes = [];
    for (const email of lifecycleCollected.messages) {
      const lifecycle = parseAirbnbBookingLifecycleEmail(email);
      if (!lifecycle) continue;
      lifecycleOutcomes.push(await reconcileLifecycle(ownDatabase.sql, {
        householdId,
        email,
        lifecycle,
      }));
    }

    const candidates = await loadShadowCandidates(ownDatabase.sql, {
      householdId,
      limit: Number.parseInt(env.AIRBNB_SUPPORT_CANDIDATE_LIMIT ?? "8", 10),
      notBefore: optionalInstant(env.AIRBNB_SUPPORT_AUTOMATION_NOT_BEFORE),
    });
    const drafts = [];
    const timeRequests = [];
    let decisionFailureCount = 0;
    const decideAndStore = async (candidate) => {
      let decision;
      const existingDecision = canReuseStoredDecision(candidate.existingDecision, mode, candidate)
        ? candidate.existingDecision
        : null;
      if (existingDecision) {
        decision = existingDecision;
      } else try {
        decision = await decide({
          guestMessage: candidate.guestMessage,
          guestName: candidate.guestDisplayName,
          listingName: candidate.listingName,
          facts: candidate.facts,
          stayLabel: candidate.stayLabel,
          latestEventAt: candidate.latestEventAt,
          activeTimeRequest: candidate.activeTimeRequest,
          conversationContext: candidate.conversationContext,
          now: startedAt,
          env,
        });
      } catch (error) {
        decisionFailureCount += 1;
        decision = fallbackDecision(error);
      }
      decision = applyReplyRouteGuard(decision, candidate);
      let timeRequestOutcome = null;
      const operationalRequest = decision.operationalRequest;
      if (
        mode === "live"
        && capabilities.timeRequestsEnabled
        && !existingDecision
        && decision.autoReply === true
        && (
          operationalRequest?.createsOperationalRequest === true
          || operationalRequest?.cancelsOperationalRequest === true
        )
      ) {
        try {
          timeRequestOutcome = operationalRequest.createsOperationalRequest
            ? await captureTimeRequest({
              sql: ownDatabase.sql,
              householdId,
              candidate,
              decision: operationalRequest,
              now: startedAt,
              env,
            })
            : await withdrawTimeRequest({
              sql: ownDatabase.sql,
              householdId,
              candidate,
              decision: operationalRequest,
              now: startedAt,
              env,
            });
          timeRequests.push(timeRequestOutcome);
          if (!["notified", "already_notified", "cancelled", "no_change"].includes(timeRequestOutcome.status)) {
            decision = {
              ...decision,
              autoReply: false,
              status: "needs_human",
              alertManagement: true,
              riskTier: "high",
              deterministicGuard: "time_request_not_operationally_safe",
            };
          }
        } catch (error) {
          throw Object.assign(new Error("The cleaner timing update did not complete and will be retried."), {
            code: "TIME_REQUEST_OPERATION_FAILED",
            cause: error,
          });
        }
      }
      const timePolicyAllowed = !operationalRequest
        || capabilities.timeRequestsEnabled === true;
      return storeSupportDraft(ownDatabase.sql, {
        householdId,
        candidate,
        // The database column keeps its legacy name while the runtime stores an adaptive decision.
        classification: decision,
        now: startedAt,
        shadowMode: mode === "shadow",
        automaticallyApprove: mode === "live"
          && capabilities.autonomousRepliesEnabled
          && janeMailboxAvailable
          && !existingDecision
          && timePolicyAllowed
          && decision.autoReply === true,
      });
    };
    const concurrency = Math.max(1, Math.min(4, Number.parseInt(
      env.AIRBNB_SUPPORT_DECISION_CONCURRENCY ?? "4",
      10,
    )));
    for (let index = 0; index < candidates.length; index += concurrency) {
      const settled = await Promise.allSettled(candidates.slice(index, index + concurrency).map(decideAndStore));
      drafts.push(...settled.filter((item) => item.status === "fulfilled").map((item) => item.value));
      const failure = settled.find((item) => item.status === "rejected");
      if (failure) throw failure.reason;
    }

    let readiness = { promptedCount: 0, readyCount: 0, repliesQueuedCount: 0 };
    if (mode === "live" && capabilities.timeRequestsEnabled) {
      readiness = await processReadiness({
        sql: ownDatabase.sql,
        householdId,
        now: startedAt,
        env,
      });
    }

    const deliveries = [];
    if (mode === "live" && capabilities.replyDeliveryEnabled) {
      const deliveryCandidates = await loadDeliveryGuardCandidates(ownDatabase.sql, {
        householdId,
        now: startedAt,
        limit: Number.parseInt(env.AIRBNB_SUPPORT_DELIVERY_LIMIT ?? "1", 10),
      });
      for (const delivery of deliveryCandidates) {
        deliveries.push(await processDelivery({
          sql: ownDatabase.sql,
          householdId,
          deliveryId: delivery.id,
          now,
          env,
        }));
      }
      await reconcileGuestTimeRequestNotifications(ownDatabase.sql, {
        householdId,
        now: now(),
      });
    }
    const managementNotifications = mode === "live" && capabilities.managementAlertsEnabled
      ? await notifyManagement({
        sql: ownDatabase.sql,
        householdId,
        now,
        env,
      })
      : [];

    const deliveryOutcomeCounts = summarizeDeliveryOutcomes(deliveries);
    const receipt = {
      schemaVersion: 1,
      runId,
      status: "success",
      mode,
      startedAt: startedAt.toISOString(),
      completedAt: now().toISOString(),
      cursorAt: cursor?.toISOString() ?? null,
      searchSince: since.toISOString(),
      emailsFound: collected.envelopesFound + supplemental.envelopesFound,
      canonicalEmailsFound: collected.envelopesFound,
      supplementalEmailsFound: supplemental.envelopesFound,
      conversationsIngested: ingested.length,
      supplementalConversationsIngested: supplementalIngested.length,
      lifecycleEmailsFound: lifecycleCollected.envelopesFound,
      lifecycleResolvedCount: lifecycleOutcomes.filter((item) => item.status === "resolved").length,
      lifecycleNotFoundCount: lifecycleOutcomes.filter((item) => item.status === "not_found").length,
      lifecycleAmbiguousCount: lifecycleOutcomes.filter((item) => item.status === "ambiguous").length,
      supplementalMailboxStatus: supplementalError
        ? { status: "error", error: supplementalError }
        : janeUserConfigured && janePasswordConfigured
          ? { status: "enabled" }
          : { status: "disabled" },
      handledByHumanCount: ingested.filter((item) => item.latestDirection === "host").length,
      candidateCount: candidates.length,
      draftCount: drafts.length,
      decisionFailureCount,
      classificationFailureCount: decisionFailureCount,
      reminderCount: drafts.filter((draft) => draft.alertStages.includes("reminder")).length,
      overdueCount: drafts.filter((draft) => draft.alertStages.includes("overdue")).length,
      deliveryCandidateCount: deliveries.length,
      ...deliveryOutcomeCounts,
      managementNotificationCount: managementNotifications.length,
      managementNotificationVerifiedCount: managementNotifications.filter((item) => item.verified).length,
      timeRequestCount: timeRequests.length,
      timeRequestNotifiedCount: timeRequests.filter((item) => ["notified", "already_notified"].includes(item.status)).length,
      timeRequestCancelledCount: timeRequests.filter((item) => item.status === "cancelled").length,
      readinessPromptCount: readiness.promptedCount,
      cleanerReadyCount: readiness.readyCount,
      readinessReplyQueuedCount: readiness.repliesQueuedCount,
      externalWritesEnabled: mode === "live" && capabilities.externalWritesEnabled,
      replyDeliveryEnabled: mode === "live" && capabilities.replyDeliveryEnabled,
      autonomousRepliesEnabled: mode === "live"
        && capabilities.autonomousRepliesEnabled
        && janeMailboxAvailable,
      managementAlertsEnabled: mode === "live" && capabilities.managementAlertsEnabled,
      timeRequestsEnabled: mode === "live" && capabilities.timeRequestsEnabled,
    };
    await recordJobFinish(ownDatabase.sql, {
      service: "support",
      runId,
      status: "success",
      receipt,
      completedAt: receipt.completedAt,
    });
    return receipt;
  } catch (error) {
    const failure = sanitizedError(error);
    if (started) {
      await recordJobFinish(ownDatabase.sql, {
        service: "support",
        runId,
        status: "error",
        receipt: { schemaVersion: 1, runId, status: "error", error: failure },
        errorCode: failure.code,
        errorMessage: failure.message,
        completedAt: now().toISOString(),
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (!database) await ownDatabase.close();
  }
}

export function runSupportShadow(options = {}) {
  return runSupport({ ...options, mode: "shadow" });
}

export async function loadSupportStatus({ database = null, env = process.env } = {}) {
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  try {
    return await latestSupportRun(ownDatabase.sql, await ownDatabase.householdId());
  } finally {
    if (!database) await ownDatabase.close();
  }
}

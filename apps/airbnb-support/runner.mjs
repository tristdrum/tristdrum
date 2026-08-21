import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { parseAirbnbConversationEmail } from "@tristdrum/airbnb-core";
import {
  createAirbnbDatabase,
  recordJobFinish,
  recordJobStart,
  sanitizedError,
} from "@tristdrum/airbnb-db";
import { classifyGuestMessage } from "./classifier.mjs";
import { collectConversationMessages } from "./gmail.mjs";
import {
  ingestConversation,
  latestConversationEvidenceAt,
  latestSupportRun,
  loadShadowCandidates,
  storeShadowDraft,
} from "./repository.mjs";

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

function fallbackClassification(error) {
  return {
    topic: "unknown",
    riskTier: "unknown",
    confidence: 0,
    factsVerified: false,
    replyNeeded: true,
    summary: "Classification failed; human review is required.",
    draft: null,
    autoReply: false,
    status: "needs_human",
    alertManagement: true,
    model: null,
    error: sanitizedError(error),
  };
}

export async function runSupportShadow({
  now = () => new Date(),
  collectMessages = collectConversationMessages,
  classify = classifyGuestMessage,
  database = null,
  env = process.env,
} = {}) {
  const runId = randomUUID();
  const startedAt = now();
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  const householdId = await ownDatabase.householdId();
  let started = false;
  try {
    await recordJobStart(ownDatabase.sql, {
      householdId,
      service: "support",
      jobName: "shadow-poll",
      runId,
      targetDate: localDate(startedAt),
      startedAt,
    });
    started = true;
    const cursor = await latestConversationEvidenceAt(ownDatabase.sql, householdId);
    const since = earlierOfRecentCursor(
      startedAt,
      cursor,
      Number.parseInt(env.AIRBNB_SUPPORT_INITIAL_LOOKBACK_DAYS ?? "90", 10),
    );
    const collected = await collectMessages({
      since,
      maxRead: Number.parseInt(env.AIRBNB_SUPPORT_MAX_EMAILS ?? "500", 10),
      env,
    });
    const ingested = [];
    for (const email of collected.messages) {
      const parsed = parseAirbnbConversationEmail(email);
      if (!parsed) continue;
      ingested.push(await ingestConversation(ownDatabase.sql, { householdId, email, parsed }));
    }

    const candidateSince = new Date(startedAt.getTime() - 24 * 60 * 60 * 1000);
    const candidates = await loadShadowCandidates(ownDatabase.sql, {
      householdId,
      since: candidateSince,
      limit: Number.parseInt(env.AIRBNB_SUPPORT_CANDIDATE_LIMIT ?? "8", 10),
    });
    const drafts = [];
    let classificationFailureCount = 0;
    const classifyAndStore = async (candidate) => {
      let classification;
      if (candidate.existingClassification) {
        classification = candidate.existingClassification;
      } else try {
        classification = await classify({
          guestMessage: candidate.guestMessage,
          listingName: candidate.listingName,
          facts: candidate.facts,
          env,
        });
      } catch (error) {
        classificationFailureCount += 1;
        classification = fallbackClassification(error);
      }
      return storeShadowDraft(ownDatabase.sql, {
        householdId,
        candidate,
        classification,
        now: startedAt,
      });
    };
    const concurrency = Math.max(1, Math.min(4, Number.parseInt(env.AIRBNB_SUPPORT_CLASSIFICATION_CONCURRENCY ?? "4", 10)));
    for (let index = 0; index < candidates.length; index += concurrency) {
      drafts.push(...await Promise.all(candidates.slice(index, index + concurrency).map(classifyAndStore)));
    }

    const receipt = {
      schemaVersion: 1,
      runId,
      status: "success",
      mode: "shadow",
      startedAt: startedAt.toISOString(),
      completedAt: now().toISOString(),
      cursorAt: cursor?.toISOString() ?? null,
      searchSince: since.toISOString(),
      emailsFound: collected.envelopesFound,
      conversationsIngested: ingested.length,
      handledByHumanCount: ingested.filter((item) => item.latestDirection === "host").length,
      candidateCount: candidates.length,
      draftCount: drafts.length,
      classificationFailureCount,
      overdueCount: drafts.filter((draft) => draft.minutesOpen >= 60).length,
      externalWritesEnabled: false,
      autonomousRepliesEnabled: false,
      managementAlertsEnabled: false,
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

export async function loadSupportStatus({ database = null, env = process.env } = {}) {
  const ownDatabase = database ?? createAirbnbDatabase({ env, postgresFactory: postgres });
  try {
    return await latestSupportRun(ownDatabase.sql, await ownDatabase.householdId());
  } finally {
    if (!database) await ownDatabase.close();
  }
}

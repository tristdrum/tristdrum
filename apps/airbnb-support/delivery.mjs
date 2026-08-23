import {
  finalSendDecision,
  parseAirbnbConversationEmail,
  withAutomatedReplyFooter,
} from "@tristdrum/airbnb-core";
import {
  collectConversationMessages,
  findSentThreadEvidence,
  sendThreadedReply,
} from "./gmail.mjs";
import {
  applyDeliveryGuardDecision,
  claimDeliveryForGuard,
  markDeliverySent,
  recordAmbiguousDeliveryFailure,
  recordDeliveryGuardFailure,
  recordDeliveryAttempt,
} from "./repository.mjs";

function eventTime(occurredAt, sequence) {
  const value = new Date(occurredAt);
  value.setMilliseconds(value.getMilliseconds() + sequence);
  return value.toISOString();
}

export function latestCanonicalConversation(messages, providerThreadId) {
  return messages
    .map((email) => ({ email, parsed: parseAirbnbConversationEmail(email) }))
    .filter((item) => item.parsed?.providerThreadId === providerThreadId)
    .sort((left, right) => Date.parse(left.email.occurredAt) - Date.parse(right.email.occurredAt))
    .at(-1) ?? null;
}

export function eventsAddedAfterDraft(parsed, occurredAt, sourceEvents = []) {
  const remaining = new Map();
  for (const event of sourceEvents) {
    const key = `${event.direction}:${event.contentHash}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return parsed.entries.flatMap((entry) => {
    const key = `${entry.direction}:${entry.contentHash}`;
    const knownCount = remaining.get(key) ?? 0;
    if (knownCount > 0) {
      remaining.set(key, knownCount - 1);
      return [];
    }
    return [{
      direction: entry.direction,
      occurredAt: eventTime(occurredAt, entry.sequence),
    }];
  });
}

function janeMailboxConfigured(env) {
  return Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_USER ?? "").trim())
    && Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD ?? "").trim());
}

async function collectFreshDeliverySnapshot({
  claimed,
  env,
  collectMessages,
  reconcileSent,
}) {
  const since = new Date(Date.parse(claimed.sourceLastEventAt) - 2 * 86_400_000);
  const [tristanCollection, janeCollection] = await Promise.all([
    collectMessages({
      since,
      maxRead: Number.parseInt(env.AIRBNB_SUPPORT_MAX_EMAILS ?? "500", 10),
      mailboxScope: "tristan",
      env,
    }),
    collectMessages({
      since,
      maxRead: Number.parseInt(env.AIRBNB_SUPPORT_JANE_MAX_EMAILS ?? env.AIRBNB_SUPPORT_MAX_EMAILS ?? "500", 10),
      mailboxScope: "jane",
      env,
    }),
  ]);
  const canonical = latestCanonicalConversation(
    tristanCollection.messages,
    claimed.providerThreadId,
  );
  if (!canonical) {
    return {
      canonical: null,
      decision: { action: "cancel_and_reevaluate", reason: "canonical_thread_missing" },
    };
  }
  if (!canonical.email.rfcMessageId) {
    throw new Error("Canonical Airbnb message has no RFC Message-ID.");
  }

  const latestEvents = eventsAddedAfterDraft(
    canonical.parsed,
    canonical.email.occurredAt,
    claimed.sourceEvents,
  );
  const supplemental = latestCanonicalConversation(
    janeCollection.messages,
    claimed.providerThreadId,
  );
  if (supplemental) {
    latestEvents.push(...eventsAddedAfterDraft(
      supplemental.parsed,
      supplemental.email.occurredAt,
      claimed.sourceEvents,
    ));
  }
  const sentRequest = {
    since: new Date(claimed.sourceLastEventAt),
    referenceIds: [
      canonical.email.rfcMessageId,
      canonical.email.inReplyTo,
      ...(canonical.email.references ?? []),
    ],
    env,
  };
  const sentEvidence = await Promise.all([
    reconcileSent({ ...sentRequest, mailboxScope: "tristan", messageIds: [claimed.outboundMessageId] }),
    reconcileSent({ ...sentRequest, mailboxScope: "jane", messageIds: [] }),
  ]);
  const sentMessageIds = sentEvidence.flatMap((evidence) => (
    Array.isArray(evidence) ? evidence : evidence?.messageIds ?? []
  ));
  const latestHumanReplyAt = sentEvidence
    .flatMap((evidence) => (!Array.isArray(evidence) && evidence?.humanReplyAt ? [evidence.humanReplyAt] : []))
    .sort((left, right) => Date.parse(left) - Date.parse(right))
    .at(-1);
  if (latestHumanReplyAt) {
    latestEvents.push({ direction: "host", occurredAt: latestHumanReplyAt });
  }
  return {
    canonical,
    decision: finalSendDecision({
      sourceFingerprint: claimed.sourceFingerprint,
      latestFingerprint: canonical.parsed.sourceFingerprint,
      sourceLastEventAt: claimed.sourceLastEventAt,
      latestEvents,
      outboundMessageId: claimed.outboundMessageId,
      sentMessageIds,
    }),
  };
}

export async function processDeliveryGuard({
  sql,
  householdId,
  deliveryId,
  now = () => new Date(),
  env = process.env,
  collectMessages = collectConversationMessages,
  reconcileSent = findSentThreadEvidence,
  sendReply = sendThreadedReply,
  claimDelivery = claimDeliveryForGuard,
  applyDecision = applyDeliveryGuardDecision,
  recordAttempt = recordDeliveryAttempt,
  markSent = markDeliverySent,
  recordAmbiguous = recordAmbiguousDeliveryFailure,
  recordGuardFailure = recordDeliveryGuardFailure,
}) {
  if (!janeMailboxConfigured(env)) {
    return { action: "guard_disabled", reason: "jane_mailbox_unavailable" };
  }

  const claimed = await claimDelivery(sql, { householdId, deliveryId, now: now() });
  if (!claimed || claimed.action !== "claimed") return claimed ?? { action: "not_claimed" };

  let attemptRecorded = false;
  let smtpStarted = false;
  try {
    const finalText = withAutomatedReplyFooter(claimed.finalText ?? claimed.draftText);
    const attempt = await recordAttempt(sql, {
      householdId,
      deliveryId,
      now: now(),
    });
    if (!attempt) return { action: "not_claimed" };
    attemptRecorded = true;

    // Inbox evidence is refreshed first, then Sent mail is the final I/O before SMTP.
    const snapshot = await collectFreshDeliverySnapshot({
      claimed,
      env,
      collectMessages,
      reconcileSent,
    });
    if (snapshot.decision.action !== "send") {
      await applyDecision(sql, {
        householdId,
        deliveryId,
        decision: snapshot.decision,
        now: now(),
      });
      return snapshot.decision;
    }

    smtpStarted = true;
    const sent = await sendReply({
      to: snapshot.canonical.email.replyTo,
      subject: snapshot.canonical.email.subject,
      text: finalText,
      messageId: claimed.outboundMessageId,
      inReplyTo: snapshot.canonical.email.rfcMessageId,
      references: snapshot.canonical.email.references,
      env,
    });
    await markSent(sql, {
      householdId,
      deliveryId,
      providerMessageId: sent.messageId,
      now: now(),
    });
    return { action: "sent", messageIdMatched: sent.messageId === claimed.outboundMessageId };
  } catch (error) {
    if (smtpStarted) {
      await recordAmbiguous(sql, {
        householdId,
        deliveryId,
        error,
        now: now(),
      });
      return { action: "ambiguous", manualReconciliationRequired: true };
    }
    await recordGuardFailure(sql, {
      householdId,
      deliveryId,
      error,
      now: now(),
      attemptRecorded,
    });
    return { action: "guard_error", retrySafeBeforeSmtp: true };
  }
}

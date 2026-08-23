import {
  finalSendDecision,
  parseAirbnbConversationEmail,
  withAutomatedReplyFooter,
} from "@tristdrum/airbnb-core";
import {
  collectConversationMessages,
  findSentMessageIds,
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
  const known = new Set(sourceEvents.map((event) => `${event.direction}:${event.contentHash}`));
  return parsed.entries
    .filter((entry) => !known.has(`${entry.direction}:${entry.contentHash}`))
    .map((entry) => ({
      direction: entry.direction,
      occurredAt: eventTime(occurredAt, entry.sequence),
    }));
}

export async function processDeliveryGuard({
  sql,
  householdId,
  deliveryId,
  now = () => new Date(),
  env = process.env,
  collectMessages = collectConversationMessages,
  reconcileSent = findSentMessageIds,
  sendReply = sendThreadedReply,
  claimDelivery = claimDeliveryForGuard,
  applyDecision = applyDeliveryGuardDecision,
  recordAttempt = recordDeliveryAttempt,
  markSent = markDeliverySent,
  recordAmbiguous = recordAmbiguousDeliveryFailure,
  recordGuardFailure = recordDeliveryGuardFailure,
}) {
  const checkedAt = now();
  const claimed = await claimDelivery(sql, {
    householdId,
    deliveryId,
    now: checkedAt,
  });
  if (!claimed || claimed.action !== "claimed") return claimed ?? { action: "not_claimed" };

  try {
    const since = new Date(Date.parse(claimed.sourceLastEventAt) - 2 * 86_400_000);
    const collections = [collectMessages({
      since,
      maxRead: Number.parseInt(env.AIRBNB_SUPPORT_MAX_EMAILS ?? "500", 10),
      mailboxScope: "tristan",
      env,
    })];
    const janeConfigured = Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_USER ?? "").trim())
      && Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD ?? "").trim());
    if (janeConfigured) {
      collections.push(collectMessages({
        since,
        maxRead: Number.parseInt(env.AIRBNB_SUPPORT_JANE_MAX_EMAILS ?? env.AIRBNB_SUPPORT_MAX_EMAILS ?? "500", 10),
        mailboxScope: "jane",
        env,
      }));
    }
    const [tristanCollection, ...supplementalCollections] = await Promise.all(collections);
    const canonical = latestCanonicalConversation(
      tristanCollection.messages,
      claimed.providerThreadId,
    );
    if (!canonical) {
      const decision = { action: "cancel_and_reevaluate", reason: "canonical_thread_missing" };
      await applyDecision(sql, { householdId, deliveryId, decision, now: now() });
      return decision;
    }

    const sentMessageIds = await reconcileSent({
      messageIds: [claimed.outboundMessageId],
      env,
    });
    const latestEvents = eventsAddedAfterDraft(
      canonical.parsed,
      canonical.email.occurredAt,
      claimed.sourceEvents,
    );
    for (const supplementalCollection of supplementalCollections) {
      const supplemental = latestCanonicalConversation(
        supplementalCollection.messages,
        claimed.providerThreadId,
      );
      if (!supplemental) continue;
      latestEvents.push(...eventsAddedAfterDraft(
        supplemental.parsed,
        supplemental.email.occurredAt,
        claimed.sourceEvents,
      ));
    }
    const decision = finalSendDecision({
      sourceFingerprint: claimed.sourceFingerprint,
      latestFingerprint: canonical.parsed.sourceFingerprint,
      sourceLastEventAt: claimed.sourceLastEventAt,
      latestEvents,
      outboundMessageId: claimed.outboundMessageId,
      sentMessageIds,
    });
    if (decision.action !== "send") {
      await applyDecision(sql, { householdId, deliveryId, decision, now: now() });
      return decision;
    }

    const finalText = withAutomatedReplyFooter(claimed.finalText ?? claimed.draftText);
    const attempt = await recordAttempt(sql, {
      householdId,
      deliveryId,
      now: now(),
    });
    if (!attempt) return { action: "not_claimed" };

    try {
      const sent = await sendReply({
        to: canonical.email.replyTo,
        subject: canonical.email.subject,
        text: finalText,
        messageId: claimed.outboundMessageId,
        inReplyTo: canonical.email.providerMessageId,
        references: canonical.email.references,
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
      await recordAmbiguous(sql, {
        householdId,
        deliveryId,
        error,
        now: now(),
      });
      return { action: "ambiguous", manualReconciliationRequired: true };
    }
  } catch (error) {
    await recordGuardFailure(sql, {
      householdId,
      deliveryId,
      error,
      now: now(),
    });
    return { action: "guard_error", retrySafeBeforeSmtp: true };
  }
}

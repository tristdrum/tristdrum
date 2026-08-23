export const AUTOMATED_REPLY_FOOTER = "Automated reply on behalf of your hosts.";

export const AUTO_REPLY_TOPICS = Object.freeze(new Set([
  "wifi",
  "address",
  "directions",
  "parking",
  "verified_amenity",
  "check_in_time",
  "check_out_time",
  "greeting",
  "thanks",
  "resend_standard_info",
]));

export function supportDisposition(classification) {
  const topic = String(classification?.topic ?? "unknown");
  const confidence = Number(classification?.confidence ?? 0);
  const autoReply =
    classification?.riskTier === "low"
    && AUTO_REPLY_TOPICS.has(topic)
    && classification?.factsVerified === true
    && classification?.replyNeeded === true
    && Boolean(String(classification?.draft ?? "").trim())
    && confidence >= 0.9;
  return {
    topic,
    confidence,
    autoReply,
    status: autoReply ? "approved_for_guard" : "needs_human",
    alertManagement: !autoReply,
  };
}

export function withAutomatedReplyFooter(text) {
  const body = String(text ?? "").trim();
  if (!body) throw new Error("Reply text is empty.");
  if (body.endsWith(AUTOMATED_REPLY_FOOTER)) return body;
  return `${body}\n\n${AUTOMATED_REPLY_FOOTER}`;
}

export function supportEscalationStages({ latestEventAt, now = new Date() }) {
  const openedAt = Date.parse(latestEventAt);
  const checkedAt = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(openedAt) || !Number.isFinite(checkedAt)) {
    throw new Error("Support escalation timestamps are invalid.");
  }
  const minutesOpen = Math.max(0, Math.floor((checkedAt - openedAt) / 60_000));
  const stages = [{ stage: "immediate", minutesOpen, alertType: "guest_escalation", severity: "warning" }];
  if (minutesOpen >= 45) {
    stages.push({ stage: "reminder", minutesOpen, alertType: "guest_escalation", severity: "warning" });
  }
  if (minutesOpen >= 60) {
    stages.push({ stage: "overdue", minutesOpen, alertType: "guest_overdue", severity: "critical" });
  }
  return stages;
}

export function finalSendDecision({
  sourceFingerprint,
  latestFingerprint,
  sourceLastEventAt,
  latestEvents = [],
  outboundMessageId,
  sentMessageIds = [],
}) {
  if (sentMessageIds.includes(outboundMessageId)) {
    return { action: "mark_sent", reason: "sent_message_reconciled" };
  }

  const cutoff = Date.parse(sourceLastEventAt);
  if (!Number.isFinite(cutoff)) throw new Error("sourceLastEventAt is invalid.");
  const newerEvents = latestEvents
    .filter((event) => Date.parse(event.occurredAt) > cutoff)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  if (newerEvents.some((event) => event.direction === "guest")) {
    return { action: "cancel_and_reevaluate", reason: "newer_guest_event" };
  }
  if (newerEvents.some((event) => event.direction === "host")) {
    return { action: "handled_by_human", reason: "newer_host_event" };
  }
  if (latestFingerprint !== sourceFingerprint) {
    return { action: "cancel_and_reevaluate", reason: "source_fingerprint_changed" };
  }
  return { action: "send", reason: "canonical_thread_unchanged" };
}

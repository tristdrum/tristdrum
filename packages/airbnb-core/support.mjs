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

const HUMAN_REVIEW_PATTERNS = Object.freeze([
  /\b(?:book|booking|reservation request|accept|decline|availability|available)\b/i,
  /\b(?:refund|discount|price|pricing|rate|money|payment|charge|fee|waive)\b/i,
  /\b(?:cancel|cancellation|change (?:my|the) dates?|move (?:my|the) stay|extend)\b/i,
  /\b(?:early check[ -]?in|late check[ -]?out|exception|special request)\b/i,
  /\b(?:complaint|dirty|broken|not working|damage|noise|unhappy|disappointed)\b/i,
  /\b(?:unsafe|danger|emergency|injur|fire|police|security issue)\b/i,
]);

function factText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function supportMessageRequiresHuman(message) {
  const text = String(message ?? "").trim();
  return HUMAN_REVIEW_PATTERNS.some((pattern) => pattern.test(text));
}

export function verifiedSupportDraft(topic, facts = {}) {
  if (topic === "greeting") return "Hello! Thank you for your message. We look forward to hosting you.";
  if (topic === "thanks") return "You are very welcome. We hope you enjoy your stay.";
  if (topic === "address") {
    const address = factText(facts.address);
    return address ? `The address is ${address}.` : null;
  }
  if (topic === "directions") {
    const directions = factText(facts.directions);
    return directions ? `Directions: ${directions}` : null;
  }
  if (topic === "parking") {
    const parking = factText(facts.parking);
    return parking ? `Parking: ${parking}` : null;
  }
  if (topic === "check_in_time") {
    const checkInTime = factText(facts.checkInTime);
    return checkInTime ? `Standard check-in is from ${checkInTime}.` : null;
  }
  if (topic === "check_out_time") {
    const checkOutTime = factText(facts.checkOutTime);
    return checkOutTime ? `Standard check-out is by ${checkOutTime}.` : null;
  }
  if (topic === "resend_standard_info") return factText(facts.standardInfo);
  if (topic === "wifi") {
    const wifi = factText(facts.wifi);
    return wifi ? `Wi-Fi: ${wifi}` : null;
  }
  return null;
}

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

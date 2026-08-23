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
  /\b(?:cancel|cancellation|modify|amend|shorten|lengthen|extend|reschedul\w*|change (?:my|the) dates?|move (?:my|the) stay)\b/i,
  /\b(?:won't|will not|can't|cannot|not coming|unable to (?:come|arrive|stay))\b/i,
  /\b(?:early check[ -]?in|late check[ -]?out|exception|special request)\b/i,
  /\b(?:complaint|dirty|broken|not working|damage|noise|unhappy|disappointed|maintenance|repair|leak|blocked drain)\b/i,
  /\b(?:no|without)\s+(?:hot\s+water|water|electricity|power|wi-?fi|internet)\b/i,
  /\b(?:geyser|toilet|shower|tap|sink|fridge|stove|microwave|air\s*con(?:ditioner)?|heater|door|window|lock)\b.*\b(?:broken|leak\w*|stuck|blocked|not working)\b/i,
  /\b(?:unsafe|danger|emergency|injur|fire|police|security issue)\b/i,
]);

const LOW_RISK_MESSAGE_PATTERNS = Object.freeze({
  greeting: Object.freeze([
    /^(?:hi|hello|hey|good morning|good afternoon|good evening)(?:[,.! ]+thank you for hosting (?:me|us))?(?:[,.! ]+(?:i am|we are|i'm|we're) looking forward to (?:the|my|our) stay)?[.!]*$/,
  ]),
  thanks: Object.freeze([
    /^(?:thanks|thank you|many thanks|thanks (?:so much|a lot)|thank you (?:so much|very much)|(?:great|perfect|okay|ok|got it)[,! ]+(?:thanks|thank you))[.!]*$/,
  ]),
  wifi: Object.freeze([
    /^(?:(?:hi|hello|hey)[,!]? )?(?:can|could|would) you (?:please )?(?:send|share|give|resend) (?:me |us )?(?:the )?wi-?fi (?:details|information|info|password|network name|network name and password)(?: again)?(?: please)?[?.!]*$/,
    /^(?:please )?resend (?:me |us )?(?:the )?wi-?fi (?:details|information|info|password|network name|network name and password)(?: please)?[.!]*$/,
    /^what(?:'s| is) (?:the )?wi-?fi (?:details|information|info|password|network name|network name and password)[?.!]*$/,
    /^wi-?fi (?:details|information|info|password|network name|network name and password)(?: please)?[?.!]*$/,
  ]),
  address: Object.freeze([
    /^(?:(?:hi|hello|hey)[,!]? )?(?:can|could|would) you (?:please )?(?:send|share|give|resend) (?:me |us )?(?:the )?address(?: please)?[?.!]*$/,
    /^what(?:'s| is) (?:the )?address[?.!]*$/,
    /^(?:the )?address(?: please)?[?.!]*$/,
  ]),
  directions: Object.freeze([
    /^(?:(?:hi|hello|hey)[,!]? )?(?:can|could|would) you (?:please )?(?:send|share|give|resend) (?:me |us )?(?:the )?directions(?: from (?:(?:the )?(?:east london )?airport|the city (?:centre|center)|n2|nahoon))?(?: please)?[?.!]*$/,
    /^(?:please )?(?:send|share|resend) (?:me |us )?(?:the )?directions(?: from (?:(?:the )?(?:east london )?airport|the city (?:centre|center)|n2|nahoon))?(?: please)?[?.!]*$/,
    /^how do (?:i|we) get (?:there|to (?:the )?(?:studio|property|address))[?.!]*$/,
  ]),
  parking: Object.freeze([
    /^(?:(?:hi|hello|hey)[,!]? )?(?:can|could|would) you (?:please )?(?:send|share|give) (?:me |us )?(?:the )?parking (?:details|information|info)(?: please)?[?.!]*$/,
    /^(?:where|how) (?:can|may|should) (?:i|we) park[?.!]*$/,
    /^is parking available[?.!]*$/,
    /^parking (?:details|information|info)(?: please)?[?.!]*$/,
  ]),
  check_in_time: Object.freeze([
    /^what time (?:can|may|should|do) (?:i|we) check[ -]?in[?.!]*$/,
    /^what time is (?:the )?(?:standard )?check[ -]?in[?.!]*$/,
    /^what(?:'s| is) (?:the )?(?:standard )?check[ -]?in time[?.!]*$/,
    /^when is check[ -]?in[?.!]*$/,
  ]),
  check_out_time: Object.freeze([
    /^what time (?:can|must|should|do) (?:i|we) check[ -]?out[?.!]*$/,
    /^what time is (?:the )?(?:standard )?check[ -]?out[?.!]*$/,
    /^what(?:'s| is) (?:the )?(?:standard )?check[ -]?out time[?.!]*$/,
    /^when is check[ -]?out[?.!]*$/,
  ]),
  resend_standard_info: Object.freeze([
    /^(?:(?:hi|hello|hey)[,!]? )?(?:can|could|would) you (?:please )?resend (?:me |us )?(?:the )?(?:standard |check[ -]?in )?(?:information|info|details|instructions|message)(?: please)?[?.!]*$/,
    /^(?:please )?resend (?:me |us )?(?:the )?(?:standard |check[ -]?in )?(?:information|info|details|instructions|message)(?: please)?[.!]*$/,
  ]),
});

function factText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function supportMessageRequiresHuman(message) {
  const text = String(message ?? "").trim();
  return HUMAN_REVIEW_PATTERNS.some((pattern) => pattern.test(text));
}

export function supportMessageMatchesTopic(message, topic) {
  const text = String(message ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const patterns = LOW_RISK_MESSAGE_PATTERNS[String(topic ?? "")];
  return Boolean(text && patterns?.some((pattern) => pattern.test(text)));
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
    && classification?.messageWhitelisted === true
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

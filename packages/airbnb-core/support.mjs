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
  "early_check_in",
  "late_check_out",
  "early_check_in_follow_up",
]));

const TIME_REQUEST_PATTERN = /\b(?:early check[ -]?in|late check[ -]?out)\b/i;

const NON_TIME_HUMAN_REVIEW_PATTERNS = Object.freeze([
  /\b(?:book|booking|reservation request|accept|decline|availability|available)\b/i,
  /\b(?:refund|discount|price|pricing|rate|money|payment|charge|fee|waive)\b/i,
  /\b(?:cancel|cancellation|modify|amend|shorten|lengthen|extend|reschedul\w*|change (?:my|the) dates?|move (?:my|the) stay)\b/i,
  /\b(?:won't|will not|can't|cannot|not coming|unable to (?:come|arrive|stay))\b/i,
  /\b(?:exception|special request)\b/i,
  /\b(?:complaint|dirty|broken|not working|damage|noise|unhappy|disappointed|maintenance|repair|leak|blocked drain)\b/i,
  /\b(?:sheet|linen|towel)s?\b.*\b(?:dirty|stain\w*|missing|smell\w*)\b/i,
  /\b(?:no|without)\s+(?:hot\s+water|water|electricity|power|wi-?fi|internet)\b/i,
  /\b(?:geyser|toilet|shower|tap|sink|fridge|stove|microwave|air\s*con(?:ditioner)?|heater|door|window|lock)\b.*\b(?:broken|leak\w*|stuck|blocked|not working)\b/i,
  /\b(?:unsafe|danger|emergency|injur|fire|police|security issue)\b/i,
]);

const HUMAN_REVIEW_PATTERNS = Object.freeze([
  ...NON_TIME_HUMAN_REVIEW_PATTERNS,
  TIME_REQUEST_PATTERN,
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

function clockMinutes(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : fallback;
}

function clockLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function requestSegment(message, requestType) {
  const text = String(message ?? "").toLowerCase();
  const marker = requestType === "early_checkin"
    ? /\b(?:check[ -]?in|checkin|arriv(?:e|ing))\b/g
    : /\b(?:check[ -]?out|checkout|leav(?:e|ing))\b/g;
  const matches = [...text.matchAll(marker)];
  if (!matches.length) return text;
  const modal = /\b(?:can|could|may|might|would|want|like|hope|possible|please)\b/;
  const requested = matches.filter((match) => modal.test(text.slice(Math.max(0, match.index - 50), match.index)));
  const chosen = requested.at(-1) ?? matches.at(-1);
  return text.slice(chosen.index, chosen.index + 100);
}

function requestedClockMinutes(message, requestType, standardMinutes) {
  const text = requestSegment(message, requestType);
  const clocks = [];
  for (const match of text.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)/gi)) {
    let hours = Number(match[1]);
    if (hours < 1 || hours > 12) continue;
    const suffix = match[3].replace(/\./g, "").toLowerCase();
    if (hours === 12) hours = 0;
    if (suffix === "pm") hours += 12;
    clocks.push({
      index: match.index,
      end: match.index + match[0].length,
      minutes: hours * 60 + Number(match[2] ?? 0),
    });
  }
  for (const match of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    clocks.push({
      index: match.index,
      end: match.index + match[0].length,
      minutes: Number(match[1]) * 60 + Number(match[2]),
    });
  }
  if (clocks.length) {
    clocks.sort((left, right) => left.index - right.index);
    for (let index = 0; index < clocks.length - 1; index += 1) {
      const connector = text.slice(clocks[index].end, clocks[index + 1].index);
      if (/\b(?:instead of|rather than|as opposed to)\b/i.test(connector)) {
        return clocks[index].minutes;
      }
    }
    return clocks.at(-1).minutes;
  }
  const relative = /\b(one|two|1|2)\s+hours?\s+(early|late)\b/.exec(text);
  if (relative) {
    const hours = relative[1] === "one" || relative[1] === "1" ? 1 : 2;
    return standardMinutes + (relative[2] === "early" ? -hours * 60 : hours * 60);
  }
  const plainHours = [...text.matchAll(/\b(?:at|until|by|around|about|before|after)\s+(\d{1,2})(?:\s*o['’]?clock)?\b/g)];
  if (!plainHours.length) return null;
  let hours = Number(plainHours.at(-1)[1]);
  if (hours > 23) return null;
  if (["early_checkin", "late_checkout"].includes(requestType) && hours >= 1 && hours <= 6) hours += 12;
  return hours * 60;
}

function timeRequestType(message) {
  const text = String(message ?? "").normalize("NFKC");
  if (/\b(?:early\s+check[ -]?in|check[ -]?in\s+(?:early|before)|arriv(?:e|ing)\s+(?:early|before))\b/i.test(text)) {
    return "early_checkin";
  }
  if (/\b(?:late\s+check[ -]?out|check[ -]?out\s+(?:late|after)|leav(?:e|ing)\s+(?:late|after))\b/i.test(text)) {
    return "late_checkout";
  }
  if (/\b(?:can|could|may|might|would|want|hope|possible)\b[^?.!]{0,60}\b(?:check[ -]?in|checkin|arriv(?:e|ing))\b[^?.!]{0,30}\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/i.test(text)) {
    return "early_checkin";
  }
  if (/\b(?:can|could|may|might|would|want|hope|possible)\b[^?.!]{0,60}\b(?:check[ -]?out|checkout|leav(?:e|ing))\b[^?.!]{0,30}\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/i.test(text)) {
    return "late_checkout";
  }
  return null;
}

export function supportTimeRequestIsFocused(message) {
  const text = String(message ?? "").normalize("NFKC").trim();
  if (!text || NON_TIME_HUMAN_REVIEW_PATTERNS.some((pattern) => pattern.test(text))) return false;
  const withoutGreeting = text.replace(/^(?:hi|hello|hey|good (?:morning|afternoon|evening))[,!]\s*/i, "");
  const withoutClockColons = withoutGreeting.replace(/(\d):(?=\d)/g, "$1");
  if (/[,;:\n]/.test(withoutClockColons)) return false;
  if (/\b(?:and|also|plus|as well as|another thing|because|but|although|though|however|while)\b/i.test(withoutGreeting)) return false;
  if (/\b(?:wi-?fi|internet|password|address|directions?|parking|refund|booking|reservation|price|rate)\b/i.test(withoutGreeting)) return false;
  if ((text.match(/\?/g) ?? []).length > 1) return false;
  return !/[.!?]\s+[A-Za-z]/.test(text.replace(/[.!?]\s*$/, ""));
}

export function supportTimeRequestDecision(message, facts = {}) {
  const requestType = timeRequestType(message);
  if (!requestType) return null;

  const standardCheckIn = clockMinutes(facts.checkInTime, 15 * 60);
  const standardCheckOut = clockMinutes(facts.checkOutTime, 10 * 60);
  const earliestCheckIn = clockMinutes(facts.earliestCheckInTime, 13 * 60);
  const standardMinutes = requestType === "early_checkin" ? standardCheckIn : standardCheckOut;
  const requestedMinutes = requestedClockMinutes(message, requestType, standardMinutes);
  const requestedTime = requestedMinutes == null ? null : clockLabel(requestedMinutes);

  if (requestType === "early_checkin") {
    if (requestedMinutes == null) {
      return {
        topic: "early_check_in",
        requestType,
        action: "ask_time",
        requestedTime: null,
        effectiveTime: null,
        createsOperationalRequest: false,
        needsCleanerNotification: false,
        reply: `We may be able to arrange an early check-in from ${clockLabel(earliestCheckIn)}, depending on the previous guest and cleaning. What time did you have in mind?`,
      };
    }
    if (requestedMinutes < earliestCheckIn) {
      return {
        topic: "early_check_in",
        requestType,
        action: "offer_earliest",
        requestedTime,
        effectiveTime: clockLabel(earliestCheckIn),
        createsOperationalRequest: false,
        needsCleanerNotification: false,
        reply: `The earliest early check-in we can offer is ${clockLabel(earliestCheckIn)}, and it still depends on the previous guest leaving on time and cleaning being finished. Would ${clockLabel(earliestCheckIn)} work for you?`,
      };
    }
    if (requestedMinutes >= standardCheckIn) {
      return {
        topic: "early_check_in",
        requestType,
        action: "standard_time",
        requestedTime,
        effectiveTime: clockLabel(standardCheckIn),
        createsOperationalRequest: false,
        needsCleanerNotification: false,
        reply: `Standard check-in is from ${clockLabel(standardCheckIn)}, so ${requestedTime} is absolutely fine.`,
      };
    }
    return {
      topic: "early_check_in",
      requestType,
      action: "accept_conditional",
      requestedTime,
      effectiveTime: requestedTime,
      createsOperationalRequest: true,
      needsCleanerNotification: true,
      reply: `We’ll do our best to have the studio ready for an early check-in at ${requestedTime}. The previous guest may only leave at ${clockLabel(standardCheckOut)}, so this depends on cleaning being finished in time and cannot be guaranteed. We’ve alerted the cleaning team and will update you on the day.`,
    };
  }

  if (requestedMinutes != null && requestedMinutes <= standardCheckOut) {
    return {
      topic: "late_check_out",
      requestType,
      action: "standard_time",
      requestedTime,
      effectiveTime: clockLabel(standardCheckOut),
      createsOperationalRequest: false,
      needsCleanerNotification: false,
      reply: `Standard check-out is by ${clockLabel(standardCheckOut)}, so ${requestedTime} is fine.`,
    };
  }
  return {
    topic: "late_check_out",
    requestType,
    action: "decline",
    requestedTime,
    effectiveTime: clockLabel(standardCheckOut),
    createsOperationalRequest: false,
    needsCleanerNotification: false,
    reply: `I’m sorry, but we can’t offer a late check-out because the studio needs to be prepared for the next guest. Standard check-out is by ${clockLabel(standardCheckOut)}.`,
  };
}

export function supportTimeFollowUpDecision(message, activeRequest, now = new Date()) {
  if (activeRequest?.requestType !== "early_checkin") return null;
  const text = String(message ?? "").normalize("NFKC").trim();
  const isFollowUp = /\b(?:is (?:the )?(?:room|studio|unit|place) ready|can (?:i|we) (?:check[ -]?in|come|go through) now|any (?:news|update).*(?:early|check[ -]?in)|are (?:we|you).*(?:ready|check[ -]?in))\b/i.test(text);
  if (!isFollowUp) return null;
  const requestedAt = Date.parse(`${activeRequest.stayDate}T${activeRequest.effectiveTime}:00+02:00`);
  const checkedAt = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(requestedAt) || !Number.isFinite(checkedAt)) return null;
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(checkedAt));
  if (localDate !== activeRequest.stayDate) return null;
  const atOrAfterRequestedTime = checkedAt >= requestedAt;
  const cleanersConfirmed = ["ready", "guest_notified"].includes(activeRequest.status);
  let reply;
  if (cleanersConfirmed && atOrAfterRequestedTime) {
    reply = "Good news, the studio is ready now, so you’re welcome to check in.";
  } else if (atOrAfterRequestedTime) {
    reply = "We can’t contact our cleaning team right now, but they did get an early notification, so you should be able to go through. We’re so sorry about that.";
  } else {
    reply = "The cleaning team has the early notification, but we haven’t had confirmation that the studio is ready yet. Please wait for an update before going through.";
  }
  return {
    topic: "early_check_in_follow_up",
    requestType: "early_checkin",
    action: cleanersConfirmed ? "ready" : atOrAfterRequestedTime ? "no_cleaner_response" : "still_waiting",
    createsOperationalRequest: false,
    needsCleanerNotification: false,
    reply,
  };
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
  if (["early_check_in", "late_check_out"].includes(String(topic ?? ""))) {
    return supportTimeRequestDecision(text)?.topic === topic;
  }
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

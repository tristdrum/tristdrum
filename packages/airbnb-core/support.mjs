export const AUTOMATED_REPLY_FOOTER = "Automated reply on behalf of your hosts.";

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
  const precedingStart = Math.max(0, chosen.index - 60);
  const preceding = text.slice(precedingStart, chosen.index);
  const startsBeforeMarker = modal.test(preceding)
    && /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b/i.test(preceding);
  return text.slice(startsBeforeMarker ? precedingStart : chosen.index, chosen.index + 100);
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
  if (/\b(?:can|could|may|might|would|want|hope|possible)\b[^?.!]{0,60}\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b[^?.!]{0,30}\b(?:check[ -]?in|checkin|arriv(?:e|ing))\b/i.test(text)) {
    return "early_checkin";
  }
  if (/\b(?:can|could|may|might|would|want|hope|possible)\b[^?.!]{0,60}\b(?:check[ -]?out|checkout|leav(?:e|ing))\b[^?.!]{0,30}\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/i.test(text)) {
    return "late_checkout";
  }
  if (/\b(?:can|could|may|might|would|want|hope|possible)\b[^?.!]{0,60}\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b[^?.!]{0,30}\b(?:check[ -]?out|checkout|leav(?:e|ing))\b/i.test(text)) {
    return "late_checkout";
  }
  return null;
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

export function supportTimeFollowUpDecision(message, activeRequest, now = new Date(), facts = {}) {
  if (activeRequest?.requestType !== "early_checkin") return null;
  const text = String(message ?? "").normalize("NFKC").trim();
  const standardCheckIn = clockMinutes(facts.checkInTime, 15 * 60);
  const standardTime = clockLabel(standardCheckIn);
  const requestedMinutes = requestedClockMinutes(text, "early_checkin", standardCheckIn);
  const explicitlyWithdraws = /\b(?:no longer (?:need|want)|do not need|don't need|dont need|no need(?: for| to have| to use)?|cancel|forget|ignore)\b[^.!?]{0,50}\b(?:early|earlier|check[ -]?in)\b/i.test(text)
    || /\b(?:standard|usual|normal)\b[^.!?]{0,30}\b(?:check[ -]?in|time)\b[^.!?]{0,30}\b(?:fine|works?|okay|ok)\b/i.test(text)
    || (
      requestedMinutes === standardCheckIn
      && /\b(?:fine|works?|okay|ok|instead|rather|stick|arriv(?:e|ing)|check[ -]?in)\b/i.test(text)
    );
  if (explicitlyWithdraws) {
    return {
      topic: "early_check_in_follow_up",
      requestType: "early_checkin",
      action: "standard_time",
      requestedTime: standardTime,
      effectiveTime: standardTime,
      createsOperationalRequest: false,
      cancelsOperationalRequest: true,
      needsCleanerNotification: true,
      reply: `No problem, we’ll use the standard ${standardTime} check-in time instead.`,
    };
  }
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

export function withoutAutomatedReplyFooter(text) {
  const body = String(text ?? "").trim();
  if (!body) throw new Error("Reply text is empty.");
  return body.replace(new RegExp(`\\s*${AUTOMATED_REPLY_FOOTER.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`), "").trim();
}

export function withAutomatedReplyFooter(text) {
  return withoutAutomatedReplyFooter(text);
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

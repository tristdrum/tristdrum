import {
  propertyForListing,
  readWhatsAppChatMessages,
  sendVerifiedWhatsAppGroupMessage,
  withAutomatedReplyFooter,
} from "@tristdrum/airbnb-core";
import {
  cancelActiveGuestTimeRequests,
  loadActiveGuestTimeRequestsForReplacement,
  loadAwaitingReadyRequests,
  loadDueReadinessRequests,
  loadReadyTimeRequests,
  markGuestTimeRequestCleanersNotified,
  markGuestTimeRequestReadinessPrompted,
  markGuestTimeRequestReady,
  storeOperationalGuestReply,
  upsertGuestTimeRequest,
} from "./repository.mjs";

const MONTHS = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3], ["apr", 4], ["april", 4],
  ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10], ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function stayStartDate(stayLabel, referenceDate = new Date()) {
  const match = /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?/i.exec(String(stayLabel ?? ""));
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  if (!month) return null;
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (!Number.isFinite(reference.getTime())) return null;
  let year = match[3] ? Number(match[3]) : reference.getUTCFullYear();
  let value = isoDate(year, month, Number(match[2]));
  if (!value || match[3]) return value;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  if (timestamp < reference.getTime() - 180 * 86_400_000) year += 1;
  if (timestamp > reference.getTime() + 180 * 86_400_000) year -= 1;
  return isoDate(year, month, Number(match[2]));
}

function displayDate(value) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00+02:00`));
}

function readinessCheckAt(stayDate, effectiveTime) {
  const effective = new Date(`${stayDate}T${effectiveTime}:00+02:00`);
  return new Date(effective.getTime() - 60 * 60 * 1000).toISOString();
}

export function buildGuestTimeRequest({ candidate, decision }) {
  if (!decision?.createsOperationalRequest || !decision.requestedTime || !decision.effectiveTime) return null;
  const property = propertyForListing(candidate.listingName);
  const stayDate = stayStartDate(candidate.stayLabel, candidate.latestEventAt);
  if (!property || !candidate.propertyId || !stayDate) return null;
  const early = decision.requestType === "early_checkin";
  const bagDrop = decision.requestType === "bag_drop";
  return {
    requestType: decision.requestType,
    action: decision.action,
    stayDate,
    requestedTime: decision.requestedTime,
    effectiveTime: decision.effectiveTime,
    unitNumber: property.unitNumber,
    cleanerNoteEn: bagDrop
      ? `Bag drop expected from ${decision.effectiveTime}, but only after the previous guest has actually checked out; if departure is late, wait until they leave. Luggage only; no room access before cleaning is complete.`
      : early
      ? `Early check-in requested for ${decision.effectiveTime}. Please prioritise this unit; the time is not guaranteed yet.`
      : `Late check-out approved for ${decision.effectiveTime}. Please start cleaning after the guest leaves.`,
    cleanerNoteXh: bagDrop
      ? `Ukushiya iibhegi kulindeleke ukususela ngo-${decision.effectiveTime}, kodwa kuphela emva kokuba undwendwe lwangaphambili luphume ngokupheleleyo; ukuba luphuma kade, linda lude luhambe. Kukushiya iibhegi kuphela; akukho kungena egumbini ngaphambi kokuba ukucoca kugqitywe.`
      : early
      ? `Kucelwe ukungena kwangethuba ngo-${decision.effectiveTime}. Nceda ubeke le unit phambili; ixesha alikaqinisekiswa.`
      : `Ukuhamba kade ngo-${decision.effectiveTime} kuvunyiwe. Nceda uqale ukucoca emva kokuba undwendwe luhambile.`,
    readinessCheckAt: early ? readinessCheckAt(stayDate, decision.effectiveTime) : null,
  };
}

export function cleanerTimingMessage(request, { isUpdate = false } = {}) {
  const heading = request.requestType === "bag_drop"
    ? (isUpdate ? "Updated Airbnb bag-drop" : "Airbnb bag-drop update")
    : `${isUpdate ? "Updated Airbnb timing" : "Airbnb timing update"}`;
  return [
    `${heading} for *${displayDate(request.stayDate)}*`,
    "",
    `Unit ${request.unitNumber}`,
    `- ${request.cleanerNoteEn}`,
    "",
    "*Xhosa:*",
    `Unit ${request.unitNumber}`,
    `- ${request.cleanerNoteXh}`,
    "",
    "Sent by Airbnb support automation.",
  ].join("\n");
}

export function cleanerTimingWithdrawalMessage(request, decision) {
  const early = request.requestType === "early_checkin";
  const standardTime = decision.effectiveTime;
  const english = early
    ? `The earlier early check-in instruction no longer applies. Use the standard ${standardTime} check-in time.`
    : `The earlier late check-out instruction no longer applies. Use the standard ${standardTime} check-out time.`;
  const xhosa = early
    ? `Umyalelo wangaphambili wokungena kwangethuba awusasebenzi. Sebenzisa ixesha eliqhelekileyo lokungena ngo-${standardTime}.`
    : `Umyalelo wangaphambili wokuphuma emva kwexesha awusasebenzi. Sebenzisa ixesha eliqhelekileyo lokuphuma ngo-${standardTime}.`;
  return [
    `Updated Airbnb timing for *${displayDate(String(request.stayDate))}*`,
    "",
    `Unit ${request.unitNumber}`,
    `- ${english}`,
    "",
    "*Xhosa:*",
    `Unit ${request.unitNumber}`,
    `- ${xhosa}`,
    "",
    "Sent by Airbnb support automation.",
  ].join("\n");
}

export async function withdrawGuestTimeRequest({
  sql,
  householdId,
  candidate,
  decision,
  now,
  env = process.env,
  sendGroupMessage = sendVerifiedWhatsAppGroupMessage,
}) {
  const active = await loadActiveGuestTimeRequestsForReplacement(sql, {
    householdId,
    candidate,
    requestType: decision.requestType,
  });
  if (!active.length) return { status: "no_change", cancelledCount: 0, verified: true };
  const deliveries = [];
  for (const request of active) {
    deliveries.push(await sendGroupMessage({
      chatId: env.AIRBNB_WHATSAPP_CHAT_ID,
      text: cleanerTimingWithdrawalMessage(request, decision),
      idempotencyKey: `airbnb-support:cleaners:time-withdraw:${request.id}:${candidate.sourceFingerprint.slice(0, 16)}`,
      env,
    }));
  }
  const cancelled = await cancelActiveGuestTimeRequests(sql, {
    householdId,
    candidate,
    requestType: decision.requestType,
    now,
  });
  if (cancelled.length !== active.length) {
    throw new Error("The cleaner timing withdrawal changed during delivery.");
  }
  return {
    status: "cancelled",
    cancelledCount: cancelled.length,
    verified: deliveries.every((delivery) => delivery.verification?.found === true),
  };
}

export async function captureGuestTimeRequest({
  sql,
  householdId,
  candidate,
  decision,
  now,
  env = process.env,
  sendGroupMessage = sendVerifiedWhatsAppGroupMessage,
}) {
  const request = buildGuestTimeRequest({ candidate, decision });
  if (!request) return { status: "needs_human", reason: "missing_property_or_stay_date" };
  const row = await upsertGuestTimeRequest(sql, { householdId, candidate, request, now });
  if (row.status === "cancelled") return { status: "needs_human", reason: "time_request_cancelled" };
  if (row.cleanersNotifiedAt) return { status: "already_notified", requestId: row.id };
  const delivery = await sendGroupMessage({
    chatId: env.AIRBNB_WHATSAPP_CHAT_ID,
    text: cleanerTimingMessage(request, { isUpdate: row.replacesPrevious === true }),
    idempotencyKey: `airbnb-support:cleaners:time:${row.id}`,
    env,
  });
  await markGuestTimeRequestCleanersNotified(sql, {
    householdId,
    requestId: row.id,
    providerMessageId: delivery.live?.providerMessageId ?? null,
    now,
  });
  return { status: "notified", requestId: row.id, verified: delivery.verification?.found === true };
}

export function cleanerReadyConfirmation(message, request) {
  const occurredAt = Date.parse(message.occurredAt);
  const promptedAt = Date.parse(request.readinessPromptedAt);
  if (message.fromMe || !Number.isFinite(occurredAt) || !Number.isFinite(promptedAt) || occurredAt < promptedAt) return false;
  const text = `${message.text} ${message.transcript}`.toLowerCase().replace(/\s+/g, " ").trim();
  const escapedName = String(request.commonName ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unit = `(?:unit\\s+${request.unitNumber}${escapedName ? `|${escapedName}` : ""})`;
  return new RegExp(`^(?:yes[, ]+)?${unit}(?:\\s+is(?:\\s+now)?)?\\s+(?:ready|done|finished|complete|cleaned)(?:\\s+now)?[.!]*$`, "i").test(text);
}

function readinessPrompt(request) {
  return [
    `Unit ${request.unitNumber}: is the studio ready for the ${String(request.effectiveTime).slice(0, 5)} early check-in?`,
    `Please reply “Unit ${request.unitNumber} ready” when it is ready.`,
  ].join("\n");
}

export async function processTimeRequestReadiness({
  sql,
  householdId,
  now,
  env = process.env,
  sendGroupMessage = sendVerifiedWhatsAppGroupMessage,
  readGroupMessages = readWhatsAppChatMessages,
}) {
  const prompted = [];
  for (const request of await loadDueReadinessRequests(sql, { householdId, now })) {
    await sendGroupMessage({
      chatId: env.AIRBNB_WHATSAPP_CHAT_ID,
      text: readinessPrompt(request),
      idempotencyKey: `airbnb-support:cleaners:ready-check:${request.id}`,
      env,
    });
    const marked = await markGuestTimeRequestReadinessPrompted(sql, {
      householdId,
      requestId: request.id,
      now,
    });
    if (marked) prompted.push(request.id);
  }

  const awaiting = await loadAwaitingReadyRequests(sql, { householdId, now });
  const messages = awaiting.length
    ? await readGroupMessages({ chatId: env.AIRBNB_WHATSAPP_CHAT_ID, limit: 100, env })
    : [];
  const ready = [];
  for (const request of awaiting) {
    if (!messages.some((message) => cleanerReadyConfirmation(message, request))) continue;
    const marked = await markGuestTimeRequestReady(sql, { householdId, requestId: request.id, now });
    if (marked) ready.push(request.id);
  }

  const repliesQueued = [];
  for (const request of await loadReadyTimeRequests(sql, { householdId, now })) {
    const delivery = await storeOperationalGuestReply(sql, {
      householdId,
      requestId: request.id,
      threadId: request.threadId,
      draft: withAutomatedReplyFooter("Good news, the studio is ready now, so you’re welcome to check in."),
      now,
    });
    if (delivery) repliesQueued.push(delivery.id);
  }
  return { promptedCount: prompted.length, readyCount: ready.length, repliesQueuedCount: repliesQueued.length };
}

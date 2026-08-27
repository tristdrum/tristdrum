#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectAirbnbMessages } from "./gmail.mjs";

process.env.TZ = "Africa/Johannesburg";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = resolve(process.env.AIRBNB_CLEANER_HOME ?? "/data");
const LEDGER_PATH = resolve(WORK_DIR, "sent-ledger.jsonl");
const WHATSAPP_ACCOUNT_ID = process.env.AIRBNB_WHATSAPP_ACCOUNT_ID ?? "";
const WHATSAPP_CHAT_ID = process.env.AIRBNB_WHATSAPP_CHAT_ID ?? "";
const WHATSAPP_CHAT_NAME = process.env.AIRBNB_WHATSAPP_CHAT_NAME ?? "Airbnb Maids";
const MESSAGE_FOOTER = process.env.AIRBNB_CLEANER_FOOTER ?? "Sent by Airbnb cleaner automation.";
const LEGACY_MESSAGE_FOOTER = "Sent by Codex AI automation.";
const WEATHER = {
  label: "East London / KuGompo City, 1 Bowie Street, Nahoon",
  latitude: -32.9833,
  longitude: 27.9333,
};
const WEATHER_FORECAST_URL = process.env.AIRBNB_WEATHER_URL ?? "https://api.open-meteo.com/v1/forecast";
const WEATHER_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.AIRBNB_WEATHER_MAX_ATTEMPTS ?? "3", 10) || 3);
const WEATHER_RETRY_DELAY_MS = Math.max(0, Number.parseInt(process.env.AIRBNB_WEATHER_RETRY_DELAY_MS ?? "1500", 10) || 1500);
const WEATHER_REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.AIRBNB_WEATHER_TIMEOUT_MS ?? "10000", 10) || 10000);
const WHATSAPP_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.AIRBNB_WHATSAPP_MAX_ATTEMPTS ?? "3", 10) || 3);
const WHATSAPP_RETRY_DELAY_MS = Math.max(0, Number.parseInt(process.env.AIRBNB_WHATSAPP_RETRY_DELAY_MS ?? "1500", 10) || 1500);
const WHATSAPP_REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.AIRBNB_WHATSAPP_TIMEOUT_MS ?? "15000", 10) || 15000);
const WHATSAPP_READ_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.AIRBNB_WHATSAPP_READ_TIMEOUT_MS ?? "45000", 10) || 45000);
const CHAT_RECONCILIATION_LIMIT = 20;

const UNITS = [
  {
    id: 1,
    label: "Unit 1",
    commonName: "Bougainvillea",
    listingName: "Bougainvillea Courtyard Studio",
    patterns: [/bougainvillea/i, /bogenvilla/i, /bougenvilla/i, /bougenvillea/i],
  },
  {
    id: 2,
    label: "Unit 2",
    commonName: "Spekboom",
    listingName: "The Spekboom Studio",
    patterns: [/spekboom/i],
  },
  {
    id: 3,
    label: "Unit 3",
    commonName: "Jasmine",
    listingName: "Jasmine Studio Stay",
    patterns: [/jasmine/i],
  },
];

const MONTHS = new Map(
  [
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12],
  ]
);

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_WEEKDAYS = /(?:Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sun)(?:day)?/i;

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    targetDate: null,
    target: "auto",
    json: false,
    maxRead: 40,
    searchDays: 90,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--date") args.targetDate = argv[++i];
    else if (arg === "--target") args.target = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--max-read") args.maxRead = Number(argv[++i]);
    else if (arg === "--search-days") args.searchDays = Number(argv[++i]);
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["dry-run", "live", "preview"].includes(args.mode)) {
    throw new Error("--mode must be dry-run, live, or preview");
  }
  if (!["auto", "today", "tomorrow"].includes(args.target)) {
    throw new Error("--target must be auto, today, or tomorrow");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node airbnb-cleaner-report.mjs [--mode dry-run|live|preview] [--date YYYY-MM-DD] [--target auto|today|tomorrow] [--json]

Modes:
  preview  Generate the report only.
  dry-run  Generate the report and validate the WhatsApp send with dry_run=true.
  live     Generate, dry-run, then send the WhatsApp message if confidence checks pass.

Default target:
  auto targets today before 10 a.m. SAST and tomorrow after that, so morning
  safety checks can catch late changes for the current day.
`);
}

function localDateFromParts(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  return localDateFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function formatISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date, days) {
  return localDateFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate() + days);
}

function compareDates(a, b) {
  const aKey = formatISODate(a);
  const bKey = formatISODate(b);
  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;
  return 0;
}

function dayDiff(a, b) {
  const ms = parseISODate(formatISODate(a)).getTime() - parseISODate(formatISODate(b)).getTime();
  return Math.round(ms / 86400000);
}

function displayDate(date) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function resolveTargetDate({ target = "auto", targetDate = null, now = new Date() } = {}) {
  if (targetDate) return targetDate instanceof Date ? targetDate : parseISODate(targetDate);
  const today = localDateFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (target === "today") return today;
  if (target === "tomorrow") return addDays(today, 1);

  const hour = now.getHours();
  return hour < 10 ? today : addDays(today, 1);
}

function normaliseText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2009\u202f]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function envelopeDate(envelope) {
  const raw = String(envelope.date ?? "");
  const parsed = Date.parse(raw.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function candidateEnvelope(envelope) {
  const address = String(envelope.from?.addr ?? "").trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);
  const trustedSender = address.includes("@") && (domain === "airbnb.com" || domain.endsWith(".airbnb.com"));
  const subject = String(envelope.subject ?? "");
  return (
    trustedSender &&
    /reservation|arrives|bougainvillea|bogenvilla|spekboom|jasmine/i.test(subject) &&
    !/receipt|review|support|reimbursement/i.test(subject)
  );
}

export function subjectMayTouchTarget(subject, targetDate) {
  const normalSubject = normaliseText(subject);
  if (/\b(cancelled|canceled|reservation updated|updated reservation|reservation change was accepted)\b/i.test(normalSubject)) {
    return true;
  }
  const subjectRange = extractDateRange(normalSubject, "", targetDate);
  if (subjectRange) {
    const checkIn = subjectRange.checkIn;
    const checkOut = subjectRange.checkOut;
    return compareDates(checkIn, targetDate) <= 0 && compareDates(checkOut, targetDate) >= 0;
  }

  const arrival = /\barrives\s+([A-Za-z]{3,9})\s+(\d{1,2})\b/i.exec(normalSubject);
  if (arrival) {
    const arrivalDate = inferDate(arrival[1], arrival[2], targetDate);
    return Boolean(arrivalDate && compareDates(arrivalDate, targetDate) <= 0 && dayDiff(targetDate, arrivalDate) <= 14);
  }

  return false;
}

function monthNumber(name) {
  return MONTHS.get(String(name).toLowerCase().replace(/[^a-z]/g, ""));
}

function inferDate(monthName, day, referenceDate) {
  const month = monthNumber(monthName);
  if (!month) return null;
  let candidate = localDateFromParts(referenceDate.getFullYear(), month, Number(day));
  if (dayDiff(candidate, referenceDate) > 210) candidate = localDateFromParts(referenceDate.getFullYear() - 1, month, Number(day));
  if (dayDiff(candidate, referenceDate) < -210) candidate = localDateFromParts(referenceDate.getFullYear() + 1, month, Number(day));
  return candidate;
}

function parseFullDate(monthName, day, year) {
  const month = monthNumber(monthName);
  if (!month) return null;
  return localDateFromParts(Number(year), month, Number(day));
}

function extractUnit(subject, body) {
  const haystack = `${subject}\n${body}`;
  return UNITS.find((unit) => unit.patterns.some((pattern) => pattern.test(haystack))) ?? null;
}

function extractDateRange(subject, body, referenceDate) {
  const normalSubject = normaliseText(subject);
  const normalBody = normaliseText(body);
  const checkinBlock = /Check-in\s+Checkout([\s\S]{0,350})/i.exec(normalBody)?.[1] ?? normalBody.slice(0, 800);

  const fullDates = [...checkinBlock.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b/g)];
  if (fullDates.length >= 2) {
    const checkIn = parseFullDate(fullDates[0][1], fullDates[0][2], fullDates[0][3]);
    const checkOut = parseFullDate(fullDates[1][1], fullDates[1][2], fullDates[1][3]);
    if (checkIn && checkOut) return { checkIn, checkOut, source: "body-full-dates" };
  }

  const shortDateRegex = new RegExp(`\\b${SHORT_WEEKDAYS.source},?\\s+([A-Za-z]{3,9})\\s+(\\d{1,2})\\b`, "gi");
  const shortDates = [...checkinBlock.matchAll(shortDateRegex)];
  if (shortDates.length >= 2) {
    let checkIn = inferDate(shortDates[0][1], shortDates[0][2], referenceDate);
    let checkOut = inferDate(shortDates[1][1], shortDates[1][2], referenceDate);
    if (checkIn && checkOut && compareDates(checkOut, checkIn) <= 0) {
      checkOut = localDateFromParts(checkOut.getFullYear() + 1, checkOut.getMonth() + 1, checkOut.getDate());
    }
    if (checkIn && checkOut) return { checkIn, checkOut, source: "body-short-dates" };
  }

  const subjectRange = /(?:,|\bfor)\s*([A-Za-z]{3,9})\s+(\d{1,2})\s*-\s*([A-Za-z]{3,9})?\s*(\d{1,2})(?:,\s*\d{4})?\b/i.exec(normalSubject);
  if (subjectRange) {
    let checkIn = inferDate(subjectRange[1], subjectRange[2], referenceDate);
    let checkOut = inferDate(subjectRange[3] || subjectRange[1], subjectRange[4], referenceDate);
    if (checkIn && checkOut && compareDates(checkOut, checkIn) <= 0) {
      checkOut = localDateFromParts(checkOut.getFullYear() + 1, checkOut.getMonth() + 1, checkOut.getDate());
    }
    if (checkIn && checkOut) return { checkIn, checkOut, source: "subject-range" };
  }

  return null;
}

function cleanName(value) {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{M}' -]/gu, "")
    .trim()
    .toLowerCase();
  return cleaned.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function sameGuestIdentity(left, right) {
  const leftName = cleanName(left).toLowerCase();
  const rightName = cleanName(right).toLowerCase();
  if (!leftName || !rightName) return false;
  return leftName === rightName
    || leftName.startsWith(`${rightName} `)
    || rightName.startsWith(`${leftName} `);
}

function extractGuestName(subject, body) {
  const subjectConfirmed = /Reservation confirmed\s*-\s*(.+?)\s+arrives\b/i.exec(subject);
  if (subjectConfirmed) return cleanName(subjectConfirmed[1]);

  const booker = /(?:^|\n)\s*([A-Z][A-Z' -]{2,})\s*\n\s*Booker\b/m.exec(body);
  if (booker) return cleanName(booker[1]);

  const arrives = /NEW BOOKING CONFIRMED!\s*([A-Z][A-Z' -]{2,})\s+ARRIVES\b/i.exec(body);
  if (arrives) return cleanName(arrives[1]);

  return "";
}

function extractGuestText(body) {
  const guestsBlock = /GUESTS\s+([\s\S]{0,220}?)(?:MORE DETAILS|CONFIRMATION CODE|Get the app|HOST PAYOUT|CANCELLATIONS|$)/i.exec(body)?.[1] ?? "";
  const bits = guestsBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\b(adult|adults|child|children|infant|infants|guest|guests)\b/i.test(line))
    .filter((line) => !/Guests will now|let you know/i.test(line));
  return bits.join(", ").replace(/\s+/g, " ").trim();
}

export function extractConfirmationCode(body) {
  return (
    /CONFIRMATION CODE\s+([A-Z0-9]{6,})/i.exec(body)?.[1] ??
    /\/hosting\/reservations\/details\/([A-Z0-9]{6,})/i.exec(body)?.[1] ??
    ""
  );
}

export function extractProviderThreadId(body) {
  return /\/(?:hosting|messaging)\/thread\/(\d+)/i.exec(body)?.[1] ?? "";
}

export function reservationEvidenceKind(subject, body = "") {
  const normalSubject = normaliseText(subject);

  if (/\b(cancelled|canceled|cancelled reservation|canceled reservation|reservation cancelled|reservation canceled)\b/i.test(normalSubject)) {
    return "cancelled";
  }
  if (/\b(reservation updated|updated reservation|reservation has been updated|booking has been updated|reservation change was accepted)\b/i.test(normalSubject)) {
    return "supplemental";
  }
  if (/^\s*RE:\s*Reservation\b/i.test(normalSubject)) return "supplemental";
  if (/\b(pending|reservation request|inquiry)\b/i.test(normalSubject)) return "ignored";
  if (/^\s*Reservation confirmed\b/i.test(normalSubject)) return "confirmed";
  return "ignored";
}

function reservationEvidenceSubtype(subject, body, evidenceKind) {
  if (evidenceKind !== "supplemental") return evidenceKind;
  return /\b(reservation updated|updated reservation|reservation has been updated|booking has been updated|reservation change was accepted)\b/i.test(normaliseText(subject))
    ? "update"
    : "reply";
}

function acceptedReservationChange(subject, body) {
  return /\b(?:reservation change was accepted|agreed to change (?:their|the) reservation)\b/i
    .test(normaliseText(`${subject}\n${body}`));
}

function conversationClaimsGuestCountChange(body) {
  const conversationBlock = normaliseText(body).split(/\n\s*Reply\b/i)[0] ?? "";
  const claimsChange = /\b(?:i(?:'ll| will)\s+(?:update|change)(?!\s+you\b)|let me\s+(?:do so|(?:update|change)(?!\s+you\b))|i(?:'ve| have)\s+(?:updated|changed))\b/i
    .test(conversationBlock);
  const describesAnotherChange = /\b(?:updated? you|arrival time|departure time|check-?in|check-?out|dates?|wi-?fi)\b/i
    .test(conversationBlock);
  return claimsChange && !describesAnotherChange;
}

function conversationDiscussesGuestCount(body) {
  const conversationBlock = normaliseText(body).split(/\n\s*Reply\b/i)[0] ?? "";
  return /\b(?:guests?|persons?|people|someone|partner|adults?|children|join (?:me|us)|staying overnight)\b/i
    .test(conversationBlock);
}

export function parseReservation(envelope, body, referenceDate) {
  const subject = String(envelope.subject ?? "");
  const normalBody = normaliseText(body);
  const unit = extractUnit(subject, normalBody);
  const range = extractDateRange(subject, normalBody, referenceDate);
  const confirmationCode = extractConfirmationCode(normalBody);
  const evidenceKind = reservationEvidenceKind(subject, normalBody);
  const evidenceSubtype = reservationEvidenceSubtype(subject, normalBody, evidenceKind);
  const guests = extractGuestText(normalBody);
  const allowsCodeOnlyEvidence = ["cancelled", "supplemental"].includes(evidenceKind) && confirmationCode;
  if ((!unit || !range) && !allowsCodeOnlyEvidence) return null;

  return {
    sourceEnvelopeId: String(envelope.id),
    sourceDate: envelope.date ?? "",
    sourceTimestamp: envelopeDate(envelope),
    senderAddress: String(envelope.from?.addr ?? "").trim().toLowerCase(),
    subject,
    unitId: unit?.id ?? null,
    unitLabel: unit?.label ?? "",
    commonName: unit?.commonName ?? "",
    listingName: unit?.listingName ?? "",
    checkIn: range ? formatISODate(range.checkIn) : null,
    checkOut: range ? formatISODate(range.checkOut) : null,
    dateSource: range?.source ?? "confirmation-code-only",
    guestName: extractGuestName(subject, normalBody),
    guests,
    confirmationCode,
    providerThreadId: extractProviderThreadId(normalBody),
    evidenceKind,
    evidenceSubtype,
    guestCountChangeAccepted: acceptedReservationChange(subject, normalBody),
    guestCountChangeClaimed: evidenceSubtype === "reply"
      && Boolean(guests)
      && conversationClaimsGuestCountChange(normalBody),
    guestCountChangeDiscussed: evidenceSubtype === "reply"
      && conversationDiscussesGuestCount(normalBody),
    cancelled: evidenceKind === "cancelled",
  };
}

export function mergeReservations(reservations) {
  const evidenceKind = (reservation) => reservation.evidenceKind ?? (reservation.cancelled ? "cancelled" : "confirmed");
  const cancellations = reservations.filter((reservation) => evidenceKind(reservation) === "cancelled");
  const latestCancellationByCode = new Map();
  const latestCancellationByUnitRange = new Map();
  for (const cancellation of cancellations) {
    const timestamp = cancellation.sourceTimestamp || 0;
    if (cancellation.confirmationCode) {
      latestCancellationByCode.set(
        cancellation.confirmationCode,
        Math.max(latestCancellationByCode.get(cancellation.confirmationCode) ?? 0, timestamp)
      );
    }
    if (cancellation.unitId && cancellation.checkIn && cancellation.checkOut) {
      const key = `${cancellation.unitId}:${cancellation.checkIn}:${cancellation.checkOut}`;
      latestCancellationByUnitRange.set(key, Math.max(latestCancellationByUnitRange.get(key) ?? 0, timestamp));
    }
  }

  const confirmations = reservations.filter((reservation) => evidenceKind(reservation) === "confirmed");
  const activeByConfirmationCode = new Map();
  const uncodedConfirmations = [];
  for (const reservation of confirmations) {
    if (!reservation.confirmationCode) {
      uncodedConfirmations.push({
        ...reservation,
        confirmationTimestamp: reservation.sourceTimestamp || 0,
        sources: [reservation.sourceEnvelopeId],
      });
      continue;
    }
    const existing = activeByConfirmationCode.get(reservation.confirmationCode);
    if (!existing) {
      activeByConfirmationCode.set(reservation.confirmationCode, {
        ...reservation,
        confirmationTimestamp: reservation.sourceTimestamp || 0,
        sources: [reservation.sourceEnvelopeId],
      });
      continue;
    }
    const reservationIsNewer = (reservation.sourceTimestamp || 0) > (existing.sourceTimestamp || 0);
    const primary = reservationIsNewer ? reservation : existing;
    const fallback = reservationIsNewer ? existing : reservation;
    activeByConfirmationCode.set(reservation.confirmationCode, {
      ...primary,
      guestName: primary.guestName || fallback.guestName,
      guests: primary.guests || fallback.guests,
      confirmationTimestamp: Math.max(
        existing.confirmationTimestamp ?? existing.sourceTimestamp ?? 0,
        reservation.sourceTimestamp || 0
      ),
      sources: [...new Set([...(existing.sources ?? [existing.sourceEnvelopeId]), reservation.sourceEnvelopeId])],
    });
  }

  const explicitUpdates = reservations
    .filter((reservation) => evidenceKind(reservation) === "supplemental" && reservation.evidenceSubtype === "update")
    .sort((a, b) => (a.sourceTimestamp || 0) - (b.sourceTimestamp || 0));
  const replies = reservations
    .filter((reservation) => evidenceKind(reservation) === "supplemental" && reservation.evidenceSubtype !== "update")
    .sort((a, b) => (a.sourceTimestamp || 0) - (b.sourceTimestamp || 0));
  const guestCountChangeWindowMs = 15 * 60 * 1000;
  const guestCountDiscussionWindowMs = 60 * 60 * 1000;
  for (const accepted of explicitUpdates.filter((update) => update.guestCountChangeAccepted && !update.guests)) {
    if (!accepted.confirmationCode || !accepted.providerThreadId) continue;
    const existing = activeByConfirmationCode.get(accepted.confirmationCode);
    const acceptedAt = accepted.sourceTimestamp || 0;
    if (!existing || acceptedAt < (existing.sourceTimestamp || 0)) continue;
    const countDiscussion = [...replies].reverse().find((reply) => {
      const replyAt = reply.sourceTimestamp || 0;
      if (!reply.guestCountChangeDiscussed || replyAt > acceptedAt || acceptedAt - replyAt > guestCountDiscussionWindowMs) {
        return false;
      }
      return reply.providerThreadId === accepted.providerThreadId && (reply.confirmationCode
        ? reply.confirmationCode === accepted.confirmationCode
        : Boolean(
          reply.unitId && reply.checkIn && reply.checkOut
          && reply.unitId === existing.unitId
          && reply.checkIn === existing.checkIn
          && reply.checkOut === existing.checkOut
          && sameGuestIdentity(reply.guestName, existing.guestName)
        ));
    });
    if (!countDiscussion) continue;
    const countReply = replies.find((reply) => {
      const replyAt = reply.sourceTimestamp || 0;
      if (!reply.guestCountChangeClaimed || !reply.guests || reply.guests === existing.guests) return false;
      if (replyAt < acceptedAt || replyAt - acceptedAt > guestCountChangeWindowMs) return false;
      const matchesReservation = reply.providerThreadId === accepted.providerThreadId && (reply.confirmationCode
        ? reply.confirmationCode === accepted.confirmationCode
        : Boolean(
          reply.unitId && reply.checkIn && reply.checkOut
          && reply.unitId === existing.unitId
          && reply.checkIn === existing.checkIn
          && reply.checkOut === existing.checkOut
          && sameGuestIdentity(reply.guestName, existing.guestName)
        ));
      if (!matchesReservation) return false;
      return !explicitUpdates.some((other) => (
        other.sourceEnvelopeId !== accepted.sourceEnvelopeId
        && other.confirmationCode === accepted.confirmationCode
        && (other.sourceTimestamp || 0) > acceptedAt
        && (other.sourceTimestamp || 0) <= replyAt
      ));
    });
    if (!countReply) continue;
    activeByConfirmationCode.set(accepted.confirmationCode, {
      ...existing,
      guests: countReply.guests,
      sourceEnvelopeId: countReply.sourceEnvelopeId,
      sourceDate: countReply.sourceDate,
      sourceTimestamp: countReply.sourceTimestamp,
      subject: countReply.subject,
      guestCountChangeEvidence: {
        discussionEnvelopeId: countDiscussion.sourceEnvelopeId,
        acceptedEnvelopeId: accepted.sourceEnvelopeId,
        countEnvelopeId: countReply.sourceEnvelopeId,
      },
      sources: [...new Set([
        ...(existing.sources ?? [existing.sourceEnvelopeId]),
        countDiscussion.sourceEnvelopeId,
        accepted.sourceEnvelopeId,
        countReply.sourceEnvelopeId,
      ])],
    });
  }
  for (const update of explicitUpdates) {
    if (!update.confirmationCode) continue;
    const existing = activeByConfirmationCode.get(update.confirmationCode);
    if (!existing || (update.sourceTimestamp || 0) < (existing.sourceTimestamp || 0)) continue;
    activeByConfirmationCode.set(update.confirmationCode, {
      ...existing,
      unitId: update.unitId ?? existing.unitId,
      unitLabel: update.unitLabel || existing.unitLabel,
      commonName: update.commonName || existing.commonName,
      listingName: update.listingName || existing.listingName,
      checkIn: update.checkIn ?? existing.checkIn,
      checkOut: update.checkOut ?? existing.checkOut,
      dateSource: update.checkIn && update.checkOut ? update.dateSource : existing.dateSource,
      guestName: update.guestName || existing.guestName,
      guests: update.guests || existing.guests,
      sourceEnvelopeId: update.sourceEnvelopeId,
      sourceDate: update.sourceDate,
      sourceTimestamp: update.sourceTimestamp,
      subject: update.subject,
      sources: [...new Set([...(existing.sources ?? [existing.sourceEnvelopeId]), update.sourceEnvelopeId])],
    });
  }

  const activeReservations = [...uncodedConfirmations, ...activeByConfirmationCode.values()];
  for (const reply of replies) {
    const matches = activeReservations.filter((reservation) => {
      if ((reply.sourceTimestamp || 0) < (reservation.sourceTimestamp || 0)) return false;
      if (reply.confirmationCode) return reply.confirmationCode === reservation.confirmationCode;
      return Boolean(
        reply.unitId && reply.checkIn && reply.checkOut &&
        reply.unitId === reservation.unitId &&
        reply.checkIn === reservation.checkIn &&
        reply.checkOut === reservation.checkOut
      );
    });
    if (matches.length !== 1) continue;
    const match = matches[0];
    if (!match.guestName && reply.guestName) match.guestName = reply.guestName;
    if (!match.guests && reply.guests) match.guests = reply.guests;
    match.sources = [...new Set([...(match.sources ?? [match.sourceEnvelopeId]), reply.sourceEnvelopeId])];
  }

  const uncodedByRange = new Map();
  const filteredActive = [];
  for (const reservation of activeReservations) {
    const key = `${reservation.unitId}:${reservation.checkIn}:${reservation.checkOut}`;
    const cancellationTimestamp = reservation.confirmationCode ? latestCancellationByCode.get(reservation.confirmationCode) : null;
    const confirmationTimestamp = reservation.confirmationTimestamp ?? reservation.sourceTimestamp ?? 0;
    if (cancellationTimestamp && cancellationTimestamp >= confirmationTimestamp) continue;

    const rangeCancellationTimestamp = latestCancellationByUnitRange.get(key);
    if (!reservation.confirmationCode && rangeCancellationTimestamp && rangeCancellationTimestamp >= (reservation.sourceTimestamp || 0)) continue;

    if (reservation.confirmationCode) {
      filteredActive.push(reservation);
      continue;
    }
    const existing = uncodedByRange.get(key);
    if (!existing || (reservation.sourceTimestamp || 0) > (existing.sourceTimestamp || 0)) uncodedByRange.set(key, reservation);
  }

  return [...filteredActive, ...uncodedByRange.values()].sort((a, b) => {
    if (a.unitId !== b.unitId) return a.unitId - b.unitId;
    if (a.checkIn !== b.checkIn) return a.checkIn.localeCompare(b.checkIn);
    return a.checkOut.localeCompare(b.checkOut);
  });
}

function reservationTouchesTarget(reservation, targetDate) {
  const checkIn = parseISODate(reservation.checkIn);
  const checkOut = parseISODate(reservation.checkOut);
  return compareDates(checkIn, targetDate) <= 0 && compareDates(checkOut, targetDate) >= 0;
}

export function classifyUnits(reservations, targetDate) {
  return UNITS.map((unit) => {
    const unitReservations = reservations.filter((reservation) => reservation.unitId === unit.id);
    const arrivals = unitReservations.filter((reservation) => reservation.checkIn === formatISODate(targetDate));
    const checkouts = unitReservations.filter((reservation) => reservation.checkOut === formatISODate(targetDate));
    const stayovers = unitReservations.filter((reservation) => {
      const checkIn = parseISODate(reservation.checkIn);
      const checkOut = parseISODate(reservation.checkOut);
      return compareDates(checkIn, targetDate) < 0 && compareDates(checkOut, targetDate) > 0;
    });
    const touches = unitReservations.filter((reservation) => reservationTouchesTarget(reservation, targetDate));

    let action = "empty";
    if (arrivals.length && checkouts.length) action = "turnover";
    else if (arrivals.length) action = "arrival";
    else if (checkouts.length) action = "checkout";
    else if (stayovers.length) action = "stayover";

    return {
      unit,
      action,
      arrivals,
      checkouts,
      stayovers,
      touches,
    };
  });
}

function hasAirbnbWork(unitReports) {
  return unitReports.some((report) => ["turnover", "arrival", "checkout"].includes(report.action));
}

function hasStayovers(unitReports) {
  return unitReports.some((report) => report.action === "stayover");
}

export async function fetchWeather(targetDate) {
  const url = new URL(WEATHER_FORECAST_URL);
  url.searchParams.set("latitude", String(WEATHER.latitude));
  url.searchParams.set("longitude", String(WEATHER.longitude));
  url.searchParams.set("hourly", "precipitation_probability,precipitation,weather_code");
  url.searchParams.set("timezone", "Africa/Johannesburg");
  url.searchParams.set("forecast_days", "4");

  let data = null;
  let lastError = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= WEATHER_MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(WEATHER_REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        const error = new Error(`Weather request failed: ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      data = await response.json();
      break;
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false;
      if (!retryable || attempt === WEATHER_MAX_ATTEMPTS) break;
      await wait(WEATHER_RETRY_DELAY_MS * (2 ** (attempt - 1)));
    }
  }

  if (!data) {
    return {
      available: false,
      attempts,
      error: lastError?.message ?? "Weather forecast unavailable",
      source: "open-meteo",
      location: WEATHER.label,
      rainPossible: null,
      rainSummary: "forecast temporarily unavailable",
      maxProbability: null,
      maxPrecipitation: null,
      dryingHoursCount: null,
    };
  }

  const target = formatISODate(targetDate);
  const hourly = data.hourly ?? {};
  const rows = (hourly.time ?? []).map((time, index) => ({
    time,
    probability: hourly.precipitation_probability?.[index] ?? null,
    precipitation: hourly.precipitation?.[index] ?? null,
    code: hourly.weather_code?.[index] ?? null,
  }));
  const dryingHours = rows.filter((row) => row.time.startsWith(`${target}T`) && Number(row.time.slice(11, 13)) >= 7 && Number(row.time.slice(11, 13)) <= 18);
  const targetHours = rows.filter((row) => row.time.startsWith(`${target}T`));
  const rainRows = dryingHours.filter((row) => {
    const probability = Number(row.probability ?? 0);
    const precipitation = Number(row.precipitation ?? 0);
    const weatherCode = Number(row.code ?? 0);
    return probability > 0 || precipitation > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(weatherCode);
  });
  const rainDayRows = targetHours.filter((row) => {
    const probability = Number(row.probability ?? 0);
    const precipitation = Number(row.precipitation ?? 0);
    const weatherCode = Number(row.code ?? 0);
    return probability > 0 || precipitation > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(weatherCode);
  });
  const maxProbability = Math.max(0, ...targetHours.map((row) => Number(row.probability ?? 0)));
  const maxPrecipitation = Math.max(0, ...targetHours.map((row) => Number(row.precipitation ?? 0)));

  return {
    available: true,
    attempts,
    error: null,
    source: "open-meteo",
    location: WEATHER.label,
    rainPossible: rainRows.length > 0,
    rainSummary: summariseRainTimes(rainDayRows),
    maxProbability,
    maxPrecipitation,
    dryingHoursCount: dryingHours.length,
  };
}

function wait(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function summariseRainTimes(rows) {
  if (!rows.length) return "none currently showing";
  const hours = rows
    .map((row) => Number(row.time.slice(11, 13)))
    .filter((hour) => Number.isFinite(hour))
    .sort((a, b) => a - b);
  if (!hours.length) return "rain possible";

  const ranges = [];
  let start = hours[0];
  let prev = hours[0];
  for (const hour of hours.slice(1)) {
    if (hour === prev + 1) {
      prev = hour;
      continue;
    }
    ranges.push([start, prev]);
    start = hour;
    prev = hour;
  }
  ranges.push([start, prev]);

  return ranges
    .map(([rangeStart, rangeEnd]) => {
      const endHour = Math.min(rangeEnd + 1, 24);
      return rangeStart === rangeEnd ? formatHourLabel(rangeStart) : formatHourRange(rangeStart, endHour);
    })
    .join(" and ");
}

function formatHourLabel(hour) {
  if (hour === 24) return "midnight";
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  const period = hour < 12 ? "a.m." : "p.m.";
  const hour12 = hour % 12 || 12;
  return `${hour12} ${period}`;
}

function formatHourRange(startHour, endHour) {
  if (endHour === 24) return `${formatHourLabel(startHour)}-midnight`;
  const startPeriod = startHour < 12 ? "a.m." : "p.m.";
  const endPeriod = endHour < 12 ? "a.m." : "p.m.";
  const startSpecial = startHour === 0 || startHour === 12 || startHour === 24;
  const endSpecial = endHour === 0 || endHour === 12 || endHour === 24;
  const start12 = startHour % 12 || 12;
  const end12 = endHour % 12 || 12;

  if (startPeriod === endPeriod && !startSpecial && !endSpecial) {
    return `${start12}-${end12} ${endPeriod}`;
  }

  return `${formatHourLabel(startHour)}-${formatHourLabel(endHour)}`;
}

function personLine(reservation) {
  const name = reservation.guestName || "guest name not found";
  const guests = reservation.guests || "guest count not found";
  return `${name} (${guests})`;
}

export function guestComposition(reservation) {
  const guests = reservation?.guests ?? "";
  const adultCount = sumMatches(guests, /(\d+)\s+adults?\b/gi);
  const childCount = sumMatches(guests, /(\d+)\s+(?:child|children)\b/gi);
  const infantCount = sumMatches(guests, /(\d+)\s+infants?\b/gi);
  const explicitGuestCount = sumMatches(guests, /(\d+)\s+guests?\b/gi);
  const mainGuestCount = adultCount + childCount || explicitGuestCount || 2;

  return {
    adultCount,
    childCount,
    infantCount,
    explicitGuestCount,
    mainGuestCount,
  };
}

export function guestCountLabel(reservation) {
  const count = guestComposition(reservation).mainGuestCount;
  return `${count} ${count === 1 ? "guest" : "guests"}`;
}

export function infantCountLabel(reservation) {
  const count = guestComposition(reservation).infantCount;
  if (!count) return "";
  return `${count} ${count === 1 ? "infant" : "infants"}`;
}

export function xhosaGuestCountLabel(reservation) {
  const count = guestComposition(reservation).mainGuestCount;
  return `${count} ${count === 1 ? "undwendwe" : "iindwendwe"}`;
}

export function xhosaInfantCountLabel(reservation) {
  const count = guestComposition(reservation).infantCount;
  if (!count) return "";
  return `${count} ${count === 1 ? "usana" : "iintsana"}`;
}

function sumMatches(value, pattern) {
  let total = 0;
  for (const match of String(value).matchAll(pattern)) {
    total += Number(match[1]);
  }
  return total;
}

export function buildUnitEnglish(report, operationalNotes = []) {
  const { unit, action, arrivals } = report;
  const lines = [unit.label];
  const notes = operationalNotes.filter((note) => Number(note.unitId) === Number(unit.id));
  const arrival = arrivals[0];
  const setupGuests = guestCountLabel(arrival);
  const setupLine = `${setupGuests}${arrival?.guestName ? `; ${arrival.guestName}` : ""}`;

  if (action === "turnover") {
    lines.push(`- ${setupLine}`);
    if (infantCountLabel(arrival)) lines.push(`- ${infantCountLabel(arrival)}`);
    for (const note of notes) lines.push(`- ${note.english}`);
    return lines.join("\n");
  }

  if (action === "arrival") {
    lines.push(`- ${setupLine}`);
    if (infantCountLabel(arrival)) lines.push(`- ${infantCountLabel(arrival)}`);
    for (const note of notes) lines.push(`- ${note.english}`);
    return lines.join("\n");
  }

  if (action === "checkout") {
    lines.push(`- ${setupGuests}`);
    for (const note of notes) lines.push(`- ${note.english}`);
    return lines.join("\n");
  }

  if (action === "stayover") {
    if (!notes.length) return "";
    for (const note of notes) lines.push(`- ${note.english}`);
    return lines.join("\n");
  }

  if (!notes.length) return "";
  for (const note of notes) lines.push(`- ${note.english}`);
  return lines.join("\n");
}

export function buildXhosaSummary(unitReports, weather, targetDate, operationalNotes = []) {
  const lines = ["*Xhosa:*"];
  const anyWork = hasAirbnbWork(unitReports);
  const anyStayover = hasStayovers(unitReports);
  const isTuesday = targetDate.getDay() === 2;

  if (anyWork) {
    lines.push("- Kukho ii-unit ekufuneka zenziwe.");
  } else if (isTuesday) {
    lines.push("- Akukho zi-unit ze-Airbnb ekufuneka zenziwe, kodwa kusekho umsebenzi wangoLwesibini.");
  } else if (anyStayover) {
    lines.push("- Iindwendwe zisahleli kuphela. Akukho zi-unit ze-Airbnb ekufuneka zenziwe.");
  } else {
    lines.push("- Akukho zi-unit ze-Airbnb ekufuneka zenziwe.");
  }

  for (const report of unitReports) {
    const label = `${report.unit.label}`;
    const notes = operationalNotes.filter((note) => Number(note.unitId) === Number(report.unit.id));
    if (report.action === "turnover") {
      const arrival = report.arrivals[0];
      lines.push(label);
      lines.push(`- ${xhosaGuestCountLabel(arrival)}${arrival?.guestName ? `; ${arrival.guestName}` : ""}.`);
      if (xhosaInfantCountLabel(arrival)) lines.push(`- ${xhosaInfantCountLabel(arrival)}.`);
      for (const note of notes) lines.push(`- ${note.xhosa}`);
    } else if (report.action === "arrival") {
      const arrival = report.arrivals[0];
      lines.push(label);
      lines.push(`- ${xhosaGuestCountLabel(arrival)}${arrival?.guestName ? `; ${arrival.guestName}` : ""}.`);
      if (xhosaInfantCountLabel(arrival)) lines.push(`- ${xhosaInfantCountLabel(arrival)}.`);
      for (const note of notes) lines.push(`- ${note.xhosa}`);
    } else if (report.action === "checkout") {
      lines.push(label);
      lines.push(`- ${xhosaGuestCountLabel(null)}.`);
      for (const note of notes) lines.push(`- ${note.xhosa}`);
    } else if (notes.length) {
      lines.push(label);
      for (const note of notes) lines.push(`- ${note.xhosa}`);
    }
  }

  if (!weather.available) {
    lines.push("*Imvula:* uqikelelo alufumaneki okwethutyana.");
  } else if (weather.rainPossible) {
    lines.push(`*Imvula:* ${weather.rainSummary.replace(/ and /g, " no ")}; ukuya ku-${weather.maxProbability}%.`);
  } else {
    lines.push("*Imvula:* ayibonakali ngoku.");
  }

  return lines.join("\n");
}

export function buildMessage({ targetDate, unitReports, weather, operationalNotes = [], isUpdate = false }) {
  const isTuesday = targetDate.getDay() === 2;
  const anyWork = hasAirbnbWork(unitReports);
  const anyStayover = hasStayovers(unitReports);
  const lines = [];

  lines.push(`${isUpdate ? "Updated Airbnb plan" : "Airbnb plan"} for *${displayDate(targetDate)}*`);
  lines.push("");

  if (!weather.available) {
    lines.push("*Rain:* forecast temporarily unavailable.");
  } else if (weather.rainPossible) {
    lines.push(`*Rain:* ${weather.rainSummary}; up to ${weather.maxProbability}% chance.`);
  } else {
    lines.push("*Rain:* none currently showing.");
  }
  lines.push("");

  lines.push("*English:*");
  if (!anyWork && isTuesday) {
    lines.push("- No Airbnb units need cleaning.");
    lines.push("- Tuesday: please still come for the normal Tuesday work.");
  } else if (!anyWork && anyStayover) {
    lines.push("- No Airbnb units need cleaning.");
    lines.push("- Please do not come unless Jane or Tristan says otherwise.");
  } else if (!anyWork) {
    lines.push("- No Airbnb units need cleaning.");
    lines.push("- Please do not come unless Jane or Tristan says otherwise.");
  }

  for (const report of unitReports) {
    const unitLine = buildUnitEnglish(report, operationalNotes);
    if (unitLine) lines.push(unitLine);
  }
  lines.push("");
  lines.push(buildXhosaSummary(unitReports, weather, targetDate, operationalNotes));
  lines.push("");
  lines.push(MESSAGE_FOOTER);

  return lines.join("\n");
}

function withLegacyFooter(message) {
  if (MESSAGE_FOOTER === LEGACY_MESSAGE_FOOTER) return message;
  return message.endsWith(MESSAGE_FOOTER)
    ? `${message.slice(0, -MESSAGE_FOOTER.length)}${LEGACY_MESSAGE_FOOTER}`
    : message;
}

export function planDelivery({ targetDate, unitReports, weather, operationalNotes = [], ledgerRecords }) {
  const targetDateKey = formatISODate(targetDate);
  const baseMessage = buildMessage({ targetDate, unitReports, weather, operationalNotes });
  const baseHash = messageHash(baseMessage);
  const legacyBaseHash = messageHash(withLegacyFooter(baseMessage));
  const duplicateBaseHashes = new Set([baseHash, legacyBaseHash]);
  const normalizedDuplicateBaseHashes = new Set([
    messageHash(normaliseChatText(baseMessage)),
    messageHash(normaliseChatText(withLegacyFooter(baseMessage))),
  ]);
  const latestForDate = latestRecordForDate(ledgerRecords, targetDateKey);
  const sameContentDuplicate = latestForDate && (
    duplicateBaseHashes.has(latestForDate.messageHash) ||
    normalizedDuplicateBaseHashes.has(latestForDate.normalizedMessageHash)
  )
    ? latestForDate
    : undefined;
  const previousForDate = Boolean(latestForDate);
  const isUpdate = Boolean(previousForDate && !sameContentDuplicate);
  const message = isUpdate
    ? buildMessage({ targetDate, unitReports, weather, operationalNotes, isUpdate: true })
    : baseMessage;
  const hash = messageHash(message);
  const legacyHash = messageHash(withLegacyFooter(message));
  const duplicateMessageHashes = new Set([hash, legacyHash]);
  const normalizedDuplicateMessageHashes = new Set([
    messageHash(normaliseChatText(message)),
    messageHash(normaliseChatText(withLegacyFooter(message))),
  ]);
  const duplicate =
    sameContentDuplicate ??
    (latestForDate && (
      duplicateMessageHashes.has(latestForDate.messageHash) ||
      normalizedDuplicateMessageHashes.has(latestForDate.normalizedMessageHash)
    ) ? latestForDate : undefined);
  const matchingRecords = ledgerRecords.filter((record) =>
    record.targetDate === targetDateKey && (
      duplicateMessageHashes.has(record.messageHash) ||
      normalizedDuplicateMessageHashes.has(record.normalizedMessageHash)
    )
  );
  const chatOccurrenceCount = matchingRecords.filter((record) => record.source === "whatsapp_chat").length;
  const ledgerOccurrenceCount = matchingRecords
    .filter((record) => record.source !== "whatsapp_chat")
    .reduce(
      (highest, record) => Math.max(highest, Number(record.contentOccurrence ?? 1)),
      0,
    );
  const deliveredOccurrence = Math.max(chatOccurrenceCount, ledgerOccurrenceCount);
  const contentOccurrence = duplicate
    ? Math.max(deliveredOccurrence, Number(duplicate.contentOccurrence ?? 1))
    : deliveredOccurrence + 1;

  return {
    targetDateKey,
    baseMessage,
    baseHash,
    legacyBaseHash,
    message,
    hash,
    legacyHash,
    contentOccurrence,
    isUpdate,
    duplicate,
  };
}

function comparableTimestamp(value) {
  if (value === null || value === undefined || value === "") return Number.NEGATIVE_INFINITY;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function latestRecordForDate(records, targetDateKey) {
  return records
    .map((record, index) => ({ record, index, timestamp: comparableTimestamp(record.sentAt) }))
    .filter(({ record }) => record.targetDate === targetDateKey)
    .reduce((latest, candidate) => {
      if (!latest) return candidate;
      if (candidate.timestamp > latest.timestamp) return candidate;
      if (candidate.timestamp === latest.timestamp && candidate.index > latest.index) return candidate;
      return latest;
    }, null)?.record;
}

export async function applyDelivery({
  mode,
  result,
  message,
  idempotencyKey,
  duplicate,
  duplicateChatVerified = true,
  whatsappSendFn = whatsappSend,
  verifyChatFn = null,
  appendLedgerFn = appendLedger,
  now = () => new Date(),
}) {
  if (mode === "dry-run" || mode === "live") {
    result.whatsappDryRun = await whatsappSendFn({ text: message, dryRun: true, idempotencyKey });
    result.status = "dry_run_ok";
  }

  if (mode === "live") {
    if (duplicate) {
      if (!duplicateChatVerified) {
        throw new Error("Ledger duplicate could not be confirmed in the cleaners chat.");
      }
      result.status = "duplicate_skipped";
      result.duplicateSource = duplicate.source ?? "ledger";
      result.whatsappVerification = { found: true, source: "pre_send_chat_read" };
      if (duplicate.source === "whatsapp_chat") {
        appendLedgerFn({
          targetDate: result.targetDate,
          messageHash: result.messageHash,
          contentOccurrence: result.contentOccurrence,
          sentAt: now().toISOString(),
          reconciledFrom: "whatsapp_chat",
        });
      }
    } else {
      result.whatsappLiveSend = await whatsappSendFn({ text: message, dryRun: false, idempotencyKey });
      if (verifyChatFn) {
        result.whatsappVerification = await verifyChatFn(message);
        if (!result.whatsappVerification?.found) {
          throw new Error("WhatsApp send was not confirmed by cleaners-chat readback.");
        }
      }
      result.status = "sent";
      appendLedgerFn({
        targetDate: result.targetDate,
        messageHash: result.messageHash,
        contentOccurrence: result.contentOccurrence,
        sentAt: now().toISOString(),
      });
    }
  }

  return result;
}

export function deliveryIdempotencyKey({ targetDate, chatId, messageHash: hash, contentOccurrence = 1 }) {
  if (!Number.isSafeInteger(contentOccurrence) || contentOccurrence < 1) {
    throw new Error("Delivery content occurrence must be a positive integer.");
  }
  const contentKey = `airbnb-cleaners:${formatISODate(targetDate)}:${chatId}:${hash}`;
  return contentOccurrence === 1 ? contentKey : `${contentKey}:occurrence-${contentOccurrence}`;
}

export function confidenceCheck({ reservations, unitReports, weather, envelopesRead, unmatchedUpdateCount = 0 }) {
  const blockers = [];
  const warnings = [];
  if (envelopesRead === 0) warnings.push("No target-date Airbnb reservation emails were found.");
  if (!weather.available) {
    warnings.push(`Weather forecast unavailable after ${weather.attempts} attempt${weather.attempts === 1 ? "" : "s"}; report can still be sent.`);
  } else if (weather.dryingHoursCount === 0) {
    warnings.push("Weather forecast did not include the target date's drying hours; report can still be sent.");
  }
  if (unmatchedUpdateCount > 0) {
    blockers.push("A reservation update is missing its confirmed booking anchor.");
  }

  for (const report of unitReports) {
    for (const reservation of [...report.arrivals, ...report.checkouts, ...report.stayovers]) {
      if (!reservation.checkIn || !reservation.checkOut) blockers.push(`${report.unit.label}: reservation date range is missing.`);
    }
    const legalOccupancy =
      (report.arrivals.length === 0 && report.checkouts.length === 0 && report.stayovers.length === 0) ||
      (report.arrivals.length === 1 && report.checkouts.length === 0 && report.stayovers.length === 0) ||
      (report.arrivals.length === 0 && report.checkouts.length === 1 && report.stayovers.length === 0) ||
      (report.arrivals.length === 0 && report.checkouts.length === 0 && report.stayovers.length === 1) ||
      (report.arrivals.length === 1 && report.checkouts.length === 1 && report.stayovers.length === 0);
    if (!legalOccupancy) {
      blockers.push(
        `${report.unit.label}: impossible occupancy overlap ` +
        `(arrivals=${report.arrivals.length}, checkouts=${report.checkouts.length}, stayovers=${report.stayovers.length}).`
      );
    }
  }

  const activeReservations = reservations.filter((reservation) =>
    unitReports.some((report) => report.touches.includes(reservation))
  );

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    activeReservationCount: activeReservations.length,
  };
}

function whatsappConfig(env = process.env) {
  const baseUrl = String(env.MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL ?? "").trim();
  const apiKey = String(env.MINCOOL_CUSTOMER_WHATSAPP_API_KEY ?? "").trim();
  const accountId = String(env.AIRBNB_WHATSAPP_ACCOUNT_ID ?? WHATSAPP_ACCOUNT_ID).trim();
  const chatId = String(env.AIRBNB_WHATSAPP_CHAT_ID ?? WHATSAPP_CHAT_ID).trim();
  if (!baseUrl || !apiKey || !accountId || !chatId) {
    throw new Error("WhatsApp configuration is incomplete.");
  }
  return { baseUrl, apiKey, accountId, chatId };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function whatsappSend(
  { text, dryRun, idempotencyKey, targetChatId = null },
  { env = process.env, fetchFn = fetch, waitFn = wait } = {}
) {
  const { baseUrl, apiKey, accountId, chatId } = whatsappConfig(env);
  const destinationChatId = targetChatId ?? chatId;
  const url = new URL(
    `/api/v1/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(destinationChatId)}/messages`,
    baseUrl
  );
  if (dryRun) url.searchParams.set("dry_run", "true");
  let lastError = null;
  const maxAttempts = dryRun ? WHATSAPP_MAX_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Min-API-Key": apiKey,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(WHATSAPP_REQUEST_TIMEOUT_MS),
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) {
        const error = new Error(`WhatsApp ${dryRun ? "dry-run" : "send"} failed with HTTP ${response.status}.`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return {
        status: response.status,
        mutatesWhatsappState: response.headers.get("x-min-mutates-whatsapp-state"),
        dryRun,
        attempts: attempt,
        body,
      };
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false;
      if (!retryable || attempt === maxAttempts) break;
      await waitFn(WHATSAPP_RETRY_DELAY_MS * (2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new Error(`WhatsApp ${dryRun ? "dry-run" : "send"} failed.`);
}

export async function sendFinalFailureAlert(
  { targetDate, reason = "delivery" },
  {
    env = process.env,
    whatsappSendFn = whatsappSend,
    fetchChatMessagesFn = fetchChatMessages,
  } = {},
) {
  const alertChatId = String(env.AIRBNB_WHATSAPP_ALERT_CHAT_ID ?? "").trim();
  const cleanersChatId = whatsappConfig(env).chatId;
  if (!alertChatId) throw new Error("Private failure-alert chat is not configured.");
  if (alertChatId === cleanersChatId) throw new Error("Failure alerts may not target the cleaners chat.");
  const incidentReason = reason === "database_sync" || reason === "blocked" ? reason : "delivery";
  const incidentId = `${incidentReason}:${targetDate}`;
  const text = reason === "database_sync"
    ? [
      `Airbnb cleaner plan was delivered for ${targetDate}, but its database mirror failed after the final retry.`,
      `Incident: ${incidentId}`,
      "The cleaners message remains valid. Check the private Fly status endpoint before stock forecasting.",
    ].join("\n")
    : reason === "blocked"
      ? [
        `Airbnb cleaner report was blocked after the final cloud retry for ${targetDate}.`,
        `Incident: ${incidentId}`,
        "Check the private Fly status endpoint and sanitized run receipt.",
      ].join("\n")
    : [
      `Airbnb cleaner report failed after the final cloud retry for ${targetDate}.`,
      `Incident: ${incidentId}`,
      "Check the private Fly status endpoint and sanitized run receipt.",
    ].join("\n");
  const idempotencyKey = `airbnb-cleaner-failure:${incidentId}`;
  await whatsappSendFn({ text, dryRun: true, idempotencyKey, targetChatId: alertChatId });
  const sent = await whatsappSendFn({ text, dryRun: false, idempotencyKey, targetChatId: alertChatId });
  const verification = await verifyChatMessage(text, {
    fetchMessagesFn: (limit) => fetchChatMessagesFn(limit, { env, targetChatId: alertChatId }),
  });
  if (!verification.found) throw new Error("Private cleaner failure alert was not found in chat readback.");
  return {
    sent: true,
    incidentId,
    attempts: sent.attempts,
    verifiedFromChat: true,
    verificationAttempts: verification.attempts,
  };
}

export async function fetchChatMessages(
  limit = CHAT_RECONCILIATION_LIMIT,
  { env = process.env, fetchFn = fetch, waitFn = wait, targetChatId = null } = {}
) {
  const { baseUrl, apiKey, accountId, chatId } = whatsappConfig(env);
  const destinationChatId = targetChatId ?? chatId;
  const url = new URL(
    `/api/v1/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(destinationChatId)}/messages`,
    baseUrl
  );
  url.searchParams.set("limit", String(limit));
  let lastError = null;
  for (let attempt = 1; attempt <= WHATSAPP_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        headers: { "X-Min-API-Key": apiKey },
        signal: AbortSignal.timeout(WHATSAPP_READ_TIMEOUT_MS),
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) {
        const error = new Error(`WhatsApp chat read failed with HTTP ${response.status}.`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return Array.isArray(body?.messages) ? body.messages : [];
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false;
      if (!retryable || attempt === WHATSAPP_MAX_ATTEMPTS) break;
      await waitFn(WHATSAPP_RETRY_DELAY_MS * (2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new Error("WhatsApp chat read failed.");
}

export function messageHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function normaliseChatText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function chatLedgerRecords(messages, targetDate) {
  const dateLabel = displayDate(targetDate);
  return messages.flatMap((message) => {
    if (message.from_me !== true) return [];
    const text = String(message.text ?? "");
    const plain = normaliseChatText(text).replace(/\*/g, "");
    const matchesDate =
      plain.includes(`Airbnb plan for ${dateLabel}`) ||
      plain.includes(`Updated Airbnb plan for ${dateLabel}`);
    if (!matchesDate) return [];
    return [{
      targetDate: formatISODate(targetDate),
      messageHash: messageHash(text),
      normalizedMessageHash: messageHash(normaliseChatText(text)),
      source: "whatsapp_chat",
      sentAt: message.timestamp ?? null,
    }];
  });
}

export function chatContainsMessage(messages, expectedMessage) {
  const expected = normaliseChatText(expectedMessage);
  const legacyExpected = normaliseChatText(withLegacyFooter(expectedMessage));
  const expectedDateLabel = planDateLabel(expectedMessage);
  if (!expectedDateLabel) {
    return messages.some((message) => {
      if (message.from_me !== true) return false;
      const actual = normaliseChatText(message.text ?? "");
      return actual === expected || actual === legacyExpected;
    });
  }
  const candidates = messages
    .map((message, index) => ({ message, index, timestamp: comparableTimestamp(message.timestamp) }))
    .filter(({ message }) => message.from_me === true && planDateLabel(message.text) === expectedDateLabel);
  const latest = candidates.reduce((current, candidate) => {
    if (!current) return candidate;
    if (candidate.timestamp > current.timestamp) return candidate;
    if (candidate.timestamp === current.timestamp && candidate.index > current.index) return candidate;
    return current;
  }, null)?.message;
  if (!latest) return false;
  return [latest].some((message) => {
    const actual = normaliseChatText(message.text ?? "");
    return actual === expected || actual === legacyExpected;
  });
}

function planDateLabel(text) {
  const plain = normaliseChatText(text).replace(/\*/g, "");
  return plain.match(/^(?:Updated )?Airbnb plan for (.+?)(?=\s+(?:Rain|English|Xhosa):|$)/)?.[1] ?? null;
}

export async function verifyChatMessage(
  expectedMessage,
  { fetchMessagesFn = fetchChatMessages, attempts = 4, delayMs = 1500 } = {}
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const messages = await fetchMessagesFn(CHAT_RECONCILIATION_LIMIT);
    if (chatContainsMessage(messages, expectedMessage)) {
      return { found: true, attempts: attempt };
    }
    if (attempt < attempts) await wait(delayMs * attempt);
  }
  return { found: false, attempts };
}

export function loadLedgerRecords() {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function appendLedger(record) {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  appendFileSync(LEDGER_PATH, `${JSON.stringify(record)}\n`);
}

export async function collectReservations(
  targetDate,
  searchDays,
  maxRead,
  collectMessagesFn = collectAirbnbMessages,
  futureHorizonDays = 8
) {
  const afterDate = formatISODate(addDays(targetDate, -searchDays));
  const horizonDates = Array.from(
    { length: Math.max(1, futureHorizonDays) },
    (_, index) => addDays(targetDate, index),
  );
  const collected = await collectMessagesFn({
    afterDate,
    maxRead,
    candidateEnvelope,
    subjectMayTouchTarget: (subject) => horizonDates.some((date) => subjectMayTouchTarget(subject, date)),
    describeEvidence: ({ envelope, body }) => {
      const evidenceKind = reservationEvidenceKind(envelope.subject, body);
      const parsed = body ? parseReservation(envelope, body, targetDate) : null;
      return {
        evidenceKind,
        evidenceSubtype: reservationEvidenceSubtype(envelope.subject, body, evidenceKind),
        confirmationCode: extractConfirmationCode(body),
        providerThreadId: parsed?.providerThreadId ?? "",
        guestCountChangeAccepted: parsed?.guestCountChangeAccepted === true,
        listingName: parsed?.listingName ?? "",
      };
    },
  });
  const parsed = [];
  for (const { envelope, body } of collected.messages) {
    const reservation = parseReservation(envelope, body, targetDate);
    if (reservation) parsed.push(reservation);
  }

  const confirmedCodes = new Set(
    parsed
      .filter((reservation) => reservation.evidenceKind === "confirmed" && reservation.confirmationCode)
      .map((reservation) => reservation.confirmationCode)
  );
  const unmatchedUpdateCount = new Set(
    parsed
      .filter((reservation) =>
        reservation.evidenceKind === "supplemental" &&
        reservation.evidenceSubtype === "update" &&
        reservation.confirmationCode &&
        (!reservation.unitId || !reservation.checkIn || !reservation.checkOut || reservationTouchesTarget(reservation, targetDate)) &&
        !confirmedCodes.has(reservation.confirmationCode)
      )
      .map((reservation) => reservation.confirmationCode)
  ).size;

  return {
    reservations: mergeReservations(parsed),
    evidence: parsed,
    envelopesFound: collected.envelopesFound,
    envelopesRead: collected.messages.length,
    unmatchedUpdateCount,
    afterDate,
  };
}

export async function runReport({
  mode = "preview",
  target = "auto",
  targetDate: requestedTargetDate = null,
  searchDays = 90,
  maxRead = 80,
  collectMessagesFn = collectAirbnbMessages,
  fetchWeatherFn = fetchWeather,
  fetchChatMessagesFn = fetchChatMessages,
  whatsappSendFn = whatsappSend,
  verifyChatFn = null,
  loadLedgerRecordsFn = loadLedgerRecords,
  authoritativeLedgerRecords = null,
  operationalNotes = [],
  appendLedgerFn = appendLedger,
  now = () => new Date(),
  workDir = WORK_DIR,
} = {}) {
  if (!["preview", "dry-run", "live"].includes(mode)) throw new Error("Invalid report mode.");
  if (!["auto", "today", "tomorrow"].includes(target)) throw new Error("Invalid report target.");
  const targetDate = resolveTargetDate({ target, targetDate: requestedTargetDate, now: now() });
  mkdirSync(workDir, { recursive: true });

  const collected = await collectReservations(targetDate, searchDays, maxRead, collectMessagesFn);
  const weather = await fetchWeatherFn(targetDate);
  const unitReports = classifyUnits(collected.reservations, targetDate);
  const ledgerRecords = authoritativeLedgerRecords ?? loadLedgerRecordsFn();
  let chatMessages = [];
  if (mode === "dry-run" || mode === "live") {
    chatMessages = await fetchChatMessagesFn(CHAT_RECONCILIATION_LIMIT);
  }
  const delivery = planDelivery({
    targetDate,
    unitReports,
    weather,
    operationalNotes,
    ledgerRecords: [...ledgerRecords, ...chatLedgerRecords(chatMessages, targetDate)],
  });
  const {
    baseHash,
    legacyBaseHash,
    message,
    hash,
    legacyHash,
    contentOccurrence,
    isUpdate,
    duplicate,
  } = delivery;
  const confidence = confidenceCheck({
    reservations: collected.reservations,
    unitReports,
    weather,
    envelopesRead: collected.envelopesRead,
    unmatchedUpdateCount: collected.unmatchedUpdateCount,
  });
  const chatIdForKey = mode === "preview" ? "preview" : whatsappConfig().chatId;
  const idempotencyKey = deliveryIdempotencyKey({
    targetDate,
    chatId: chatIdForKey,
    messageHash: hash,
    contentOccurrence,
  });

  const result = {
    status: "preview",
    mode,
    targetDate: formatISODate(targetDate),
    targetDay: WEEKDAY_NAMES[targetDate.getDay()],
    chatName: WHATSAPP_CHAT_NAME,
    unitReports: unitReports.map((report) => ({
      unit: report.unit.label,
      commonName: report.unit.commonName,
      action: report.action,
      arrivals: report.arrivals.map(personLine),
      checkouts: report.checkouts.map(personLine),
      stayovers: report.stayovers.map(personLine),
    })),
    operationalNotes: operationalNotes.map((note) => ({
      unitId: Number(note.unitId),
      requestType: note.requestType,
      effectiveTime: note.effectiveTime,
    })),
    reservationsParsed: collected.reservations.length,
    envelopesFound: collected.envelopesFound,
    envelopesRead: collected.envelopesRead,
    searchAfterDate: collected.afterDate,
    weather: {
      available: weather.available,
      attempts: weather.attempts,
      error: weather.error,
      rainPossible: weather.rainPossible,
      rainSummary: weather.rainSummary,
      maxProbability: weather.maxProbability,
      maxPrecipitation: weather.maxPrecipitation,
      source: weather.source,
      location: weather.location,
    },
    confidence,
    messageHash: hash,
    legacyMessageHash: legacyHash,
    baseMessageHash: baseHash,
    legacyBaseMessageHash: legacyBaseHash,
    contentOccurrence,
    isUpdate,
    idempotencyKey,
    message,
    chatRead: mode === "preview" ? null : { ok: true, messageCount: chatMessages.length },
    reservations: collected.reservations,
    reservationEvidence: collected.evidence,
    ledger: {
      authority: authoritativeLedgerRecords === null ? "volume" : "supabase",
      recordCount: ledgerRecords.length,
    },
  };

  if (!confidence.ok) {
    result.status = "blocked";
    return result;
  }

  await applyDelivery({
    mode,
    result,
    message,
    idempotencyKey,
    duplicate,
    duplicateChatVerified: !duplicate || chatContainsMessage(chatMessages, message),
    whatsappSendFn,
    verifyChatFn: verifyChatFn ?? ((expected) => verifyChatMessage(expected, { fetchMessagesFn: fetchChatMessagesFn })),
    appendLedgerFn,
    now,
  });

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runReport({
    mode: args.mode,
    target: args.target,
    targetDate: args.targetDate,
    searchDays: args.searchDays,
    maxRead: args.maxRead,
  });

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  if (result.status === "blocked") process.exitCode = 2;
}

function printHuman(result) {
  console.log(`STATUS: ${result.status}`);
  console.log(`TARGET_DATE: ${result.targetDate} (${result.targetDay})`);
  console.log(`CHAT: ${result.chatName}`);
  console.log(`CONFIDENCE: ${result.confidence.ok ? "ok" : "blocked"}`);
  if (!result.confidence.ok) {
    console.log(`BLOCKERS: ${result.confidence.blockers.join("; ")}`);
  }
  if (result.confidence.warnings?.length) {
    console.log(`WARNINGS: ${result.confidence.warnings.join("; ")}`);
  }
  if (result.whatsappDryRun) {
    console.log(`WHATSAPP_DRY_RUN: ok (mutates=${result.whatsappDryRun.mutatesWhatsappState ?? "unknown"})`);
  }
  if (result.whatsappLiveSend) {
    console.log(`WHATSAPP_LIVE_SEND: ok (mutates=${result.whatsappLiveSend.mutatesWhatsappState ?? "unknown"})`);
  }
  console.log(`EMAILS: found=${result.envelopesFound} read=${result.envelopesRead} parsed=${result.reservationsParsed} after=${result.searchAfterDate}`);
  if (result.weather.available) {
    console.log(`WEATHER: rainPossible=${result.weather.rainPossible} maxProbability=${result.weather.maxProbability}% attempts=${result.weather.attempts}`);
  } else {
    console.log(`WEATHER: unavailable after ${result.weather.attempts} attempts (${result.weather.error})`);
  }
  console.log("\nMESSAGE:\n");
  console.log(result.message);
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) main().catch((error) => {
  const failure = {
    status: "error",
    message: error.message,
    stack: process.env.DEBUG ? error.stack : undefined,
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(failure, null, 2));
  else {
    console.error(`ERROR: ${error.message}`);
  }
  process.exitCode = 1;
});

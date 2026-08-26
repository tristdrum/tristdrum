import { propertyForListing } from "./properties.mjs";

const MONTHS = Object.freeze(new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9], ["oct", 10],
  ["october", 10], ["nov", 11], ["november", 11], ["dec", 12], ["december", 12],
]));

function isoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cleanName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "");
}

function dateRange(text, occurredAt) {
  const match = /\b([A-Za-z]{3,9})\s+(\d{1,2})\s*[\u2013\u2014-]\s*(?:([A-Za-z]{3,9})\s+)?(\d{1,2})\b/i.exec(text);
  if (!match) return null;
  const checkInMonth = MONTHS.get(match[1].toLowerCase());
  const checkOutMonth = MONTHS.get((match[3] ?? match[1]).toLowerCase());
  if (!checkInMonth || !checkOutMonth) return null;
  const eventDate = new Date(occurredAt);
  if (!Number.isFinite(eventDate.getTime())) return null;
  let checkInYear = eventDate.getUTCFullYear();
  if (checkInMonth === 1 && eventDate.getUTCMonth() === 11) checkInYear += 1;
  if (checkInMonth === 12 && eventDate.getUTCMonth() === 0) checkInYear -= 1;
  const checkOutYear = checkOutMonth < checkInMonth ? checkInYear + 1 : checkInYear;
  return {
    checkIn: isoDate(checkInYear, checkInMonth, Number(match[2])),
    checkOut: isoDate(checkOutYear, checkOutMonth, Number(match[4])),
  };
}

export function isAirbnbBookingLifecycleSubject(subject) {
  return /\brequest at .+ dismissed\s*-\s*no payment\b/i.test(String(subject ?? "").normalize("NFKC"));
}

export function parseAirbnbBookingLifecycleEmail(email) {
  const sender = String(email?.from ?? "").trim().toLowerCase();
  const subject = String(email?.subject ?? "").normalize("NFKC");
  const body = String(email?.body ?? "").normalize("NFKC");
  if (sender !== "automated@airbnb.com" || !isAirbnbBookingLifecycleSubject(subject)) return null;
  if (!/didn['’]t receive payment|automatically declined/i.test(body)) return null;

  const property = propertyForListing(`${subject}\n${body}`);
  const stay = dateRange(`${subject}\n${body}`, email.occurredAt);
  const guestName = cleanName(/didn['’]t receive payment from\s+(.+?)\s+for\s+(?:their|the)\b/i.exec(body)?.[1]);
  if (!property || !stay || !guestName) return null;

  return {
    kind: "request_expired",
    reason: "nonpayment",
    guestName,
    unitNumber: property.unitNumber,
    listingName: property.listingName,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  };
}


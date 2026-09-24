import { propertyForListing } from "@tristdrum/airbnb-core";

const MAX_AGE_MS = 5 * 60 * 1000;

/**
 * @typedef {{ listingName: string, checkIn: string, checkOut: string }} WebsiteStay
 * @typedef {{ status: 'confirmed'|'pending'|'cancelled', listingName: string,
 *   checkIn: string, checkOut: string, verified: boolean, complete: boolean }} WebsiteReservation
 * @typedef {{ listingName: string, checkIn: string, checkOut: string,
 *   status: 'available'|'unavailable', verified: boolean, complete: boolean }} WebsiteCalendar
 * @typedef {{ source: 'airbnb_ui', providerThreadId: string, observedAt: string, requestedStay?: WebsiteStay,
 *   reservation?: WebsiteReservation, calendar?: WebsiteCalendar }} LiveWebsiteFacts
 */

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
    ? value : null;
}

function stay(value, expectedListing) {
  if (value?.listingName !== expectedListing) return null;
  const checkIn = date(value?.checkIn);
  const checkOut = date(value?.checkOut);
  return checkIn && checkOut && checkOut > checkIn
    ? { listingName: expectedListing, checkIn, checkOut }
    : null;
}

/** Keep only fresh, complete, explicitly verified UI observations bound to this listing. */
export function verifiedLiveWebsiteFacts(value, { providerThreadId, listingName, now = new Date() } = {}) {
  if (!value || typeof value !== "object" || value.source !== "airbnb_ui") return null;
  if (!providerThreadId || value.providerThreadId !== providerThreadId) return null;
  const property = propertyForListing(listingName);
  if (!property || typeof value.observedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.observedAt)) return null;
  const observedAt = new Date(value.observedAt);
  const age = new Date(now).getTime() - observedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;

  const reservationStay = stay(value.reservation, property.listingName);
  const reservation = value.reservation?.verified === true
    && value.reservation?.complete === true
    && ["confirmed", "pending", "cancelled"].includes(value.reservation.status)
    && reservationStay
    ? { ...reservationStay, status: value.reservation.status, verified: true, complete: true }
    : null;

  const requestedStay = stay(value.requestedStay, property.listingName);
  const calendarStay = stay(value.calendar, property.listingName);
  const calendar = value.calendar?.verified === true
    && value.calendar?.complete === true
    && ["available", "unavailable"].includes(value.calendar.status)
    && requestedStay
    && requestedStay.checkIn === calendarStay?.checkIn
    && requestedStay.checkOut === calendarStay?.checkOut
    ? { ...calendarStay, status: value.calendar.status, verified: true, complete: true }
    : null;

  return reservation || calendar ? {
    source: "airbnb_ui",
    observedAt: observedAt.toISOString(),
    freshness: "fresh",
    reservation,
    calendar,
  } : null;
}

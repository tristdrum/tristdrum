import assert from "node:assert/strict";
import test from "node:test";

import { verifiedLiveWebsiteFacts } from "./live-website-facts.mjs";

const now = new Date("2026-09-24T10:05:00.000Z");
const listingName = "Jasmine Studio Stay";
const providerThreadId = "airbnb-thread-1";
const reservationCode = "TESTCODE1";
const stay = { listingName, checkIn: "2026-10-05", checkOut: "2026-10-07" };
const context = { providerThreadId, reservationCode, listingName,
  requestedCheckIn: stay.checkIn, requestedCheckOut: stay.checkOut, now };
const snapshot = {
  source: "airbnb_ui",
  providerThreadId,
  observedAt: "2026-09-24T10:04:00.000Z",
  reservation: { ...stay, reservationCode, status: "confirmed", verified: true, complete: true },
  calendar: { ...stay, status: "available", verified: true, complete: true },
};

test("only exact fresh verified UI facts enter the support context", () => {
  assert.deepEqual(verifiedLiveWebsiteFacts(snapshot, context), {
    source: "airbnb_ui",
    observedAt: snapshot.observedAt,
    freshness: "fresh",
    reservation: snapshot.reservation,
    calendar: snapshot.calendar,
  });
  for (const change of [
    { source: "public_link" },
    { observedAt: "2026-09-24T09:59:59.000Z" },
    { observedAt: "2026-09-24T10:05:01.000Z" },
    { observedAt: "invalid" },
  ]) {
    assert.equal(verifiedLiveWebsiteFacts({ ...snapshot, ...change }, context), null);
  }
  assert.equal(verifiedLiveWebsiteFacts({ ...snapshot, providerThreadId: "another-thread" }, context), null);
  assert.equal(verifiedLiveWebsiteFacts(snapshot, { ...context, listingName: "Jasmine" }), null);
  assert.equal(verifiedLiveWebsiteFacts(snapshot, { ...context, listingName: "Jasmine Studio Stay " }), null);
  assert.equal(verifiedLiveWebsiteFacts(snapshot, { ...context, reservationCode: "OTHERTEST" }).reservation, null);
  assert.equal(verifiedLiveWebsiteFacts(snapshot, { ...context, reservationCode: null }).reservation, null);
  assert.equal(verifiedLiveWebsiteFacts(snapshot, { ...context, reservationCode: " " }).reservation, null);
});

test("partial or unverified facets cannot authorize a claim; valid facets remain independent", () => {
  for (const reservation of [
    { ...snapshot.reservation, verified: false },
    { ...snapshot.reservation, reservationCode: "OTHERTEST" },
    { ...snapshot.reservation, complete: false },
    { ...snapshot.reservation, status: "unknown" },
    { ...snapshot.reservation, listingName: "The Spekboom Studio" },
    { ...snapshot.reservation, checkOut: "2026-10-05" },
    { ...snapshot.reservation, checkIn: "2026-10-32" },
  ]) {
    const result = verifiedLiveWebsiteFacts({ ...snapshot, reservation }, context);
    assert.equal(result.reservation, null);
    assert.deepEqual(result.calendar, snapshot.calendar);
  }
  for (const calendar of [
    { ...snapshot.calendar, verified: false },
    { ...snapshot.calendar, complete: false },
    { ...snapshot.calendar, status: "unknown" },
    { ...snapshot.calendar, listingName: "The Spekboom Studio" },
    { ...snapshot.calendar, checkOut: "2026-10-08" },
  ]) {
    const result = verifiedLiveWebsiteFacts({ ...snapshot, calendar }, context);
    assert.equal(result.calendar, null);
    assert.deepEqual(result.reservation, snapshot.reservation);
  }
  assert.equal(verifiedLiveWebsiteFacts({ ...snapshot, reservation: null },
    { ...context, requestedCheckIn: null }), null);
});

test("calendar facts require caller-owned exact dates, regardless of payload claims", () => {
  for (const change of [
    { requestedCheckIn: null },
    { requestedCheckOut: null },
    { requestedCheckIn: "2026-10-06" },
    { requestedCheckOut: "2026-10-08" },
    { requestedCheckIn: "2026-10-32" },
  ]) {
    const result = verifiedLiveWebsiteFacts(snapshot, { ...context, ...change });
    assert.equal(result.calendar, null);
    assert.deepEqual(result.reservation, snapshot.reservation);
  }
  const selfConsistentButWrong = {
    ...snapshot,
    requestedStay: { ...stay, checkIn: "2026-10-08", checkOut: "2026-10-10" },
    calendar: { ...snapshot.calendar, checkIn: "2026-10-08", checkOut: "2026-10-10" },
  };
  assert.equal(verifiedLiveWebsiteFacts(selfConsistentButWrong, context).calendar, null);
});

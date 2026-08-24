import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuestTimeRequest,
  captureGuestTimeRequest,
  cleanerReadyConfirmation,
  cleanerTimingMessage,
  cleanerTimingWithdrawalMessage,
  stayStartDate,
  withdrawGuestTimeRequest,
} from "./operations.mjs";

function fakeSql(results) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return results.shift() ?? [];
  };
  sql.json = (value) => value;
  sql.calls = calls;
  return sql;
}

const candidate = {
  id: "thread-1",
  propertyId: "property-3",
  reservationId: null,
  sourceFingerprint: "fingerprint-1",
  listingName: "Jasmine Studio Stay",
  guestDisplayName: "Guest",
  stayLabel: "Aug 25 - 26, 2026",
  latestEventAt: "2026-08-24T10:00:00Z",
};

test("stay labels become a stable local arrival date", () => {
  assert.equal(stayStartDate("Aug 25 - 26, 2026", new Date("2026-08-24T10:00:00Z")), "2026-08-25");
  assert.equal(stayStartDate("Jan 2 - 3", new Date("2026-12-30T10:00:00Z")), "2027-01-02");
  assert.equal(stayStartDate("unknown", new Date()), null);
});

test("an accepted early check-in becomes one bilingual cleaner instruction", () => {
  const request = buildGuestTimeRequest({
    candidate,
    decision: {
      requestType: "early_checkin",
      action: "accept_conditional",
      requestedTime: "13:00",
      effectiveTime: "13:00",
      createsOperationalRequest: true,
    },
  });
  assert.equal(request.unitNumber, 3);
  assert.equal(request.stayDate, "2026-08-25");
  assert.equal(request.readinessCheckAt, "2026-08-25T10:00:00.000Z");
  const message = cleanerTimingMessage(request);
  assert.match(message, /Unit 3\n- Early check-in requested for 13:00/);
  assert.match(message, /\*Xhosa:\*\nUnit 3\n- Kucelwe ukungena kwangethuba/);
  assert.match(cleanerTimingMessage(request, { isUpdate: true }), /^Updated Airbnb timing for /);
});

test("capturing a time request verifies one cleaner notification and skips an existing one", async () => {
  const sql = fakeSql([
    [{ id: "request-1", status: "accepted", cleanersNotifiedAt: null }],
    [{ id: "request-1", status: "cleaners_notified", cleanersNotifiedAt: "2026-08-24T10:00:00Z" }],
  ]);
  let sends = 0;
  const outcome = await captureGuestTimeRequest({
    sql,
    householdId: "household-1",
    candidate,
    decision: {
      requestType: "late_checkout",
      action: "accept",
      requestedTime: "11:00",
      effectiveTime: "11:00",
      createsOperationalRequest: true,
    },
    now: new Date("2026-08-24T10:00:00Z"),
    env: { AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us" },
    sendGroupMessage: async ({ chatId, idempotencyKey }) => {
      sends += 1;
      assert.equal(chatId, "cleaners@g.us");
      assert.equal(idempotencyKey, "airbnb-support:cleaners:time:request-1");
      return { live: { providerMessageId: "provider-1" }, verification: { found: true } };
    },
  });
  assert.deepEqual(outcome, { status: "notified", requestId: "request-1", verified: true });
  assert.equal(sends, 1);

  const duplicateSql = fakeSql([[
    { id: "request-1", status: "cleaners_notified", cleanersNotifiedAt: "2026-08-24T10:00:00Z" },
  ]]);
  const duplicate = await captureGuestTimeRequest({
    sql: duplicateSql,
    householdId: "household-1",
    candidate,
    decision: {
      requestType: "late_checkout",
      action: "accept",
      requestedTime: "11:00",
      effectiveTime: "11:00",
      createsOperationalRequest: true,
    },
    now: new Date("2026-08-24T10:00:00Z"),
    env: { AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us" },
    sendGroupMessage: async () => { throw new Error("duplicate must not send"); },
  });
  assert.equal(duplicate.status, "already_notified");
});

test("a replacement timing request is clearly labelled as an update", async () => {
  const sql = fakeSql([
    [{ id: "request-2", status: "accepted", cleanersNotifiedAt: null, replacesPrevious: true }],
    [{ id: "request-2", status: "cleaners_notified", cleanersNotifiedAt: "2026-08-24T10:00:00Z" }],
  ]);
  let sentText = null;
  await captureGuestTimeRequest({
    sql,
    householdId: "household-1",
    candidate: { ...candidate, sourceFingerprint: "fingerprint-2" },
    decision: {
      requestType: "early_checkin",
      action: "accept_conditional",
      requestedTime: "14:00",
      effectiveTime: "14:00",
      createsOperationalRequest: true,
    },
    now: new Date("2026-08-24T10:00:00Z"),
    env: { AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us" },
    sendGroupMessage: async ({ text }) => {
      sentText = text;
      return { live: { providerMessageId: "provider-2" }, verification: { found: true } };
    },
  });
  assert.match(sentText, /^Updated Airbnb timing for /);
});

test("returning to standard time retracts and replaces the cleaner instruction", async () => {
  const active = {
    id: "request-1",
    stayDate: "2026-08-25",
    requestType: "early_checkin",
    effectiveTime: "13:00",
    unitNumber: 3,
  };
  const decision = {
    requestType: "early_checkin",
    action: "standard_time",
    effectiveTime: "15:00",
  };
  assert.match(cleanerTimingWithdrawalMessage(active, decision), /no longer applies/);
  const sql = fakeSql([[active], [{ id: active.id }]]);
  let sentText = null;
  const outcome = await withdrawGuestTimeRequest({
    sql,
    householdId: "household-1",
    candidate: { ...candidate, sourceFingerprint: "fingerprint-2" },
    decision,
    now: new Date("2026-08-24T10:00:00Z"),
    env: { AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us" },
    sendGroupMessage: async ({ text }) => {
      sentText = text;
      return { verification: { found: true } };
    },
  });
  assert.match(sentText, /^Updated Airbnb timing for /);
  assert.deepEqual(outcome, { status: "cancelled", cancelledCount: 1, verified: true });
});

test("only an explicit post-prompt unit-ready reply confirms readiness", () => {
  const request = {
    unitNumber: 3,
    commonName: "Jasmine",
    readinessPromptedAt: "2026-08-25T10:00:00.000Z",
  };
  const message = (text, occurredAt = "2026-08-25T10:01:00.000Z") => ({
    fromMe: false,
    text,
    transcript: "",
    occurredAt,
  });
  assert.equal(cleanerReadyConfirmation(message("Unit 3 ready"), request), true);
  assert.equal(cleanerReadyConfirmation(message("Yes, Jasmine is ready now"), request), true);
  assert.equal(cleanerReadyConfirmation(message("Unit 3 is not ready"), request), false);
  assert.equal(cleanerReadyConfirmation(message("Unit 3 will be ready"), request), false);
  assert.equal(cleanerReadyConfirmation(message("Unit 3 ready", "2026-08-25T09:59:00.000Z"), request), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import {
  buildGuestTimeRequest,
  captureGuestTimeRequest,
  cleanerReadyConfirmation,
  cleanerTimingMessage,
  cleanerTimingWithdrawalMessage,
  stayStartDate,
  withdrawGuestTimeRequest,
} from "./operations.mjs";
import { supportBagDropRequestDecision } from "@tristdrum/airbnb-core";
import { loadShadowCandidates } from "./repository.mjs";

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

test("an accepted bag drop becomes one bilingual dated cleaner instruction", () => {
  const request = buildGuestTimeRequest({
    candidate,
    decision: {
      requestType: "bag_drop",
      action: "accept_after_checkout",
      requestedTime: "10:00",
      effectiveTime: "10:00",
      createsOperationalRequest: true,
    },
  });
  assert.equal(request.unitNumber, 3);
  assert.equal(request.stayDate, "2026-08-25");
  assert.equal(request.readinessCheckAt, null);
  assert.match(request.cleanerNoteEn, /after the previous guest has actually checked out/i);
  assert.match(request.cleanerNoteEn, /luggage only; no room access/i);
  assert.match(request.cleanerNoteXh, /Ukushiya iibhegi kulindeleke/);
  assert.match(request.cleanerNoteXh, /akukho kungena egumbini/);
  const message = cleanerTimingMessage(request);
  assert.match(message, /^Airbnb bag-drop update for /);
  assert.match(message, /\*Xhosa:\*\nUnit 3\n- Ukushiya iibhegi/);
});

const officeFacts = {
  officeLuggageStorage: { allowed: true, location: "Office by the car park, through the glass doors" },
};
const officeDecision = (date = "2026-08-26", dropTime = null) => supportBagDropRequestDecision(
  "We will leave our bags in the office.", officeFacts, { date, dropTime },
);

test("office notes use the actual arrangement date and never manufacture a drop-off time or readiness check", () => {
  for (const date of ["2026-08-24", "2026-08-26", "2026-08-28"]) {
    const request = buildGuestTimeRequest({ candidate, decision: officeDecision(date) });
    assert.equal(request.stayDate, date);
    assert.equal(request.requestedTime, null);
    assert.equal(request.effectiveTime, null);
    assert.equal(request.readinessCheckAt, null);
    assert.match(request.cleanerNoteEn, /Office by the car park, through the glass doors/);
    assert.match(request.cleanerNoteEn, /Drop-off time not specified/);
    assert.match(request.cleanerNoteEn, /no studio entry or checkout extension/);
    assert.match(request.cleanerNoteXh, /e-ofisini.*iingcango|e-ofisini.*ngeengcango zeglasi/);
    assert.match(request.cleanerNoteXh, /Ixesha lokushiya iibhegi alichazwanga/);
    assert.doesNotMatch(cleanerTimingMessage(request), /10:00|00:00|previous guest|undefined|null/);
  }
  const timed = buildGuestTimeRequest({ candidate, decision: officeDecision("2026-08-26", "08:30") });
  assert.equal(timed.effectiveTime, "08:30");
  assert.equal(timed.readinessCheckAt, null);
  assert.match(timed.cleanerNoteEn, /Drop-off at 08:30/);
  assert.match(timed.cleanerNoteXh, /ngo-08:30/);
  assert.equal(buildGuestTimeRequest({ candidate, decision: officeDecision(null) }), null);
  assert.equal(buildGuestTimeRequest({ candidate, decision: {
    ...officeDecision(null), createsOperationalRequest: true,
  } }), null);
  for (const requestType of ["early_checkin", "late_checkout", "bag_drop"]) {
    assert.equal(buildGuestTimeRequest({ candidate, decision: {
      requestType, action: "accept_conditional", createsOperationalRequest: true,
      requestedTime: null, effectiveTime: null,
    } }), null);
  }
});

test("office storage preserves instant bilingual notification and existing request dedupe", async () => {
  const decision = officeDecision();
  const sql = fakeSql([
    [{ id: "office-request", status: "accepted", cleanersNotifiedAt: null }],
    [{ id: "office-request", cleanersNotifiedAt: "2026-08-24T10:00:00Z" }],
    [{ id: "office-request", status: "cleaners_notified", cleanersNotifiedAt: "2026-08-24T10:00:00Z" }],
  ]);
  let sends = 0;
  const options = {
    sql, householdId: "household-1", candidate, decision,
    now: new Date("2026-08-24T10:00:00Z"), env: { AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us" },
    sendGroupMessage: async ({ text, idempotencyKey }) => {
      sends += 1;
      assert.match(text, /Wednesday,? 26 August 2026/);
      assert.match(text, /\*Xhosa:\*/);
      assert.match(text, /Drop-off time not specified/);
      assert.equal(idempotencyKey, "airbnb-support:cleaners:time:office-request");
      return { live: { providerMessageId: "office-provider" }, verification: { found: true } };
    },
  };
  assert.deepEqual(await captureGuestTimeRequest(options), { status: "notified", requestId: "office-request", verified: true });
  assert.equal((await captureGuestTimeRequest(options)).status, "already_notified");
  assert.equal(sends, 1);
  assert.match(sql.calls[0].text, /stay_date = excluded.stay_date/);
  assert.ok(sql.calls[0].values.some((value) => value?.action === "accept_office_storage"));
});

test("support maps an untimed request to null while prioritising genuine early-entry follow-ups", async () => {
  const sql = fakeSql([[{
    activeTimeRequestType: "bag_drop", activeTimeRequestStayDate: "2026-08-26",
    activeTimeRequestEffectiveTime: null, activeTimeRequestStatus: "cleaners_notified",
  }]]);
  const [result] = await loadShadowCandidates(sql, { householdId: "household-1" });
  assert.equal(result.activeTimeRequest.effectiveTime, null);
  assert.match(sql.calls[0].text, /order by \(request.request_type = 'early_checkin'\) desc, request.created_at desc/);
});

test("the local schema permits nullable times only for explicit office bag drops", {
  skip: !process.env.AIRBNB_INTEGRATION_DATABASE_URL,
}, async () => {
  const url = process.env.AIRBNB_INTEGRATION_DATABASE_URL;
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname));
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      await tx`create temp table office_storage_times_test (like airbnb.guest_time_requests including defaults including constraints) on commit drop`;
      for (const requestType of ["bag_drop", "early_checkin", "late_checkout"]) {
        for (const details of [{ action: "accept_office_storage" }, { action: "accept_after_checkout" }, {}, { action: null }]) {
          for (const times of [[null, null], ["08:30", null], [null, "08:30"], ["08:30", "08:30"]]) {
            const insert = () => tx.savepoint((savepoint) => savepoint`
              insert into office_storage_times_test (
                household_id, thread_id, property_id, source_fingerprint, request_type, stay_date,
                requested_time, effective_time, cleaner_note_en, cleaner_note_xh, details
              ) values (
                gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'fixture', ${requestType}, '2026-08-26',
                ${times[0]}, ${times[1]}, 'Fixture note', 'Fixture note', ${sql.json(details)}
              )
            `);
            if (times.every(Boolean) || (requestType === "bag_drop" && details.action === "accept_office_storage")) {
              await insert();
            } else {
              await assert.rejects(insert, { code: "23514", constraint_name: "guest_time_requests_times_required_check" });
            }
          }
        }
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanerEvidencePayload,
  cleanerEvidenceSenderAddress,
  cleanerLedgerRecords,
  cleanerReservationRecords,
  loadCleanerLedgerRecords,
  loadCleanerReservations,
} from "./database.mjs";
import { redactSensitiveText, sanitizeFailure } from "./storage.mjs";
import { mergeReservations } from "./report.mjs";

test("stored reservation revisions preserve dates, counts, cancellation, and source precedence", () => {
  const sourceCutoffAt = new Date("2026-06-03T17:14:47Z");
  const row = {
    id: "old-booking", unitNumber: 3, commonName: "Jasmine", listingName: "Jasmine Studio Stay",
    checkIn: new Date("2026-09-04T00:00:00Z"), checkOut: "2026-09-07",
    guestName: "Advance Guest", adults: 1, children: 1, infants: 2, guestCountKnown: true,
    confirmationCode: "HMADVANCE", bookingStatus: "confirmed", sourceCutoffAt,
  };
  const [record] = cleanerReservationRecords([row]);
  assert.equal(record.sourceEnvelopeId, "database:old-booking");
  assert.equal(record.sourceTimestamp, sourceCutoffAt.getTime());
  assert.equal(record.checkIn, "2026-09-04");
  assert.equal(record.checkOut, "2026-09-07");
  assert.equal(record.guests, "1 adult, 1 child, 2 infants");
  assert.equal(record.evidenceKind, "confirmed");
  const [cancelled] = cleanerReservationRecords([{ ...row, bookingStatus: "cancelled", guestCountKnown: false }]);
  assert.equal(cancelled.evidenceKind, "cancelled");
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.guests, "");
});

test("the stored reservation read is household and horizon scoped and retains cancellations", async () => {
  const householdId = "11111111-1111-4111-8111-111111111111";
  let ended = false;
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    assert.match(query, /property\.household_id = reservation\.household_id/);
    assert.match(query, /reservation\.household_id = \?/);
    assert.match(query, /reservation\.check_out >= \?::date/);
    assert.match(query, /reservation\.check_in <= \?::date \+ 7/);
    assert.doesNotMatch(query, /booking_status\s*=/);
    assert.deepEqual(values, [householdId, "2026-09-04", "2026-09-04"]);
    return [];
  };
  sql.end = async () => { ended = true; };
  const result = await loadCleanerReservations({
    targetDate: "2026-09-04",
    env: { AIRBNB_DATABASE_URL: "postgresql://example.invalid/database", AIRBNB_HOUSEHOLD_ID: householdId },
    postgresFactory: () => sql,
  });
  assert.deepEqual(result, { status: "loaded", reservations: [] });
  assert.equal(ended, true);
  assert.deepEqual(await loadCleanerReservations({ targetDate: "2026-09-04", env: {} }), {
    status: "disabled", reservations: [],
  });
});

test("stored uncoded reservations retain range cancellation and deduplication", () => {
  const [record] = cleanerReservationRecords([{
    id: "uncoded-booking", unitNumber: 3, commonName: "Jasmine", listingName: "Jasmine Studio Stay",
    checkIn: "2026-09-04", checkOut: "2026-09-07", guestName: "Advance Guest",
    adults: 1, children: 0, infants: 0, guestCountKnown: true,
    confirmationCode: "uncoded:range-hash", bookingStatus: "confirmed", sourceCutoffAt: "2026-06-03T17:14:47Z",
  }]);
  assert.equal(record.confirmationCode, "");
  assert.equal(mergeReservations([record, { ...record, sourceEnvelopeId: "mail-copy" }]).length, 1);
  assert.deepEqual(mergeReservations([record, {
    ...record, sourceEnvelopeId: "cancelled-mail", evidenceKind: "cancelled", cancelled: true,
    sourceTimestamp: Date.parse("2026-09-04T06:00:00Z"),
  }]), []);
});

test("stored guest-count provenance survives a reimport of the same count reply", () => {
  const composite = { discussionEnvelopeId: "1", acceptedEnvelopeId: "2", countEnvelopeId: "3" };
  const [record] = cleanerReservationRecords([{
    id: "count-booking", unitNumber: 3, commonName: "Jasmine", listingName: "Jasmine Studio Stay",
    checkIn: "2026-09-04", checkOut: "2026-09-07", guestName: "Advance Guest",
    adults: 2, children: 0, infants: 0, guestCountKnown: true,
    confirmationCode: "HMCOUNT", bookingStatus: "confirmed", sourceCutoffAt: "2026-09-02T10:02:00Z",
    guestCountChangeEvidence: composite,
  }]);
  const reply = { ...record, sourceEnvelopeId: "3", evidenceKind: "supplemental", evidenceSubtype: "reply", guestCountChangeEvidence: undefined };
  const [merged] = mergeReservations([record, reply]);
  assert.deepEqual(merged.guestCountChangeEvidence, composite);
  assert.deepEqual(cleanerEvidencePayload(reply, merged.guestCountChangeEvidence).guestCountChangeEvidence, composite);
});

test("cleaner ledger rows become report-compatible Supabase records", () => {
  for (const targetDate of ["2026-08-24", new Date("2026-08-24T00:00:00.000Z")]) {
    assert.deepEqual(cleanerLedgerRecords([{
      targetDate,
      messageHash: "shared-ledger-hash",
      contentOccurrence: 2,
      sentAt: null,
      completedAt: "2026-08-23T11:30:01.000Z",
    }]), [{
      targetDate: "2026-08-24",
      messageHash: "shared-ledger-hash",
      contentOccurrence: 2,
      sentAt: "2026-08-23T11:30:01.000Z",
      source: "supabase",
    }]);
  }
});

test("cleaner ledger keeps delivered content for substantive update comparison", () => {
  const weather = {
    available: true,
    rainPossible: true,
    rainSummary: "noon-midnight",
    maxProbability: 17,
    maxPrecipitation: 0.2,
  };
  assert.deepEqual(cleanerLedgerRecords([{
    targetDate: "2026-08-28",
    messageHash: "delivered-plan",
    messageText: "Updated Airbnb plan for Friday",
    isUpdate: true,
    weather,
    sentAt: "2026-08-27T11:53:29.000Z",
  }]), [{
    targetDate: "2026-08-28",
    messageHash: "delivered-plan",
    messageText: "Updated Airbnb plan for Friday",
    isUpdate: true,
    weather,
    contentOccurrence: 1,
    sentAt: "2026-08-27T11:53:29.000Z",
    source: "supabase",
  }]);
});

test("cleaner failure text removes credential-shaped values", () => {
  const redacted = redactSensitiveText(
    "Bearer secret-token api_key=private-value access_token=refresh-value cookie=session-value serialized={\"apiKey\":\"json-secret\"} postgresql://worker:password@example.test/db",
  );
  assert.doesNotMatch(redacted, /secret-token|private-value|refresh-value|session-value|json-secret|worker:password/);
  assert.match(redacted, /\[redacted\]/);
});

test("cleaner failure receipts sanitize names and codes as well as messages", () => {
  const error = new Error("password=message-secret");
  error.name = "token=name-secret";
  error.code = "api_key=code-secret";
  const receipt = sanitizeFailure(error, {
    runId: "fixture-run",
    targetDate: "2026-08-24",
    mode: "live",
    finalAttempt: true,
    startedAt: "2026-08-24T11:30:00.000Z",
    completedAt: "2026-08-24T11:30:01.000Z",
  });
  assert.doesNotMatch(JSON.stringify(receipt), /name-secret|code-secret|message-secret/);
});

test("cleaner ledger is disabled only when the database pair is absent", async () => {
  assert.deepEqual(await loadCleanerLedgerRecords({
    targetDate: "2026-08-24",
    env: {},
  }), { status: "disabled", records: [] });

  await assert.rejects(loadCleanerLedgerRecords({
    targetDate: "2026-08-24",
    env: { AIRBNB_DATABASE_URL: "postgresql://example.invalid/database" },
  }), /configured together/);
});

test("accepted guest-count evidence records its composite provenance and real sender", () => {
  const reply = {
    sourceEnvelopeId: "thread",
    senderAddress: "express@airbnb.com",
    unitId: 1,
    checkIn: "2026-08-28",
    checkOut: "2026-08-29",
    confirmationCode: "",
    providerThreadId: "2647000000",
    guestName: "Alpha Guest",
    guests: "2 adults",
    evidenceKind: "supplemental",
    evidenceSubtype: "reply",
    guestCountChangeClaimed: true,
  };
  const composite = {
    discussionEnvelopeId: "discussion",
    acceptedEnvelopeId: "accepted",
    countEnvelopeId: "thread",
  };
  assert.equal(cleanerEvidenceSenderAddress(reply), "express@airbnb.com");
  assert.deepEqual(cleanerEvidencePayload(reply, composite), {
    unitId: 1,
    checkIn: "2026-08-28",
    checkOut: "2026-08-29",
    confirmationCode: null,
    providerThreadId: "2647000000",
    guestName: "Alpha Guest",
    guests: "2 adults",
    evidenceKind: "supplemental",
    evidenceSubtype: "reply",
    guestCountChangeAccepted: false,
    guestCountChangeClaimed: true,
    guestCountChangeDiscussed: false,
    guestCountChangeEvidence: composite,
  });
});

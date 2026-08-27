import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanerEvidencePayload,
  cleanerEvidenceSenderAddress,
  cleanerLedgerRecords,
  loadCleanerLedgerRecords,
} from "./database.mjs";
import { redactSensitiveText, sanitizeFailure } from "./storage.mjs";

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

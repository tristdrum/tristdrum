import assert from "node:assert/strict";
import test from "node:test";

import { cleanerLedgerRecords, loadCleanerLedgerRecords } from "./database.mjs";

test("cleaner ledger rows become report-compatible Supabase records", () => {
  assert.deepEqual(cleanerLedgerRecords([{
    targetDate: "2026-08-24",
    messageHash: "shared-ledger-hash",
    sentAt: null,
    completedAt: "2026-08-23T11:30:01.000Z",
  }]), [{
    targetDate: "2026-08-24",
    messageHash: "shared-ledger-hash",
    sentAt: "2026-08-23T11:30:01.000Z",
    source: "supabase",
  }]);
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

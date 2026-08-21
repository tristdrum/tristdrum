import assert from "node:assert/strict";
import test from "node:test";
import { loadShadowCandidates } from "./repository.mjs";

test("unresolved guest threads remain candidates after the initial 24 hours", async () => {
  let queryText = "";
  const sql = (strings) => {
    queryText = strings.join("?");
    return [{
      id: "thread-1",
      providerThreadId: "airbnb-thread-1",
      sourceFingerprint: "fingerprint-1",
      lastGuestAt: "2026-08-01T10:00:00.000Z",
      latestEventAt: "2026-08-01T10:00:00.000Z",
      guestMessage: "Is the Wi-Fi available?",
      facts: null,
      existingClassification: null,
      existingDraft: null,
    }];
  };

  const candidates = await loadShadowCandidates(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    limit: 8,
  });

  assert.equal(candidates.length, 1);
  assert.doesNotMatch(queryText, /last_guest_at\s*>=/i);
  assert.deepEqual(candidates[0].facts, {});
});

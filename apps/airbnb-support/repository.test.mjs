import assert from "node:assert/strict";
import test from "node:test";
import {
  loadShadowCandidates,
  loadSuppressedSupportAlerts,
  storeSupportDraft,
} from "./repository.mjs";

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

test("automatically answerable drafts do not create Management escalations", async () => {
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("insert into airbnb.reply_deliveries")) {
      return [{ id: "delivery-1", status: "approved" }];
    }
    return [];
  };
  sql.json = (value) => value;
  const stored = await storeSupportDraft(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    candidate: {
      id: "33333333-3333-4333-8333-333333333333",
      providerThreadId: "thread-1",
      sourceFingerprint: "source-1",
      latestEventAt: "2026-08-23T19:00:00.000Z",
      listingName: "Jasmine Studio Stay",
      guestDisplayName: "Guest",
    },
    classification: {
      topic: "greeting",
      riskTier: "low",
      confidence: 0.99,
      draft: "Welcome!",
      summary: "Greeting",
      alertManagement: false,
    },
    now: new Date("2026-08-23T19:01:00.000Z"),
    automaticallyApprove: true,
    shadowMode: false,
  });
  assert.deepEqual(stored.alertStages, []);
  assert.equal(stored.minutesOpen, null);
  assert.equal(queries.some(({ query }) => query.includes("insert into airbnb.alerts")), false);
});

test("support alert loading revalidates thread and delivery state", async () => {
  let query = "";
  const sql = async (strings) => {
    query = strings.join("?");
    return [];
  };
  await loadSuppressedSupportAlerts(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
  });
  assert.match(query, /thread\.status = 'needs_human'/);
  assert.match(query, /thread\.last_host_at < thread\.last_guest_at/);
  assert.match(query, /'ambiguous'/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  loadDeliveryGuardCandidates,
  loadShadowCandidates,
  loadSuppressedSupportAlerts,
  recordAmbiguousDeliveryFailure,
  recordDeliveryGuardFailure,
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
  assert.match(query, /row_number\(\) over/i);
  assert.match(query, /where stage_rank = 1/i);
  assert.match(query, /when 'delivery_ambiguous' then 3/i);
});

test("delivery queue safely recovers stale claims and excludes legacy autonomous approvals", async () => {
  const queries = [];
  const transaction = async (strings) => {
    queries.push(strings.join("?"));
    return [];
  };
  transaction.json = (value) => value;
  const sql = async (strings) => {
    queries.push(strings.join("?"));
    return [];
  };
  sql.begin = async (callback) => callback(transaction);

  await loadDeliveryGuardCandidates(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    now: new Date("2026-08-24T12:00:00.000Z"),
    limit: 1,
  });

  assert.equal(queries.some((query) => (
    /status = 'sending'/.test(query)
    && /send_attempted_at is null/.test(query)
    && /set status = 'approved'/.test(query)
  )), true);
  assert.equal(queries.some((query) => (
    /status = 'sending'/.test(query)
    && /send_attempted_at is not null/.test(query)
    && /set status = 'ambiguous'/.test(query)
  )), true);
  assert.equal(queries.some((query) => (
    /approved_by is not null/.test(query)
    && /messageWhitelisted/.test(query)
  )), true);
});

test("delivery failure persistence redacts scalar credentials", async () => {
  const values = [];
  const transaction = async (strings, ...parameters) => {
    values.push(...parameters);
    const query = strings.join("?");
    if (/update airbnb\.reply_deliveries/.test(query)) {
      return [{ id: "delivery-1", threadId: "thread-1", status: "ambiguous" }];
    }
    return [];
  };
  transaction.json = (value) => value;
  const sql = async () => [];
  sql.begin = async (callback) => callback(transaction);
  const error = new Error("provider failed token=very-secret-value postgresql://user:password@example.test/db");

  await recordAmbiguousDeliveryFailure(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    deliveryId: "delivery-1",
    error,
    now: new Date("2026-08-24T12:00:00.000Z"),
  });
  await recordDeliveryGuardFailure(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    deliveryId: "delivery-1",
    error,
    now: new Date("2026-08-24T12:01:00.000Z"),
  });

  const persisted = JSON.stringify(values);
  assert.doesNotMatch(persisted, /very-secret-value|user:password/);
  assert.match(persisted, /\[REDACTED\]/);
});

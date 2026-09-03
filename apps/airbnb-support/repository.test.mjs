import assert from "node:assert/strict";
import test from "node:test";
import {
  loadDeliveryGuardCandidates,
  loadShadowCandidates,
  loadSuppressedSupportAlerts,
  reconcileBookingLifecycle,
  recordAmbiguousDeliveryFailure,
  recordDeliveryGuardFailure,
  storeSupportDraft,
  supportStayLabelMatches,
} from "./repository.mjs";

test("booking lifecycle matching requires the same stay dates", () => {
  assert.equal(supportStayLabelMatches("SEP 4 – 6", "2026-09-04", "2026-09-06"), true);
  assert.equal(supportStayLabelMatches("SEP 4 – 6", "2026-09-05", "2026-09-06"), false);
  assert.equal(supportStayLabelMatches("DEC 31 – JAN 2", "2026-12-31", "2027-01-02"), true);
});

test("non-payment lifecycle evidence resolves exactly one matching support thread", async () => {
  const queries = [];
  const transaction = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("insert into airbnb.evidence")) return [{ id: "evidence-expired" }];
    if (query.includes("from airbnb.guest_threads thread")) {
      return [{
        id: "thread-somila",
        providerThreadId: "thread-provider",
        guestDisplayName: "SOMILA",
        lastGuestAt: "2026-08-26T10:06:34.000Z",
        stayLabel: "SEP 4 – 6",
      }];
    }
    return [];
  };
  transaction.json = (value) => value;
  const sql = async () => [];
  sql.begin = async (callback) => callback(transaction);

  const result = await reconcileBookingLifecycle(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    email: {
      providerMessageId: "<expired@example.test>",
      from: "automated@airbnb.com",
      subject: "Sep 4 - 6 request dismissed - no payment",
      occurredAt: "2026-08-26T10:23:00.000Z",
    },
    lifecycle: {
      kind: "request_expired",
      reason: "nonpayment",
      guestName: "Somila",
      unitNumber: 1,
      listingName: "Bougainvillea Courtyard Studio",
      checkIn: "2026-09-04",
      checkOut: "2026-09-06",
    },
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.threadId, "thread-somila");
  assert.equal(queries.some(({ query }) => query.includes("update airbnb.reply_deliveries")), true);
  assert.equal(queries.some(({ query }) => query.includes("update airbnb.alerts")), true);
  assert.equal(queries.some(({ query }) => (
    query.includes("insert into airbnb.audit_events") && query.includes("guest_booking_request_expired")
  )), true);
});

test("candidate loading uses an explicit activation cutoff instead of a rolling age window", async () => {
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
      sourceKind: "initial_inquiry",
      replyRequired: true,
      replyCapable: false,
      existingDecision: null,
      existingDraft: null,
    }];
  };

  const candidates = await loadShadowCandidates(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    limit: 8,
    notBefore: "2026-08-25T12:00:00.000Z",
  });

  assert.equal(candidates.length, 1);
  assert.match(queryText, /thread\.last_guest_at\s*>=/i);
  assert.doesNotMatch(queryText, /now\(\)\s*-/i);
  assert.deepEqual(candidates[0].facts, {});
  assert.equal(candidates[0].sourceKind, "initial_inquiry");
  assert.equal(candidates[0].replyRequired, true);
  assert.equal(candidates[0].replyCapable, false);
  assert.match(queryText, /airbnb_initial_inquiry/);
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
  assert.equal(queries.some(({ query }) => (
    query.includes("update airbnb.alerts")
    && query.includes("coalesce(details->>'shadowMode', 'true') = 'true'")
  )), true);
});

test("messages needing no reply become terminal and resolve old alerts", async () => {
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("insert into airbnb.reply_deliveries")) {
      return [{ id: "delivery-quiet", status: "cancelled" }];
    }
    return [];
  };
  sql.json = (value) => value;
  const stored = await storeSupportDraft(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    candidate: {
      id: "33333333-3333-4333-8333-333333333333",
      providerThreadId: "thread-quiet",
      sourceFingerprint: "source-quiet",
      latestEventAt: "2026-08-26T05:50:01.000Z",
      listingName: "Bougainvillea Courtyard Studio",
      guestDisplayName: "Guest",
    },
    classification: {
      topic: "thanks",
      riskTier: "low",
      confidence: 0.99,
      replyNeeded: false,
      draft: null,
      summary: "No reply is needed.",
      alertManagement: false,
    },
    now: new Date("2026-08-26T05:51:00.000Z"),
    shadowMode: false,
  });

  assert.equal(stored.status, "cancelled");
  assert.deepEqual(stored.alertStages, []);
  assert.equal(queries[0].values.includes("No reply needed."), true);
  assert.equal(queries.some(({ query, values }) => (
    query.includes("update airbnb.guest_threads")
    && query.includes("requiresManagementAction")
    && values.includes("handled")
  )), true);
  assert.equal(queries.some(({ query }) => (
    query.includes("update airbnb.alerts")
    && query.includes("status = 'resolved'")
    && query.includes("requiresManagementAction")
  )), true);
});

test("a no-reply follow-up preserves an earlier actionable Management alert", async () => {
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("insert into airbnb.reply_deliveries")) {
      return [{ id: "delivery-thanks", status: "cancelled" }];
    }
    return [];
  };
  sql.json = (value) => value;

  await storeSupportDraft(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    candidate: {
      id: "33333333-3333-4333-8333-333333333333",
      providerThreadId: "thread-action-follow-up",
      sourceFingerprint: "source-thanks",
      latestEventAt: "2026-09-03T09:04:52.000Z",
      listingName: "The Spekboom Studio",
      guestDisplayName: "Guest",
    },
    classification: {
      topic: "thanks",
      riskTier: "low",
      replyNeeded: false,
      draft: null,
      summary: "No reply is needed.",
      alertManagement: false,
    },
    now: new Date("2026-09-03T09:05:00.000Z"),
    shadowMode: false,
  });

  const resolution = queries.find(({ query }) => (
    query.includes("update airbnb.alerts") && query.includes("status = 'resolved'")
  ));
  assert.ok(resolution);
  assert.match(resolution.query, /requiresManagementAction/);
  assert.match(resolution.query, /delivery_ambiguous/);
  const threadUpdate = queries.find(({ query }) => query.includes("update airbnb.guest_threads"));
  assert.ok(threadUpdate);
  assert.match(threadUpdate.query, /exists \(/);
  assert.match(threadUpdate.query, /requiresManagementAction/);
  assert.match(threadUpdate.query, /"shadowMode": false/);
  assert.match(threadUpdate.query, /delivery_ambiguous/);
});

test("a no-reply decision can still require durable Management action", async () => {
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("insert into airbnb.reply_deliveries")) {
      return [{ id: "delivery-action", status: "cancelled" }];
    }
    return [];
  };
  sql.json = (value) => value;
  const stored = await storeSupportDraft(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    candidate: {
      id: "33333333-3333-4333-8333-333333333333",
      providerThreadId: "thread-action",
      sourceFingerprint: "source-action",
      latestEventAt: "2026-08-26T05:50:01.000Z",
      listingName: "Bougainvillea Courtyard Studio",
      guestDisplayName: "Guest",
    },
    classification: {
      topic: "adaptive_support",
      riskTier: "high",
      replyNeeded: false,
      draft: null,
      summary: "The host needs to inspect a reported issue, but no guest reply is needed.",
      alertManagement: true,
    },
    now: new Date("2026-08-26T05:51:00.000Z"),
    shadowMode: false,
  });

  assert.equal(stored.status, "cancelled");
  assert.deepEqual(stored.alertStages, ["immediate"]);
  assert.equal(queries.some(({ query, values }) => (
    query.includes("update airbnb.guest_threads") && values.includes("needs_human")
  )), true);
  assert.equal(queries.some(({ query, values }) => (
    query.includes("insert into airbnb.alerts")
    && values.some((value) => (
      value?.requiresManagementAction === true && value?.shadowMode === false
    ))
  )), true);
});

test("shadow no-reply decisions remain reviewable and can be reconsidered live", async () => {
  const queries = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("insert into airbnb.reply_deliveries")) {
      return [{ id: "delivery-shadow", status: "needs_approval" }];
    }
    return [];
  };
  sql.json = (value) => value;
  const stored = await storeSupportDraft(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    candidate: {
      id: "33333333-3333-4333-8333-333333333333",
      providerThreadId: "thread-shadow",
      sourceFingerprint: "source-shadow",
      latestEventAt: "2026-08-26T05:50:01.000Z",
      listingName: "Bougainvillea Courtyard Studio",
      guestDisplayName: "Guest",
    },
    classification: {
      topic: "adaptive_support",
      riskTier: "low",
      replyNeeded: false,
      draft: null,
      summary: "No reply appears necessary.",
      alertManagement: false,
    },
    now: new Date("2026-08-26T05:51:00.000Z"),
    shadowMode: true,
  });

  assert.equal(stored.status, "needs_approval");
  assert.equal(queries.some(({ query, values }) => (
    query.includes("update airbnb.guest_threads") && values.includes("needs_human")
  )), true);
  assert.equal(queries.some(({ query }) => (
    query.includes("update airbnb.alerts") && query.includes("status = 'resolved'")
  )), false);
  assert.equal(queries.some(({ query }) => (
    query.includes("excluded.status = 'approved'")
    && query.includes("airbnb.reply_deliveries.status = 'needs_approval'")
  )), true);
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
  assert.match(query, /requiresManagementAction/);
  assert.match(query, /thread\.status = 'needs_human'/);
  assert.match(query, /delivery\.status <> 'handled_by_human'/);
  assert.match(query, /thread\.last_host_at < thread\.last_guest_at/);
  assert.match(query, /'ambiguous'/);
  assert.match(query, /row_number\(\) over/i);
  assert.match(query, /where stage_rank = 1/i);
  assert.match(query, /when 'delivery_ambiguous' then 3/i);
});

test("delivery queue safely recovers stale claims and admits only versioned agent decisions", async () => {
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
    && /decisionSource/.test(query)
    && /adaptive_agent/.test(query)
    && /operational_readiness/.test(query)
    && /decisionVersion/.test(query)
    && /autoReply/.test(query)
    && /initial_inquiry_requires_airbnb_ui/.test(query)
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

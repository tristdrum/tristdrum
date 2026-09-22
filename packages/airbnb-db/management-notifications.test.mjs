import assert from "node:assert/strict";
import test from "node:test";
import { sendManagementNotification, retryPendingManagementPings } from "./management-notifications.mjs";

const NOW = "2026-09-22T10:00:00.000Z";
const householdId = "00000000-0000-4000-8000-000000000001";
const later = (milliseconds) => new Date(Date.parse(NOW) + milliseconds).toISOString();
const accepted = { status: 202, accepted: true, requestId: "00000000-0000-4000-8000-000000000002" };
const verified = { live: { providerMessageId: "wa-1" }, verification: { found: true, providerMessageId: "wa-1" } };
const transient = { status: 503, accepted: false, error: "apns_submission_failed", retryable: true };

// Stateful tagged-SQL double: each UPDATE is atomic, returned rows are snapshots.
// Predicate assertions keep this model coupled to the actual claim/fencing SQL.
function database() {
  const rows = [];
  const failures = [];
  const sql = async (parts, ...v) => {
    const query = parts.join("?").replace(/\s+/g, " ").trim();
    const fail = failures.findIndex((pattern) => query.includes(pattern));
    if (fail !== -1) {
      failures.splice(fail, 1);
      throw new Error("mock persistence failure with secret details");
    }
    let result = [];
    if (query.startsWith("insert")) {
      const [householdId, notificationKey, sourceService, text, createdAt, updatedAt] = v;
      assert.match(query, /on conflict \(household_id, notification_key\) do nothing/);
      if (!rows.some((r) => r.householdId === householdId && r.notificationKey === notificationKey)) {
        rows.push({ id: `00000000-0000-4000-8000-${String(rows.length + 10).padStart(12, "0")}`,
          householdId, notificationKey, sourceService, text, createdAt, updatedAt,
          whatsappStatus: "pending", pingStatus: "pending", pingAttemptCount: 0 });
      }
    } else if (query.startsWith("select")) {
      result = query.includes("notification_key")
        ? rows.filter((r) => r.householdId === v[0] && r.notificationKey === v[1] && r.sourceService === v[2])
        : rows.filter((r) => r.id === v[0] && r.householdId === v[1] && r.sourceService === v[2]);
    } else if (query.includes("set whatsapp_status = 'sending'")) {
      assert.match(query, /and whatsapp_status = 'pending'/);
      const [updatedAt, id, householdId, sourceService] = v;
      result = rows.filter((r) => r.id === id && r.householdId === householdId && r.sourceService === sourceService && r.whatsappStatus === "pending");
      result.forEach((r) => Object.assign(r, { whatsappStatus: "sending", updatedAt }));
    } else if (query.includes("set whatsapp_status = ?")) {
      assert.match(query, /whatsapp_status in \('sending', 'ambiguous'\)/);
      const [whatsappStatus, whatsappProviderMessageId, whatsappVerifiedAt, whatsappError, updatedAt, id, householdId, sourceService] = v;
      result = rows.filter((r) => r.id === id && r.householdId === householdId && r.sourceService === sourceService && ["sending", "ambiguous"].includes(r.whatsappStatus));
      result.forEach((r) => Object.assign(r, { whatsappStatus, whatsappProviderMessageId, whatsappVerifiedAt, whatsappError, updatedAt }));
    } else if (query.includes("ping_attempt_count = ping_attempt_count + 1")) {
      assert.match(query, /for update skip locked/);
      assert.match(query, /ping_attempt_count = 1/);
      assert.match(query, /ping_first_attempt_at > \?::timestamptz - interval '6 hours'/);
      assert.match(query, /ping_last_attempt_at < \?::timestamptz/);
      const [first, at, updatedAt, householdId, scope, id, sameId, retry, windowAt, retryBefore] = v;
      assert.equal(id, sameId);
      assert.equal(at, windowAt);
      assert.equal(at, v[10]);
      const time = Date.parse(at);
      result = rows.filter((r) => r.householdId === householdId && scope.includes(r.sourceService)
        && (!id || r.id === id) && r.whatsappStatus === "verified"
        && ((r.pingStatus === "pending" && r.pingAttemptCount === 0)
          || (retry && r.pingAttemptCount === 1 && Date.parse(r.pingFirstAttemptAt) > time - 21_600_000
            && Date.parse(r.pingLastAttemptAt) < Date.parse(retryBefore)
            && ((r.pingStatus === "failed" && r.pingError?.startsWith("retryable:"))
              || (r.pingStatus === "sending" && Date.parse(r.pingLastAttemptAt) <= time - 60_000)))))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, 1);
      result.forEach((r) => Object.assign(r, { pingStatus: "sending", pingAttemptCount: r.pingAttemptCount + 1,
        pingFirstAttemptAt: r.pingFirstAttemptAt ?? first, pingLastAttemptAt: at, pingError: null, updatedAt }));
    } else if (query.includes("set ping_status = ?")) {
      assert.match(query, /ping_status <> 'accepted'/);
      assert.match(query, /ping_attempt_count >= \?/);
      const [pingStatus, pingError, pingRequestId, pingAcceptedAt, updatedAt, id, householdId, sourceService, accepted, count, sameCount] = v;
      assert.equal(count, sameCount);
      result = rows.filter((r) => r.id === id && r.householdId === householdId && r.sourceService === sourceService
        && r.pingStatus !== "accepted" && ((accepted && r.pingAttemptCount >= count)
          || (r.pingStatus === "sending" && r.pingAttemptCount === count)));
      result.forEach((r) => Object.assign(r, { pingStatus, pingError, pingRequestId, pingAcceptedAt, updatedAt }));
    } else if (query.includes("permanent:retry_window_closed")) {
      const [updatedAt, householdId, scope, at] = v;
      result = rows.filter((r) => r.householdId === householdId && scope.includes(r.sourceService) && r.whatsappStatus === "verified"
        && (r.pingStatus === "sending" || (r.pingStatus === "failed" && r.pingError?.startsWith("retryable:")))
        && Date.parse(r.pingLastAttemptAt) <= Date.parse(at) - 60_000
        && (r.pingAttemptCount >= 2 || Date.parse(r.pingFirstAttemptAt) <= Date.parse(at) - 21_600_000));
      result.forEach((r) => Object.assign(r, { pingStatus: "failed", pingError: "permanent:retry_window_closed", updatedAt }));
    } else assert.fail(`Unhandled SQL: ${query}`);
    return structuredClone(result);
  };
  return { sql, rows, failures };
}

function setup(overrides = {}) {
  const db = database();
  const calls = { whatsapp: [], ping: [] };
  const options = { sql: db.sql, householdId, notificationKey: "event:1", text: "The plumber will arrive at 14:00.",
    env: {}, now: NOW,
    sendWhatsApp: async (input) => { calls.whatsapp.push(input); return verified; },
    sendPing: async (input, config) => { calls.ping.push({ input, config }); return accepted; }, ...overrides };
  return { ...db, options, calls };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("WA reservation, exact readback identity and persistence precede paired Ping", async () => {
  const state = setup();
  state.options.sendWhatsApp = async ({ text }) => {
    assert.equal(state.rows[0].whatsappStatus, "sending");
    assert.equal(state.rows[0].text, text);
    return verified;
  };
  state.options.sendPing = async (input) => {
    const row = state.rows[0];
    assert.equal(row.whatsappStatus, "verified");
    assert.equal(row.whatsappProviderMessageId, "wa-1");
    assert.equal(row.pingStatus, "sending");
    assert.equal(row.pingAttemptCount, 1);
    assert.equal(row.pingFirstAttemptAt, NOW);
    assert.equal(input.body, state.options.text);
    assert.equal(input.title, "Airbnb Management");
    assert.equal(input.urgency, "normal");
    return accepted;
  };
  const result = await sendManagementNotification(state.options);
  assert.equal(result.whatsappStatus, "verified");
  assert.equal(result.pingStatus, "accepted");
  assert.equal(result.pingAccepted, true);
  assert.equal(result.pingRequestId, accepted.requestId);
  assert.deepEqual(result.verification, { found: true, providerMessageId: "wa-1" });
  assert.equal(result.manualReviewRequired, false);
  assert.equal(result.persistenceError, null);
});

test("concurrent sends reserve WhatsApp and Ping only once", async () => {
  const state = setup();
  await Promise.all(Array.from({ length: 10 }, () => sendManagementNotification(state.options)));
  assert.equal(state.rows.length, 1);
  assert.equal(state.calls.whatsapp.length, 1);
  assert.equal(state.calls.ping.length, 1);
  assert.equal(state.calls.whatsapp[0].idempotencyKey, state.options.notificationKey);
  await sendManagementNotification(state.options);
  await retryPendingManagementPings({ ...state.options, now: later(60_000) });
  assert.equal(state.calls.whatsapp.length, 1);
  assert.equal(state.calls.ping.length, 1);
});

test("default WhatsApp and Ping adapters compose with readback identity and nonfatal Ping auth failure", async (t) => {
  const state = setup({ text: "  Gate needs attention.\n", sourceService: "operator" });
  const canonicalText = state.options.text.trim();
  const requests = [];
  let wrote = false;
  const env = {
    AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us", AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us",
    MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://min.example", MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "mock",
    AIRBNB_WHATSAPP_ACCOUNT_ID: "account-1", PING_API_KEY: "mock-ping",
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: String(url), method: options.method ?? "GET" });
    if (String(url).startsWith("https://ping.techlocal.co.za/")) {
      assert.equal(state.rows[0].whatsappStatus, "verified");
      assert.equal(state.rows[0].whatsappProviderMessageId, "readback-identity");
      assert.equal(JSON.parse(options.body).body, canonicalText);
      return new Response('{"error":"invalid_api_key"}', { status: 401 });
    }
    if (options.method === "POST") {
      if (!String(url).includes("dry_run=true")) {
        assert.equal(options.headers["Idempotency-Key"], state.options.notificationKey);
        assert.equal(JSON.parse(options.body).text, canonicalText);
        wrote = true;
      }
      return new Response('{"ok":true}');
    }
    return new Response(JSON.stringify({ messages: wrote
      ? [{ id: "readback-identity", from_me: true, text: canonicalText }] : [] }));
  });
  const result = await sendManagementNotification({ ...state.options, env, sendWhatsApp: undefined, sendPing: undefined });
  assert.equal(result.whatsappStatus, "verified");
  assert.deepEqual(result.verification, { found: true, providerMessageId: "readback-identity" });
  assert.equal(result.pingStatus, "failed");
  assert.equal(result.pingError, "permanent:invalid_api_key");
  assert.equal(result.pingAccepted, false);
  assert.equal(result.persistenceError, null);
  assert.equal(state.rows[0].text, canonicalText);
  await retryPendingManagementPings({ ...state.options, env, sendPing: undefined, now: later(120_000) });
  assert.equal(requests.length, 5);
});

test("a stable key cannot change summary or service; household keys stay isolated", async () => {
  const state = setup();
  await sendManagementNotification(state.options);
  await assert.rejects(sendManagementNotification({ ...state.options, text: "Changed" }), /different text or service/);
  await assert.rejects(sendManagementNotification({ ...state.options, sourceService: "stock" }), /different text or service/);
  await sendManagementNotification({ ...state.options, householdId: "00000000-0000-4000-8000-000000000003" });
  assert.equal(state.calls.ping.length, 2);
  assert.notEqual(state.calls.ping[0].input.dedupeKey, state.calls.ping[1].input.dedupeKey);
});

test("one canonical trimmed text is persisted, sent and reused while changed content still rejects", async () => {
  const state = setup({ text: " \nGate needs  attention.\nUse the side entrance.\t " });
  const text = state.options.text.trim();
  await sendManagementNotification(state.options);
  assert.equal(state.rows[0].text, text);
  assert.equal(state.calls.whatsapp[0].text, text);
  assert.equal(state.calls.ping[0].input.body, text);
  await sendManagementNotification({ ...state.options, text });
  assert.equal(state.calls.whatsapp.length, 1);
  assert.equal(state.calls.ping.length, 1);
  await assert.rejects(sendManagementNotification({ ...state.options, text: text.replace("  ", " ") }), /different text or service/);
  await assert.rejects(sendManagementNotification({ ...state.options, text: "Changed" }), /different text or service/);
  assert.equal(state.rows[0].text, text);
});

test("provider ID without exact readback, or readback without identity, cannot trigger Ping", async () => {
  for (const result of [{ live: { providerMessageId: "wa-1" } }, { verification: { found: true } }, undefined]) {
    const state = setup({ sendWhatsApp: async () => result });
    const receipt = await sendManagementNotification(state.options);
    assert.equal(receipt.whatsappStatus, "ambiguous");
    assert.equal(receipt.manualReviewRequired, true);
    assert.equal(state.calls.ping.length, 0);
  }
});

test("a thrown WA write remains ambiguous across restarts and does not leak error details", async () => {
  let calls = 0;
  const state = setup({ sendWhatsApp: async () => { calls += 1; throw new Error("secret WA error"); } });
  await sendManagementNotification(state.options);
  const result = await sendManagementNotification({ ...state.options, now: later(120_000) });
  assert.equal(calls, 1);
  assert.equal(result.whatsappStatus, "ambiguous");
  assert.equal(state.calls.ping.length, 0);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("crash after WA reservation cannot repeat the write", async () => {
  const gate = deferred();
  const entered = deferred();
  let calls = 0;
  const state = setup({ sendWhatsApp: async () => { calls += 1; entered.resolve(); return gate.promise; } });
  const initial = sendManagementNotification(state.options);
  await entered.promise;
  const second = await sendManagementNotification({ ...state.options, now: later(120_000) });
  assert.equal(second.whatsappStatus, "ambiguous");
  assert.equal(calls, 1);
  gate.resolve(verified);
  assert.equal((await initial).whatsappStatus, "verified");
  assert.equal(state.calls.ping.length, 1);
});

test("WA receipt persistence failure never sends Ping or replays WA", async () => {
  const state = setup();
  state.failures.push("set whatsapp_status = ?");
  const first = await sendManagementNotification(state.options);
  assert.equal(first.persistenceError, "whatsapp_result_not_persisted");
  assert.equal(state.calls.ping.length, 0);
  const second = await sendManagementNotification({ ...state.options, now: later(120_000) });
  assert.equal(second.whatsappStatus, "ambiguous");
  assert.equal(state.calls.whatsapp.length, 1);
});

test("a saved provider ID reconciles read-only only with exact outgoing ID, group and text", async (t) => {
  for (const mismatch of [null, "id", "text", "from_me", "chat_id"]) {
    const state = setup({ env: {
      AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us", AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us",
      MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://min.example", MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "mock",
      AIRBNB_WHATSAPP_ACCOUNT_ID: "account-1",
    }, sendWhatsApp: async () => ({ live: { providerMessageId: "wa-1" } }) });
    await sendManagementNotification(state.options);
    const candidate = { id: "wa-1", text: state.options.text, from_me: true, chat_id: "management@g.us" };
    if (mismatch) candidate[mismatch] = mismatch === "from_me" ? false : "not-matching";
    const mock = t.mock.method(globalThis, "fetch", async (_url, options) => {
      assert.equal(options.method, undefined);
      return new Response(JSON.stringify({ messages: [candidate] }));
    });
    const result = await sendManagementNotification({ ...state.options, now: later(120_000) });
    mock.mock.restore();
    assert.equal(result.whatsappStatus, mismatch ? "ambiguous" : "verified");
    assert.equal(state.calls.ping.length, mismatch ? 0 : 1);
  }
});

test("one transient retry occurs only on a later poll with the original dedupe key", async () => {
  const sent = [];
  const state = setup({ sendPing: async (input) => { sent.push(input); return transient; } });
  const first = await sendManagementNotification(state.options);
  assert.equal(first.whatsappStatus, "verified");
  assert.equal(first.pingStatus, "failed");
  await sendManagementNotification({ ...state.options, now: later(500) });
  await retryPendingManagementPings(state.options);
  assert.equal(sent.length, 1);
  const drain = await retryPendingManagementPings({ ...state.options, now: later(1_000) });
  assert.equal(drain.notifications.length, 1);
  assert.equal(drain.notifications[0].pingAttemptCount, 2);
  await retryPendingManagementPings({ ...state.options, now: later(120_000) });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(state.calls.whatsapp.length, 1);
});

test("concurrent retry drains cannot overrun the two-attempt budget", async () => {
  let calls = 0;
  const state = setup({ sendPing: async () => { calls += 1; return transient; } });
  await sendManagementNotification(state.options);
  await Promise.all(Array.from({ length: 10 }, () => retryPendingManagementPings({ ...state.options, now: later(120_000) })));
  assert.equal(calls, 2);
  assert.equal(state.rows[0].pingAttemptCount, 2);
});

test("permanent and auth failures do not retry even if the injected result claims retryable", async () => {
  for (const result of [{ status: 401, error: "invalid_api_key", retryable: true },
    { status: 403, error: "invalid_response", retryable: true },
    { error: "missing_api_key", retryable: true }, { status: 400, error: "request_failed", retryable: true }]) {
    let calls = 0;
    const state = setup({ sendPing: async () => { calls += 1; return result; } });
    await sendManagementNotification(state.options);
    await retryPendingManagementPings({ ...state.options, now: later(120_000) });
    assert.equal(calls, 1);
    assert.match(state.rows[0].pingError, /^permanent:/);
  }
});

test("a thrown Ping error is nonfatal and consumes a retry attempt", async () => {
  const state = setup({ sendPing: async () => { throw new Error("secret transport error"); } });
  const first = await sendManagementNotification(state.options);
  assert.equal(first.whatsappStatus, "verified");
  assert.equal(first.pingError, "retryable:network_or_timeout");
  await retryPendingManagementPings({ ...state.options, now: later(120_000) });
  assert.equal(state.rows[0].pingAttemptCount, 2);
  assert.equal(JSON.stringify(state.rows).includes("secret"), false);
});

test("accepted Ping with lost persistence retries within the window and then stops", async () => {
  const state = setup();
  state.failures.push("set ping_status = ?");
  const first = await sendManagementNotification(state.options);
  assert.equal(first.persistenceError, "ping_result_not_persisted");
  assert.equal(state.rows[0].pingStatus, "sending");
  await retryPendingManagementPings({ ...state.options, now: later(59_999) });
  assert.equal(state.calls.ping.length, 1);
  await retryPendingManagementPings({ ...state.options, now: later(60_000) });
  await retryPendingManagementPings({ ...state.options, now: later(120_000) });
  assert.equal(state.calls.ping.length, 2);
  assert.equal(state.calls.ping[0].input.dedupeKey, state.calls.ping[1].input.dedupeKey);
  assert.equal(state.rows[0].pingStatus, "accepted");
});

test("uncertain sending or failed transient attempts never retry at or beyond six hours", async () => {
  for (const pingStatus of ["sending", "failed"]) {
    for (const age of [21_600_000, 21_600_001, 86_400_000]) {
      const state = setup({ sendPing: async () => transient });
      await sendManagementNotification(state.options);
      state.rows[0].pingStatus = pingStatus;
      await retryPendingManagementPings({ ...state.options, now: later(age), sendPing: () => assert.fail("stale retry") });
      assert.equal(state.rows[0].pingAttemptCount, 1);
      assert.equal(state.rows[0].pingStatus, "failed");
      assert.equal(state.rows[0].pingError, "permanent:retry_window_closed");
    }
  }
});

test("an advancing clock cannot trigger two Ping attempts in the same drain", async () => {
  const state = setup();
  state.failures.push("ping_attempt_count = ping_attempt_count + 1");
  await sendManagementNotification(state.options);
  let tick = 120_000;
  let attempts = 0;
  const result = await retryPendingManagementPings({ ...state.options,
    now: () => later(tick += 1_000), sendPing: async () => { attempts += 1; return transient; } });
  assert.equal(result.notifications.length, 1);
  assert.equal(attempts, 1);
  assert.equal(state.rows[0].pingAttemptCount, 1);
});

test("a retry claim delayed beyond six hours never reaches the sender", async () => {
  const state = setup({ sendPing: async () => transient });
  await sendManagementNotification(state.options);
  const times = [later(21_599_000), later(21_599_000), later(21_600_000), later(21_600_000)];
  const result = await retryPendingManagementPings({ ...state.options,
    now: () => times.shift() ?? later(21_600_000), sendPing: () => assert.fail("expired retry") });
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].pingStatus, "failed");
  assert.equal(result.notifications[0].pingError, "permanent:retry_window_closed");
  assert.equal(state.rows[0].pingAttemptCount, 2);
});

test("an exhausted crash claim cannot make a third attempt", async () => {
  const state = setup();
  state.failures.push("set ping_status = ?");
  await sendManagementNotification(state.options);
  state.failures.push("set ping_status = ?");
  await retryPendingManagementPings({ ...state.options, now: later(60_000) });
  assert.equal(state.rows[0].pingStatus, "sending");
  assert.equal(state.rows[0].pingAttemptCount, 2);
  await retryPendingManagementPings({ ...state.options, now: later(120_000) });
  assert.equal(state.calls.ping.length, 2);
  assert.equal(state.rows[0].pingStatus, "failed");
});

test("database Date timestamps preserve restart retry eligibility", async () => {
  const state = setup({ sendPing: async () => transient });
  await sendManagementNotification(state.options);
  Object.assign(state.rows[0], { pingFirstAttemptAt: new Date(NOW), pingLastAttemptAt: new Date(NOW), updatedAt: new Date(NOW) });
  const result = await retryPendingManagementPings({ ...state.options, now: new Date(later(60_000)), sendPing: async () => accepted });
  assert.equal(result.notifications[0].pingStatus, "accepted");
});

test("restart after WA persistence but before Ping claim sends only Ping", async () => {
  const state = setup();
  state.failures.push("ping_attempt_count = ping_attempt_count + 1");
  const first = await sendManagementNotification(state.options);
  assert.equal(first.persistenceError, "ping_claim_not_persisted");
  assert.equal(first.whatsappStatus, "verified");
  assert.equal(state.calls.ping.length, 0);
  await retryPendingManagementPings({ ...state.options, now: later(120_000) });
  assert.equal(state.calls.whatsapp.length, 1);
  assert.equal(state.calls.ping.length, 1);
});

test("support drains operator but not stock; stock drains only its household and respects limit", async () => {
  const state = setup();
  for (const [sourceService, key, household] of [["support", "a", householdId], ["operator", "b", householdId],
    ["stock", "c", householdId], ["stock", "d", householdId], ["stock", "e", "other-household"]]) {
    state.failures.push("ping_attempt_count = ping_attempt_count + 1");
    await sendManagementNotification({ ...state.options, sourceService, notificationKey: key, householdId: household });
  }
  const support = await retryPendingManagementPings({ ...state.options, now: later(120_000) });
  assert.deepEqual(support.notifications.map((r) => r.sourceService), ["support", "operator"]);
  const stock = await retryPendingManagementPings({ ...state.options, sourceService: "stock", now: later(120_000), limit: 1 });
  assert.deepEqual(stock.notifications.map((r) => r.notificationKey), ["c"]);
  assert.equal(state.rows.find((r) => r.notificationKey === "d").pingStatus, "pending");
  assert.equal(state.rows.find((r) => r.notificationKey === "e").pingStatus, "pending");
});

test("late first-attempt failure cannot overwrite accepted second attempt", async () => {
  const gate = deferred();
  const entered = deferred();
  const state = setup({ sendPing: async () => { entered.resolve(); return gate.promise; } });
  const first = sendManagementNotification(state.options);
  await entered.promise;
  await retryPendingManagementPings({ ...state.options, now: later(60_000), sendPing: async () => accepted });
  gate.resolve(transient);
  assert.equal((await first).pingStatus, "accepted");
  assert.equal(state.rows[0].pingStatus, "accepted");
  assert.equal(state.rows[0].pingAttemptCount, 2);
});

test("late accepted first attempt is durable even if second attempt failed", async () => {
  const gate = deferred();
  const entered = deferred();
  const state = setup({ sendPing: async () => { entered.resolve(); return gate.promise; } });
  const first = sendManagementNotification(state.options);
  await entered.promise;
  await retryPendingManagementPings({ ...state.options, now: later(60_000), sendPing: async () => transient });
  gate.resolve(accepted);
  assert.equal((await first).pingStatus, "accepted");
  await retryPendingManagementPings({ ...state.options, now: later(120_000), sendPing: () => assert.fail("accepted replay") });
});

test("drain persistence errors are sanitized and do not throw", async () => {
  const state = setup();
  state.failures.push("permanent:retry_window_closed");
  assert.deepEqual(await retryPendingManagementPings(state.options), { notifications: [], error: "ping_drain_not_persisted" });
});

test("input validation happens before durable claims or network I/O", async () => {
  const state = setup();
  for (const override of [{ text: "a".repeat(1001) }, { notificationKey: "" }, { sourceService: "invalid" }]) {
    await assert.rejects(sendManagementNotification({ ...state.options, ...override }));
  }
  for (const limit of [0, 101, 1.5]) await assert.rejects(retryPendingManagementPings({ ...state.options, limit }));
  assert.equal(state.rows.length, 0);
  assert.equal(state.calls.whatsapp.length, 0);
});

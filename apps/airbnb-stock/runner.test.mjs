import assert from "node:assert/strict";
import test from "node:test";
import { runStockObservation, stockPlanningWindow } from "./runner.mjs";

const liveEnv = {
  AIRBNB_STOCK_EXTERNAL_WRITES_ENABLED: "true",
  AIRBNB_STOCK_MANAGEMENT_ALERTS_ENABLED: "true",
  AIRBNB_STOCK_LIVE_CONFIRMATION: "ENABLE_AIRBNB_STOCK_MANAGEMENT_WRITES",
  AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us",
  AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us",
};

function emptyDatabase(calls = []) {
  const receipts = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("insert into airbnb.job_runs")) calls.push("job-start");
    if (query.includes("select provider_message_id")) calls.push("known-mail");
    if (query.includes("update airbnb.job_runs")) receipts.push(...values.filter((value) => value?.schemaVersion === 1));
    return [];
  };
  sql.begin = (callback) => callback(sql);
  sql.json = (value) => value;
  return { sql, receipts, householdId: async () => "22222222-2222-4222-8222-222222222222" };
}

test("today's reconciled arrivals are excluded from the next seven forecast dates", () => {
  assert.deepEqual(stockPlanningWindow("2026-08-21"), {
    consumptionThroughDate: "2026-08-21",
    forecastStartDate: "2026-08-22",
    forecastEndDate: "2026-08-28",
  });
});

test("the runner rejects ungated live mode before opening the database", async () => {
  let databaseTouched = false;
  await assert.rejects(
    runStockObservation({
      mode: "live",
      env: {},
      database: {
        async householdId() {
          databaseTouched = true;
          throw new Error("database should not be touched");
        },
      },
    }),
    (error) => error.code === "LIVE_MODE_DISABLED",
  );
  assert.equal(databaseTouched, false);
});

test("mail search and known IDs share the UTC day cutoff at the moving lookback boundary", async () => {
  for (const instant of ["2026-09-13T09:00:00Z", "2026-09-13T23:59:59Z", "2026-09-14T00:00:00Z", "2026-09-14T00:30:00+02:00"]) {
    const now = new Date(instant);
    const expected = new Date(now.getTime() - 120 * 86_400_000);
    expected.setUTCHours(0, 0, 0, 0);
    let databaseSince;
    const sql = async (strings, ...values) => {
      if (strings.join("?").includes("select provider_message_id")) {
        databaseSince = values.find((value) => value instanceof Date);
        return [{ providerMessageId: "<boundary-invoice@example.test>" }];
      }
      return [];
    };
    sql.begin = (callback) => callback(sql);
    sql.json = (value) => value;
    await assert.rejects(runStockObservation({
      now: () => now,
      database: { sql, householdId: async () => "22222222-2222-4222-8222-222222222222" },
      env: {},
      collectMessages: async ({ since, knownProviderMessageIds }) => {
        assert.equal(since.toISOString(), expected.toISOString());
        assert.equal(databaseSince.toISOString(), since.toISOString());
        assert.deepEqual(knownProviderMessageIds, ["<boundary-invoice@example.test>"]);
        throw Object.assign(new Error("End boundary fixture before any provider or forecast work."), { code: "BOUNDARY_TEST_STOP" });
      },
    }), { code: "BOUNDARY_TEST_STOP" });
    assert.equal(now.getTime(), new Date(instant).getTime());
  }
});

test("the runner fails instead of silently degrading when either WhatsApp group is missing", async () => {
  const transaction = async () => [];
  const sql = async () => [];
  sql.begin = async (callback) => callback(transaction);
  sql.json = (value) => value;
  transaction.json = (value) => value;
  await assert.rejects(
    runStockObservation({
      env: {},
      now: () => new Date("2026-08-24T09:00:00.000Z"),
      database: {
        sql,
        async householdId() {
          return "22222222-2222-4222-8222-222222222222";
        },
      },
      collectMessages: async () => ({
        envelopesFound: 0,
        envelopesSkippedKnown: 0,
        messages: [],
      }),
      collectWhatsAppObservations: async () => {
        throw Object.assign(new Error("Both groups are required."), {
          code: "AIRBNB_STOCK_WHATSAPP_GROUPS_REQUIRED",
        });
      },
    }),
    (error) => error.code === "AIRBNB_STOCK_WHATSAPP_GROUPS_REQUIRED",
  );
});

test("stock drains one Ping before ingestion only in live mode and persists its outcome", async () => {
  for (const mode of ["live", "observation"]) {
    const calls = [];
    const database = emptyDatabase(calls);
    const retry = { notifications: [{ id: "retry", pingStatus: "accepted" }], error: null };
    const notice = { notificationId: "fresh", verified: true, pingStatus: "failed", pingError: "permanent:invalid_api_key" };
    const receipt = await runStockObservation({ mode, database, env: liveEnv,
      now: () => new Date("2026-09-22T10:00:00Z"),
      retryManagementPings: async ({ sql, householdId, sourceService, limit }) => {
        calls.push("ping");
        assert.equal(sql, database.sql);
        assert.equal(householdId, await database.householdId());
        assert.equal(sourceService, "stock");
        assert.equal(limit, 1);
        return retry;
      },
      collectMessages: async () => { calls.push("mail"); return { messages: [], envelopesFound: 0 }; },
      collectWhatsAppObservations: async () => ({ observations: [], messagesFound: 0 }),
      notifyManagement: async () => { calls.push("notify"); return [notice]; },
    });
    if (mode === "live") {
      assert.deepEqual(calls.slice(0, 4), ["job-start", "ping", "known-mail", "mail"]);
      assert.deepEqual(receipt.managementPingRetry, retry);
      assert.deepEqual(receipt.managementNotifications, [notice]);
      assert.equal(receipt.managementPingAcceptedCount, 1);
      assert.equal(receipt.managementPingFailedCount, 1);
    } else {
      assert.ok(!calls.includes("ping"));
      assert.ok(!calls.includes("notify"));
      assert.equal(receipt.managementPingAcceptedCount, 0);
      assert.equal(receipt.managementPingFailedCount, 0);
      assert.deepEqual(receipt.managementPingRetry, { notifications: [], error: null });
    }
    assert.deepEqual(database.receipts, [receipt]);
  }
});

test("stock retry outcome survives a later mailbox failure", async () => {
  const calls = [];
  const database = emptyDatabase(calls);
  const retry = { notifications: [{ id: "retry", pingStatus: "failed", pingError: "retryable:network_or_timeout" }], error: null };
  await assert.rejects(runStockObservation({ mode: "live", database, env: liveEnv,
    retryManagementPings: async () => { calls.push("ping"); return retry; },
    collectMessages: async () => { calls.push("mail"); throw Object.assign(new Error("Mock mailbox failure"), { code: "MOCK_MAIL_FAILURE" }); },
    collectWhatsAppObservations: async () => assert.fail("must not reach WhatsApp evidence"),
    notifyManagement: async () => assert.fail("must not send a new notification"),
  }), { code: "MOCK_MAIL_FAILURE" });
  assert.deepEqual(calls, ["job-start", "ping", "known-mail", "mail"]);
  assert.equal(database.receipts[0].status, "error");
  assert.deepEqual(database.receipts[0].managementPingRetry, retry);
});

test("stock drain persistence error is retained without stopping normal ingestion", async () => {
  const database = emptyDatabase();
  const retry = { notifications: [], error: "ping_drain_not_persisted" };
  let ingested = false;
  const receipt = await runStockObservation({ mode: "live", database, env: liveEnv,
    retryManagementPings: async () => retry,
    collectMessages: async () => { ingested = true; return { messages: [], envelopesFound: 0 }; },
    collectWhatsAppObservations: async () => ({ observations: [], messagesFound: 0 }),
    notifyManagement: async () => [],
  });
  assert.equal(ingested, true);
  assert.equal(receipt.status, "success");
  assert.equal(receipt.managementPingRetryError, retry.error);
  assert.deepEqual(database.receipts[0].managementPingRetry, retry);
});

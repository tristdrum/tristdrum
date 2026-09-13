import assert from "node:assert/strict";
import test from "node:test";
import { runStockObservation, stockPlanningWindow } from "./runner.mjs";

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

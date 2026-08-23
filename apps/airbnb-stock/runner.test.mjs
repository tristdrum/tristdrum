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

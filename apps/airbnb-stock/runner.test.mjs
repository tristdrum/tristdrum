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

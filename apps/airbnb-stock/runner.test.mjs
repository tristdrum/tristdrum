import assert from "node:assert/strict";
import test from "node:test";
import { stockPlanningWindow } from "./runner.mjs";

test("today's reconciled arrivals are excluded from the next seven forecast dates", () => {
  assert.deepEqual(stockPlanningWindow("2026-08-21"), {
    consumptionThroughDate: "2026-08-21",
    forecastStartDate: "2026-08-22",
    forecastEndDate: "2026-08-28",
  });
});

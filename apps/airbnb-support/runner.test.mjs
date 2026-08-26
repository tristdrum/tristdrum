import assert from "node:assert/strict";
import test from "node:test";

import { canReuseStoredDecision } from "./runner.mjs";

const liveDecision = {
  decisionSource: "adaptive_agent",
  decisionVersion: 2,
  shadowMode: false,
};

test("only successful adaptive decisions from the same runtime mode are cached", () => {
  assert.equal(canReuseStoredDecision(liveDecision, "live"), true);
  assert.equal(canReuseStoredDecision({ ...liveDecision, shadowMode: true }, "shadow"), true);
  assert.equal(canReuseStoredDecision({ ...liveDecision, shadowMode: true }, "live"), false);
  assert.equal(canReuseStoredDecision({ decisionSource: "decision_error" }, "live"), false);
  assert.equal(canReuseStoredDecision({ ...liveDecision, decisionVersion: 1 }, "live"), false);
});

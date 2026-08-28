import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReplyRouteGuard,
  canReuseStoredDecision,
  earlierOfRecentCursor,
  summarizeDeliveryOutcomes,
} from "./runner.mjs";

const liveDecision = {
  decisionSource: "adaptive_agent",
  decisionVersion: 2,
  shadowMode: false,
};

test("support cursor overlap bounds repeated Gmail work without weakening first import", () => {
  const now = new Date("2026-08-28T18:25:00.000Z");
  const cursor = new Date("2026-08-28T17:57:13.000Z");
  assert.equal(
    earlierOfRecentCursor(now, cursor, 90, 360).toISOString(),
    "2026-08-28T11:57:13.000Z",
  );
  assert.equal(
    earlierOfRecentCursor(now, cursor, 90, 30).toISOString(),
    "2026-08-28T16:57:13.000Z",
  );
  assert.equal(
    earlierOfRecentCursor(now, null, 90, 360).toISOString(),
    new Date(now.getTime() - 90 * 86_400_000).toISOString(),
  );
});

test("only successful adaptive decisions from the same runtime mode are cached", () => {
  assert.equal(canReuseStoredDecision(liveDecision, "live"), true);
  assert.equal(canReuseStoredDecision({ ...liveDecision, shadowMode: true }, "shadow"), true);
  assert.equal(canReuseStoredDecision({ ...liveDecision, shadowMode: true }, "live"), false);
  assert.equal(canReuseStoredDecision({ decisionSource: "decision_error" }, "live"), false);
  assert.equal(canReuseStoredDecision({ ...liveDecision, decisionVersion: 1 }, "live"), false);
  assert.equal(canReuseStoredDecision({
    ...liveDecision,
    deterministicGuard: "initial_inquiry_requires_airbnb_ui",
  }, "live", { replyCapable: true }), false);
});

test("initial inquiries without an SMTP reply route are held and escalated", () => {
  const guarded = applyReplyRouteGuard({
    replyNeeded: true,
    autoReply: true,
    status: "approved_for_guard",
    alertManagement: false,
    riskTier: "low",
    draft: "A useful monthly-rate acknowledgement.",
  }, {
    sourceKind: "initial_inquiry",
    replyRequired: true,
    replyCapable: false,
  });
  assert.equal(guarded.replyNeeded, true);
  assert.equal(guarded.autoReply, false);
  assert.equal(guarded.alertManagement, true);
  assert.equal(guarded.deterministicGuard, "initial_inquiry_requires_airbnb_ui");
  assert.equal(guarded.draft, "A useful monthly-rate acknowledgement.");
});

test("retry-safe guard failures are not reported as delivery ambiguity", () => {
  assert.deepEqual(summarizeDeliveryOutcomes([
    { action: "sent" },
    { action: "mark_sent" },
    { action: "ambiguous" },
    { action: "guard_error" },
    { action: "not_claimed" },
  ]), {
    deliveredReplyCount: 1,
    reconciledReplyCount: 1,
    deliveryAmbiguousCount: 1,
    deliveryGuardErrorCount: 1,
  });
});

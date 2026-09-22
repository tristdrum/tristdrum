import assert from "node:assert/strict";
import test from "node:test";
import { supportTimeRequestDecision } from "./support.mjs";

const facts = { checkInTime: "15:00", checkOutTime: "10:00", earliestCheckInTime: "13:00" };
const extraction = { extracted: true, stay: { checkIn: "2026-09-22", checkOut: "2026-09-24" } };

test("declarative timing parsing is scoped to full-context room extraction", () => {
  for (const text of ["The guest expects to arrive at 16:20.", "The guest will arrive after 17.",
    "Late check-in on 2026-09-22, time unspecified.", "Early check-out on 2026-09-24, time unspecified.",
    "The guest is leaving at 05:00."]) {
    assert.equal(supportTimeRequestDecision(text, facts), null);
    const decision = supportTimeRequestDecision(text, facts, extraction);
    assert.equal(decision.action, "standard_time");
    assert.equal(decision.createsOperationalRequest, false);
    assert.equal(decision.needsCleanerNotification, false);
  }
  assert.equal(supportTimeRequestDecision("The guest accepts the arrangement.", facts, extraction), null);
});

test("extracted timing retains early-entry readiness and late-checkout decline", () => {
  for (const [text, action, effectiveTime] of [
    ["Check-in on 2026-09-22 at 12:00.", "offer_earliest", "13:00"],
    ["Check-in on 2026-09-22 at 13:00.", "accept_conditional", "13:00"],
    ["Check-in on 2026-09-22 at 14:00.", "accept_conditional", "14:00"],
    ["Check-out on 2026-09-24 at 12:00.", "decline", "10:00"],
    ["Late check-out on 2026-09-24, time unspecified.", "decline", "10:00"],
  ]) {
    const decision = supportTimeRequestDecision(text, facts, extraction);
    assert.equal(decision.action, action);
    assert.equal(decision.effectiveTime, effectiveTime);
    assert.equal(decision.createsOperationalRequest, action === "accept_conditional");
  }
  const earlierDay = supportTimeRequestDecision("Check-out on 2026-09-23 at 17:00.", facts, extraction);
  assert.equal(earlierDay.action, "standard_time");
  assert.equal(earlierDay.createsOperationalRequest, false);
});

test("overnight access uses the actual local date, not only the hour", () => {
  for (const [text, action] of [
    ["Check-in on 2026-09-22 at 01:00.", "offer_earliest"],
    ["Check-in on 2026-09-23 at 01:00.", "standard_time"],
    ["Check-in on 2026-09-24 at 01:00.", "standard_time"],
    ["Check-in on 2026-09-24 at 10:00.", "outside_stay"],
    ["Late check-in on 2026-09-24, time unspecified.", "ask_time"],
    ["Check-in after midnight on 2026-09-24, time unspecified.", "ask_time"],
    ["Check-in on 2026-09-21 at 23:00.", "outside_stay"],
    ["Check-in on 2026-09-25 at 01:00.", "outside_stay"],
    ["Check-in after midnight, date unspecified.", "clarify_date"],
    ["Check-in at 01:00, date unspecified.", "clarify_date"],
    ["Check-in on 2026-02-30 at 01:00.", "clarify_date"],
  ]) {
    assert.equal(supportTimeRequestDecision(text, facts, extraction).action, action, text);
  }
  assert.equal(supportTimeRequestDecision("Check-in on 2026-09-23 at 01:00.", facts, { extracted: true }).action, "clarify_date");
});

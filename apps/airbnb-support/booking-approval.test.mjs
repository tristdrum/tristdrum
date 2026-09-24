import assert from "node:assert/strict";
import test from "node:test";

import { bookingApprovalDecision } from "./booking-approval.mjs";

const clear = {
  evidenceVerified: true,
  identityVerified: true,
  capacityClear: true,
  dateCountClear: true,
  reviewCount: 0,
  rating: null,
  negativeReview: false,
  partyConcern: false,
  safetyConcern: false,
  conflict: false,
};

test("verified first-time guests and clear rated guests are eligible, without an acceptance write", () => {
  assert.deepEqual(bookingApprovalDecision(clear), {
    decision: "approve", reason: "first_time_clear",
  });
  assert.deepEqual(bookingApprovalDecision({ ...clear, reviewCount: 3, rating: 4.5 }), {
    decision: "approve", reason: "rated_clear",
  });
  assert.equal(bookingApprovalDecision({ ...clear, reviewCount: 12, rating: 5 }).decision, "approve");
});

test("low ratings, negative reviews, party/safety concerns, or conflicts always need human review", () => {
  for (const change of [
    { reviewCount: 2, rating: 4.49 },
    { negativeReview: true },
    { partyConcern: true },
    { safetyConcern: true },
    { conflict: true },
    { evidenceVerified: false },
    { identityVerified: false },
    { capacityClear: false },
    { dateCountClear: false },
    { reviewCount: 1, rating: null },
    { reviewCount: 0, rating: 4.9 },
  ]) {
    assert.equal(bookingApprovalDecision({ ...clear, ...change }).decision, "human_review");
  }
});

test("missing safety evidence is not treated as clearance and no path auto-declines", () => {
  for (const key of ["evidenceVerified", "identityVerified", "capacityClear", "dateCountClear",
    "negativeReview", "partyConcern", "safetyConcern", "conflict", "reviewCount"]) {
    const incomplete = { ...clear };
    delete incomplete[key];
    assert.equal(bookingApprovalDecision(incomplete).decision, "human_review");
  }
  assert.equal(bookingApprovalDecision().decision, "human_review");
});

/**
 * A policy recommendation only. The browser pilot must recheck current UI state
 * and obtain its own typed action authority before accepting a booking.
 *
 * @param {{ evidenceVerified?: boolean, identityVerified?: boolean,
 *   capacityClear?: boolean, dateCountClear?: boolean, reviewCount?: number,
 *   rating?: number|null, negativeReview?: boolean, partyConcern?: boolean,
 *   safetyConcern?: boolean, conflict?: boolean }} evidence
 * @returns {{ decision: 'approve'|'human_review', reason: string }}
 */
export function bookingApprovalDecision(evidence = {}) {
  const review = (reason) => ({ decision: "human_review", reason });
  if (evidence.evidenceVerified !== true) return review("unverified_evidence");
  if (evidence.negativeReview !== false || evidence.partyConcern !== false
    || evidence.safetyConcern !== false || evidence.conflict !== false) {
    return review("concern_or_unknown");
  }
  if (evidence.identityVerified !== true || evidence.capacityClear !== true
    || evidence.dateCountClear !== true) return review("identity_capacity_or_dates_unclear");

  const count = evidence.reviewCount;
  const rating = evidence.rating;
  if (!Number.isInteger(count) || count < 0) return review("review_history_unclear");
  if (count === 0 && rating == null) return { decision: "approve", reason: "first_time_clear" };
  if (count > 0 && typeof rating === "number" && Number.isFinite(rating)
    && rating >= 4.5 && rating <= 5) {
    return { decision: "approve", reason: "rated_clear" };
  }
  return review("rating_or_review_history_requires_review");
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  isAirbnbBookingLifecycleSubject,
  parseAirbnbBookingLifecycleEmail,
} from "./booking-lifecycle.mjs";

test("Airbnb non-payment dismissal becomes a precise booking lifecycle event", () => {
  const subject = "Sep 4 – 6 request at Bougainvillea Courtyard Studio dismissed - no payment";
  assert.equal(isAirbnbBookingLifecycleSubject(subject), true);
  assert.deepEqual(parseAirbnbBookingLifecycleEmail({
    from: "automated@airbnb.com",
    subject,
    occurredAt: "2026-08-26T10:23:00.000Z",
    body: [
      "Hi Jane,",
      "We’re sorry to let you know that we didn’t receive payment from Somila for their Sep 4 – 6",
      "reservation request at Bougainvillea Courtyard Studio.",
      "The reservation request has been automatically declined without any penalty to you.",
    ].join("\n"),
  }), {
    kind: "request_expired",
    reason: "nonpayment",
    guestName: "Somila",
    unitNumber: 1,
    listingName: "Bougainvillea Courtyard Studio",
    checkIn: "2026-09-04",
    checkOut: "2026-09-06",
  });
});

test("booking lifecycle parsing rejects untrusted or ambiguous evidence", () => {
  const event = {
    from: "attacker@example.test",
    subject: "Sep 4 - 6 request at Bougainvillea Courtyard Studio dismissed - no payment",
    occurredAt: "2026-08-26T10:23:00.000Z",
    body: "We didn't receive payment from Somila for their Sep 4 - 6 reservation request.",
  };
  assert.equal(parseAirbnbBookingLifecycleEmail(event), null);
  assert.equal(parseAirbnbBookingLifecycleEmail({ ...event, from: "automated@airbnb.com", body: "No details" }), null);
});


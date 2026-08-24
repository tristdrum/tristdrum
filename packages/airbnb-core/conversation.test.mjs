import assert from "node:assert/strict";
import test from "node:test";
import { parseAirbnbConversationEmail } from "./conversation.mjs";

function conversationEmail({
  from = "express@airbnb.com",
  subject,
  heading,
  includeThread = true,
}) {
  return {
    providerMessageId: `mail-${subject}`,
    from,
    subject,
    occurredAt: "2026-08-24T10:00:00Z",
    body: [
      heading,
      "For your protection and safety, always communicate through Airbnb.",
      "SAMPLE GUEST",
      "Guest",
      "Could you please help?",
      "Reply",
      includeThread
        ? "https://www.airbnb.co.za/hosting/thread/2635168007?thread_type=home_booking"
        : "https://www.airbnb.co.za/help",
    ].join("\n"),
  };
}

test("Airbnb conversation parser accepts reservation, inquiry, and reservation-request replies", () => {
  const cases = [
    {
      subject: "RE: Reservation for Jasmine Studio Stay, Aug 24 - 25",
      heading: "RESERVATION FOR JASMINE STUDIO STAY, AUG 24 - 25",
    },
    {
      subject: "RE: Inquiry for The Spekboom Studio, Aug 24 - 25",
      heading: "INQUIRY FOR THE SPEKBOOM STUDIO, AUG 24 - 25",
    },
    {
      subject: "RE: Reservation request for Bougainvillea Courtyard Studio, Aug 24 - 25",
      heading: "RESERVATION REQUEST FOR BOUGAINVILLEA COURTYARD STUDIO, AUG 24 - 25",
    },
    {
      subject: "RE: Reservation Request at Jasmine Studio Stay for Aug 24 - 25, 2026",
      heading: "RESERVATION REQUEST AT JASMINE STUDIO STAY FOR AUG 24 - 25, 2026",
    },
  ];

  for (const fixture of cases) {
    const parsed = parseAirbnbConversationEmail(conversationEmail(fixture));
    assert.ok(parsed, fixture.subject);
    assert.equal(parsed.providerThreadId, "2635168007", fixture.subject);
    assert.match(parsed.listingName, /Jasmine|Spekboom|Bougainvillea/i, fixture.subject);
    assert.match(parsed.stayLabel, /Aug 24 - 25/i, fixture.subject);
  }
});

test("Airbnb conversation parser still requires a trusted sender and hosting thread URL", () => {
  const fixture = {
    subject: "RE: Inquiry for The Spekboom Studio, Aug 24 - 25",
    heading: "INQUIRY FOR THE SPEKBOOM STUDIO, AUG 24 - 25",
  };
  assert.equal(parseAirbnbConversationEmail(conversationEmail({
    ...fixture,
    from: "guest@example.com",
  })), null);
  assert.equal(parseAirbnbConversationEmail(conversationEmail({
    ...fixture,
    includeThread: false,
  })), null);
});

test("Airbnb conversation parser rejects unrelated Airbnb reply subjects", () => {
  const parsed = parseAirbnbConversationEmail(conversationEmail({
    subject: "RE: Your Airbnb payout",
    heading: "YOUR AIRBNB PAYOUT",
  }));
  assert.equal(parsed, null);
});

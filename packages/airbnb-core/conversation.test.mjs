import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAirbnbConversationEmail,
  parseAirbnbInitialInquiryEmail,
} from "./conversation.mjs";

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

test("Airbnb conversation parser accepts reservation, inquiry, pre-approval, and reservation-request replies", () => {
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
      subject: "RE: Pre-approval for Jasmine Studio Stay, Sep 25 - 26",
      heading: "PRE-APPROVAL FOR JASMINE STUDIO STAY, SEP 25 - 26",
      stayPattern: /Sep 25 - 26/i,
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
    assert.match(parsed.stayLabel, fixture.stayPattern ?? /Aug 24 - 25/i, fixture.subject);
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

test("initial Airbnb inquiry notices become non-SMTP support conversations", () => {
  const parsed = parseAirbnbInitialInquiryEmail({
    providerMessageId: "<initial-inquiry@example.test>",
    from: "automated@airbnb.com",
    subject: "Inquiry for Jasmine Studio Stay for Sep 15 – 17, 2026",
    occurredAt: "2026-08-26T16:36:00Z",
    body: [
      "RESPOND TO PRINSLOO’S INQUIRY",
      "Prinsloo",
      "https://www.airbnb.co.za/hosting/thread/2647473081?thread_type=home_booking",
      "Identity verified · 9 reviews",
      "good day. I am looking to book 3 months. Sep-Nov.",
      "what will be your monthly rate. thanks",
      "Pre-approve / Decline",
    ].join("\n"),
  });
  assert.equal(parsed.providerThreadId, "2647473081");
  assert.equal(parsed.listingName, "Jasmine Studio Stay");
  assert.match(parsed.stayLabel, /Sep 15 – 17, 2026/);
  assert.equal(parsed.entries[0].name, "Prinsloo");
  assert.match(parsed.entries[0].text, /monthly rate/i);
  assert.equal(parsed.replyRequired, true);
  assert.equal(parsed.replyCapable, false);
});

test("initial inquiries converge with later express thread copies", () => {
  const cases = [
    {
      threadId: "2647469620",
      listing: "Bougainvillea Courtyard Studio",
      stay: "Sep 15 - 18, 2026",
      text: "good day. I would like to book for 3 months. Sep-Nov. what will be your monthly rate",
    },
    {
      threadId: "2647473081",
      listing: "Jasmine Studio Stay",
      stay: "Sep 15 - 17, 2026",
      text: "good day. I am looking to book 3 months. Sep-Nov. what will be your monthly rate. thanks",
    },
  ];
  for (const fixture of cases) {
    const initial = parseAirbnbInitialInquiryEmail({
      providerMessageId: `<initial-${fixture.threadId}@example.test>`,
      from: "automated@airbnb.com",
      subject: `Inquiry for ${fixture.listing} for ${fixture.stay}`,
      occurredAt: "2026-08-26T16:32:00Z",
      body: [
        "RESPOND TO PRINSLOO'S INQUIRY",
        "Prinsloo",
        `https://www.airbnb.co.za/hosting/thread/${fixture.threadId}?thread_type=home_booking`,
        "Identity verified · 9 reviews",
        fixture.text,
        "Pre-approve / Decline",
      ].join("\n"),
    });
    const reply = parseAirbnbConversationEmail({
      providerMessageId: `<reply-${fixture.threadId}@example.test>`,
      from: "express@airbnb.com",
      subject: `RE: Inquiry for ${fixture.listing}, ${fixture.stay}`,
      occurredAt: "2026-08-26T16:40:00Z",
      replyTo: "reply-token@reply.airbnb.com",
      body: [
        `INQUIRY FOR ${fixture.listing.toUpperCase()}, ${fixture.stay.toUpperCase()}`,
        "For your protection and safety, always communicate through Airbnb.",
        "PRINSLOO",
        "Booker",
        fixture.text,
        "Reply",
        `https://www.airbnb.co.za/hosting/thread/${fixture.threadId}?thread_type=home_booking`,
      ].join("\n"),
    });
    assert.equal(initial.providerThreadId, reply.providerThreadId);
    assert.notEqual(initial.entries[0].contentHash, reply.entries[0].contentHash);
    assert.equal(initial.entries[0].canonicalContentHash, reply.entries[0].canonicalContentHash);
    assert.equal(initial.canonicalSourceFingerprint, reply.canonicalSourceFingerprint);
  }
});

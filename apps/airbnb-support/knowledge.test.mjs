import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORT_KNOWLEDGE, supportKnowledgeForListing } from "./knowledge.mjs";

test("quiet self-service policy preserves booked-date, early-entry, and mixed-issue boundaries", () => {
  assert.deepEqual(SUPPORT_KNOWLEDGE.sharedFacts.selfService, {
    checkIn: true, checkOut: true, staffAttendanceRequired: false,
  });
  const text = SUPPORT_KNOWLEDGE.policies.join(" ");
  assert.match(text, /15:00 on the booked arrival date.*10:00 on the booked departure date/);
  assert.match(text, /late arrival, even without an exact clock.*early departure/);
  assert.match(text, /after midnight within a stay already begun is ordinary self check-in/i);
  assert.match(text, /conditional 13:00 earliest-entry rule still applies/);
  assert.match(text, /Late check-out requests are politely declined/);
  assert.match(text, /unresolved lockout, missing access facts, safety issue/);
  assert.match(text, /prior delivered Management alert summaries/);
});

test("support knowledge identifies each canonical listing without storing private details", () => {
  const jasmine = supportKnowledgeForListing({ listingName: "Jasmine Studio Stay" });
  assert.equal(jasmine.listingRecognized, true);
  assert.equal(jasmine.property.unitNumber, 3);
  assert.equal(jasmine.property.listingName, "Jasmine Studio Stay");
  assert.match(jasmine.property.cautions[0], /conflict/i);
  assert.equal(jasmine.knownProperties.length, 3);
  assert.deepEqual(jasmine.sharedFacts.bagDrop, {
    allowedAfter: "The previous guest has actually checked out.",
    usualFromTime: "10:00",
    delayedByLateDeparture: true,
    grantsRoomAccess: false,
  });
  assert.match(jasmine.policies.join(" "), /always welcome to drop bags after the previous guest has actually checked out/i);
  assert.match(jasmine.policies.join(" "), /does not mean the studio is ready/i);
  assert.equal(jasmine.approvedResponsePatterns.generalPostStayImprovementFeedback.autoReplyEligible, true);
  assert.match(
    jasmine.approvedResponsePatterns.generalPostStayImprovementFeedback.approach,
    /take(?:n)? on board.*not up to scratch.*make it right next time/i,
  );
  assert.match(
    jasmine.approvedResponsePatterns.generalPostStayImprovementFeedback.constraints,
    /do not invent the hidden review contents/i,
  );

  const serialized = JSON.stringify(SUPPORT_KNOWLEDGE);
  assert.doesNotMatch(serialized, /@gmail\.com|\/hosting\/thread\//i);
  assert.doesNotMatch(serialized, /"(?:wifi|password|accessCode|doorCode)"\s*:/i);
  assert.doesNotMatch(serialized, /\b\d{8,}\b/);
});

test("support knowledge leaves an unknown listing unresolved", () => {
  const knowledge = supportKnowledgeForListing({ listingName: "A different property" });
  assert.equal(knowledge.listingRecognized, false);
  assert.equal(knowledge.property, null);
  assert.match(knowledge.policies.join(" "), /missing or contradictory/i);
});

test("each known studio supplies its verified public listing link without implying availability", () => {
  const expected = {
    "Bougainvillea Courtyard Studio": "https://www.airbnb.com/h/bougainvillea-courtyard-studio",
    "The Spekboom Studio": "https://www.airbnb.com/h/the-spekboom-studio",
    "Jasmine Studio Stay": "https://www.airbnb.com/h/jasmine-studio-stay",
  };
  for (const [listingName, url] of Object.entries(expected)) {
    const knowledge = supportKnowledgeForListing({ listingName });
    assert.equal(knowledge.property.publicListingUrl, url);
    assert.deepEqual(Object.fromEntries(knowledge.knownProperties.map((p) => [p.listingName, p.publicListingUrl])), expected);
    assert.match(knowledge.policies.join(" "), /link is not evidence of vacancy/);
    assert.match(knowledge.policies.join(" "), /instead of only promising to check/);
    assert.ok(Object.isFrozen(knowledge.property));
  }
});

test("office permission overrides only studio storage conditions without inventing collection or timing facts", () => {
  const text = SUPPORT_KNOWLEDGE.policies.join(" ");
  assert.match(text, /ALWAYS welcome.*office.*verified location/);
  assert.match(text, /Studio checkout and late-departure conditions do not restrict office storage/);
  assert.match(text, /does not grant studio entry or extend checkout/);
  assert.match(text, /Do not invent staffed hours or lost-property collection availability/);
  assert.match(text, /Ask which day if the date is unknown/);
  assert.match(text, /drop-off time stays null.*pickup-until time is not a drop-off time/);
});

test("support knowledge records real time conflicts but accepts equivalent formats", () => {
  const conflict = supportKnowledgeForListing({
    listingName: "The Spekboom Studio",
    propertyFacts: { checkInTime: "14:00", checkOutTime: "10:00" },
  });
  assert.deepEqual(conflict.conflicts.map((item) => item.key), ["checkInTime"]);
  assert.deepEqual(conflict.conflicts[0].topics, ["check_in_time"]);

  const equivalent = supportKnowledgeForListing({
    listingName: "The Spekboom Studio",
    propertyFacts: { checkInTime: "3:00 PM", checkOutTime: "10am" },
  });
  assert.deepEqual(equivalent.conflicts, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORT_KNOWLEDGE, supportKnowledgeForListing } from "./knowledge.mjs";

test("support knowledge identifies each canonical listing without storing private details", () => {
  const jasmine = supportKnowledgeForListing({ listingName: "Jasmine Studio Stay" });
  assert.equal(jasmine.listingRecognized, true);
  assert.equal(jasmine.property.unitNumber, 3);
  assert.equal(jasmine.property.listingName, "Jasmine Studio Stay");
  assert.match(jasmine.property.cautions[0], /conflict/i);
  assert.equal(jasmine.knownProperties.length, 3);

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

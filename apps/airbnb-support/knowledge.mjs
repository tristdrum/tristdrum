import { AIRBNB_PROPERTIES, propertyForListing } from "@tristdrum/airbnb-core";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const PROPERTY_CAUTIONS = Object.freeze({
  "Jasmine Studio Stay": Object.freeze([
    "Historical descriptions of the cooking facilities conflict. Use a current verified property fact or ask a host to confirm.",
  ]),
});

export const SUPPORT_KNOWLEDGE = deepFreeze({
  sharedFacts: {
    area: "Nahoon, East London",
    standardCheckInTime: "15:00",
    standardCheckOutTime: "10:00",
    earliestConditionalCheckInTime: "13:00",
    bagDrop: {
      allowedAfter: "The previous guest has actually checked out.",
      usualFromTime: "10:00",
      delayedByLateDeparture: true,
      grantsRoomAccess: false,
    },
    propertyLayout: "Three separately listed studios share one property.",
  },
  policies: [
    "Write like a helpful host: friendly, brief, natural, and specific to the guest's question.",
    "Use runtime property facts for exact address, directions, parking, Wi-Fi, access instructions, and current amenities.",
    "Never guess availability, prices, refunds, reservation changes, exceptions, safety details, or an unverified amenity.",
    "When a fact is missing or contradictory, say that it needs checking instead of choosing the most convenient answer.",
    "Historical examples guide tone and problem-solving, but they do not make a changing property detail current.",
    "Early check-in may be offered from 13:00, but it is always conditional on the previous guest and cleaning being finished.",
    "Guests are always welcome to drop bags after the previous guest has actually checked out. This is normally from 10:00; if the previous guest leaves late, bag drop starts only after their actual departure.",
    "Bag drop is luggage storage only. It does not mean the studio is ready and never grants room access before cleaning readiness is confirmed.",
    "When a past guest says they submitted general improvement feedback or a review without naming a concrete issue, reply with sincere thanks, take the feedback on board, apologise gently for anything that was not up to scratch, and commit to learning and making it right next time.",
    "Late check-out requests are politely declined so the studio can be prepared for the next guest.",
  ],
  approvedResponsePatterns: {
    generalPostStayImprovementFeedback: {
      autoReplyEligible: true,
      appliesWhen: "A past guest says they submitted general improvement feedback or a review without naming a concrete issue that requires action.",
      approach: "Thank them genuinely for their time, say the feedback will be taken on board, apologise for anything that was not up to scratch, and say the hosts will learn from it and make it right next time.",
      escalation: "Do not alert Management solely for general feedback. Alert when the guest names a safety, maintenance, refund, reservation, or urgent issue requiring action.",
      constraints: "Do not invent the hidden review contents, claim to have read feedback that is not visible, or promise compensation.",
    },
  },
  precedents: [
    {
      situation: "The requested booking date is ambiguous.",
      approach: "Ask one short clarifying question before discussing availability.",
    },
    {
      situation: "A guest asks about availability, a booking decision, or a reservation change.",
      approach: "Acknowledge the request and offer to check; do not promise, accept, decline, or change anything in the draft.",
    },
    {
      situation: "A guest asks for a distance or travel time.",
      approach: "Use a verified location fact and make clear that the estimate is approximate; otherwise offer to check.",
    },
    {
      situation: "A guest asks for room access before 13:00 and offers to drop bags instead.",
      approach: "Keep early room access subject to the 13:00 readiness policy, but welcome a bag drop after the previous guest's actual checkout, normally from 10:00.",
    },
    {
      situation: "A guest reports a problem during the stay.",
      approach: "Acknowledge the specific problem warmly, apologise for the inconvenience, and ask only the detail needed for a host to act.",
    },
    {
      situation: "A past guest says they left improvement feedback or a review, but does not name the issues.",
      approach: "Send a warm, accountable thank-you automatically without inventing details; take it on board, apologise for anything not up to scratch, and commit to doing better next time.",
    },
    {
      situation: "A historical host reply conflicts with current listing or property data.",
      approach: "Treat the detail as unknown and ask a host to confirm it.",
    },
  ],
  standingUncertainties: [
    "Access instructions and codes can change and must come from current runtime property facts.",
    "Availability and reservation status are live operational facts and cannot be inferred from conversation history.",
    "Amenities mentioned in an old conversation are not current facts unless the property record confirms them.",
  ],
});

export function normalizedClock(value) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  const meridiem = match[3]?.toLowerCase();
  if (hour > 23 || minute > 59 || (meridiem && (hour < 1 || hour > 12))) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeConflict({ key, topic, canonicalValue, propertyFacts }) {
  const runtimeValue = propertyFacts?.[key];
  const canonicalClock = normalizedClock(canonicalValue);
  const runtimeClock = normalizedClock(runtimeValue);
  if (!canonicalClock || !runtimeClock || canonicalClock === runtimeClock) return null;
  return {
    key,
    topics: [topic],
    canonicalValue,
    runtimeValue,
    handling: "Ask a host to confirm before replying.",
  };
}

export function supportKnowledgeForListing({ listingName, propertyFacts = {} } = {}) {
  const property = propertyForListing(listingName);
  const propertyScope = property
    ? {
      unitNumber: property.unitNumber,
      commonName: property.commonName,
      listingName: property.listingName,
      currentDetailsSource: "runtime property facts",
      cautions: PROPERTY_CAUTIONS[property.listingName] ?? [],
    }
    : null;
  const conflicts = [
    timeConflict({
      key: "checkInTime",
      topic: "check_in_time",
      canonicalValue: SUPPORT_KNOWLEDGE.sharedFacts.standardCheckInTime,
      propertyFacts,
    }),
    timeConflict({
      key: "checkOutTime",
      topic: "check_out_time",
      canonicalValue: SUPPORT_KNOWLEDGE.sharedFacts.standardCheckOutTime,
      propertyFacts,
    }),
  ].filter(Boolean);

  return deepFreeze({
    ...SUPPORT_KNOWLEDGE,
    knownProperties: AIRBNB_PROPERTIES.map((knownProperty) => ({
      unitNumber: knownProperty.unitNumber,
      commonName: knownProperty.commonName,
      listingName: knownProperty.listingName,
    })),
    property: propertyScope,
    listingRecognized: Boolean(propertyScope),
    conflicts,
  });
}

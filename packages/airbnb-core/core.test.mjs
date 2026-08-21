import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATED_REPLY_FOOTER,
  buildShoppingList,
  canonicalConversationActor,
  decideOrderEvidence,
  finalSendDecision,
  forecastInventoryDemand,
  propertyForListing,
  projectInventory,
  setupGuestCount,
  supportDisposition,
  trustedAirbnbSender,
  withAutomatedReplyFooter,
} from "./index.mjs";

test("property mapping preserves the three cleaner units and spelling aliases", () => {
  assert.equal(propertyForListing("Bougenvilla courtyard").unitNumber, 1);
  assert.equal(propertyForListing("The Spekboom Studio").unitNumber, 2);
  assert.equal(propertyForListing("Jasmine Studio Stay").unitNumber, 3);
  assert.equal(propertyForListing("Unrelated listing"), null);
});

test("guest setup totals include children, exclude infants, and preserve the unknown fallback", () => {
  assert.equal(setupGuestCount({ adults: 1, children: 1, infants: 2, guestCountKnown: true }), 2);
  assert.equal(setupGuestCount({ adults: 1, children: 0, infants: 1, guestCountKnown: true }), 1);
  assert.equal(setupGuestCount({ adults: 0, children: 0, infants: 0, guestCountKnown: false }), 2);
});

test("seven-day demand reproduces the 2 / 1 / 1 guest arrival setup with a 25 percent buffer", () => {
  const forecast = forecastInventoryDemand({
    startDate: "2026-07-28",
    reservations: [
      { id: "u1", status: "confirmed", checkIn: "2026-07-28", adults: 1, children: 1, infants: 0 },
      { id: "u2", status: "confirmed", checkIn: "2026-07-28", adults: 1, children: 0, infants: 0 },
      { id: "u3", status: "confirmed", checkIn: "2026-07-28", adults: 1, children: 0, infants: 1 },
      { id: "cancelled", status: "cancelled", checkIn: "2026-07-28", adults: 4, children: 0, infants: 0 },
    ],
  });
  const bySku = new Map(forecast.demand.map((demand) => [demand.sku, demand]));
  assert.deepEqual(forecast.arrivals.map((arrival) => arrival.setupGuests), [2, 1, 1]);
  assert.equal(bySku.get("guest_chocolate").rawDemand, 4);
  assert.equal(bySku.get("guest_chocolate").bufferedDemand, 5);
  assert.equal(bySku.get("milk_250ml").rawDemand, 3);
  assert.equal(bySku.get("milk_250ml").bufferedDemand, 4);
  assert.equal(bySku.get("sugar_portion").rawDemand, 8);
  assert.equal(bySku.get("sugar_portion").bufferedDemand, 10);
});

test("inventory projection flags only genuine three-day runouts and uncertain counts", () => {
  const forecast = forecastInventoryDemand({
    startDate: "2026-08-21",
    reservations: [
      { id: "soon", status: "confirmed", checkIn: "2026-08-23", adults: 2, children: 0, infants: 0 },
      { id: "later", status: "confirmed", checkIn: "2026-08-27", adults: 2, children: 0, infants: 0 },
    ],
  });
  const projected = projectInventory({
    inventoryItems: [
      { sku: "guest_chocolate", displayName: "Chocolates", quantityOnHand: 1, countStatus: "inferred" },
      { sku: "water_500ml", displayName: "Water", quantityOnHand: 10, countStatus: "confirmed" },
    ],
    forecast,
  });
  assert.equal(projected[0].runoutDay, 2);
  assert.equal(projected[0].urgent, true);
  assert.equal(projected[0].countToConfirm, true);
  assert.equal(projected[1].urgent, false);
});

test("shopping list tops a real shortage toward R400 and never places an order", () => {
  const list = buildShoppingList({
    projections: [
      {
        sku: "guest_chocolate",
        displayName: "Chocolates",
        requiredQuantity: 5,
        targetUnitPriceCents: 1_000,
        urgent: true,
        countStatus: "confirmed",
        staplePriority: 10,
      },
      {
        sku: "toilet_roll",
        displayName: "Toilet rolls",
        requiredQuantity: 0,
        targetUnitPriceCents: 5_000,
        urgent: false,
        countStatus: "confirm",
        staplePriority: 20,
      },
    ],
  });
  assert.equal(list.estimatedTotalCents, 40_000);
  assert.equal(list.meetsFreeDeliveryMinimum, true);
  assert.equal(list.orderPlacementAllowed, false);
  assert.deepEqual(list.items.map((item) => item.sku), ["guest_chocolate", "toilet_roll"]);
  assert.deepEqual(list.countsToConfirm, ["toilet_roll"]);
});

test("Sixty60 confirmations are provisional and only a 1 Bowie invoice credits stock", () => {
  assert.deepEqual(decideOrderEvidence({ kind: "confirmation" }), {
    addressStatus: "unknown",
    alertManagement: true,
    creditInventory: false,
    ignore: false,
  });
  assert.equal(decideOrderEvidence({ kind: "invoice", deliveryAddress: "1 Bowie Street, Nahoon" }).creditInventory, true);
  assert.equal(decideOrderEvidence({ kind: "invoice", deliveryAddress: "18 Other Road" }).ignore, true);
});

test("support auto-reply gate is whitelist and verified-facts only", () => {
  assert.equal(supportDisposition({
    topic: "wifi",
    riskTier: "low",
    factsVerified: true,
    confidence: 0.97,
  }).autoReply, true);
  assert.equal(supportDisposition({
    topic: "refund",
    riskTier: "low",
    factsVerified: true,
    confidence: 0.99,
  }).autoReply, false);
  assert.equal(supportDisposition({
    topic: "wifi",
    riskTier: "low",
    factsVerified: false,
    confidence: 0.99,
  }).autoReply, false);
});

test("automated footer is subtle, exact, and idempotent", () => {
  const message = withAutomatedReplyFooter("The Wi-Fi details are in your check-in message.");
  assert.ok(message.endsWith(AUTOMATED_REPLY_FOOTER));
  assert.equal(withAutomatedReplyFooter(message), message);
});

test("final-send guard never races a newer human or guest reply", () => {
  const base = {
    sourceFingerprint: "original",
    latestFingerprint: "original",
    sourceLastEventAt: "2026-08-21T12:00:00Z",
    outboundMessageId: "reply@example.test",
    sentMessageIds: [],
  };
  assert.equal(finalSendDecision({ ...base, latestEvents: [] }).action, "send");
  assert.equal(finalSendDecision({
    ...base,
    latestEvents: [{ direction: "host", occurredAt: "2026-08-21T12:01:00Z" }],
  }).action, "handled_by_human");
  assert.equal(finalSendDecision({
    ...base,
    latestEvents: [
      { direction: "host", occurredAt: "2026-08-21T12:01:00Z" },
      { direction: "guest", occurredAt: "2026-08-21T12:02:00Z" },
    ],
  }).action, "cancel_and_reevaluate");
  assert.equal(finalSendDecision({
    ...base,
    sentMessageIds: ["reply@example.test"],
    latestEvents: [],
  }).action, "mark_sent");
});

test("Airbnb host labels never claim whether Tristan or Jane actually sent", () => {
  assert.deepEqual(canonicalConversationActor({ airbnbRoleLabel: "JANE / Host" }), {
    direction: "host",
    hostIdentity: null,
  });
  assert.equal(canonicalConversationActor({ airbnbRoleLabel: "Guest" }).direction, "guest");
  assert.equal(trustedAirbnbSender("express@airbnb.com"), true);
  assert.equal(trustedAirbnbSender("airbnb@example.com"), false);
});

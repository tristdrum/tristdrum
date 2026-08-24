import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATED_REPLY_FOOTER,
  buildShoppingList,
  canonicalConversationActor,
  classifyInventorySku,
  conversationEntryKey,
  decideOrderEvidence,
  finalSendDecision,
  forecastInventoryDemand,
  parseAirbnbConversationEmail,
  parseSixty60LineItems,
  parseSixty60Message,
  propertyForListing,
  projectInventory,
  setupGuestCount,
  stockObservationSkus,
  supportDisposition,
  supportEscalationStages,
  supportMessageMatchesTopic,
  supportMessageRequiresHuman,
  supportTimeFollowUpDecision,
  supportTimeRequestIsFocused,
  supportTimeRequestDecision,
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

test("shopping list waits for a three-day runout and uses only durable buffer staples", () => {
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
        sku: "milk_250ml",
        displayName: "Milk",
        requiredQuantity: 20,
        targetUnitPriceCents: 100,
        urgent: false,
        countStatus: "confirmed",
        staplePriority: 1,
      },
      {
        sku: "coffee_portion",
        displayName: "Coffee",
        requiredQuantity: 20,
        targetUnitPriceCents: 1_000,
        urgent: false,
        countStatus: "confirmed",
        staplePriority: 20,
      },
    ],
  });

  assert.deepEqual(list.items.map((item) => item.sku), ["guest_chocolate", "coffee_portion"]);
  assert.equal(list.items.some((item) => item.sku === "milk_250ml"), false);
  assert.equal(list.estimatedTotalCents, 40_000);

  const futureOnly = buildShoppingList({
    projections: [{
      sku: "guest_chocolate",
      displayName: "Chocolates",
      requiredQuantity: 5,
      targetUnitPriceCents: 1_000,
      urgent: false,
      countStatus: "confirmed",
    }],
  });
  assert.deepEqual(futureOnly.items, []);
});

test("unknown shopping-list prices never claim the free-delivery minimum", () => {
  const list = buildShoppingList({
    projections: [{
      sku: "guest_chocolate",
      displayName: "Chocolates",
      requiredQuantity: 6,
      targetUnitPriceCents: null,
      urgent: true,
      countStatus: "confirm",
    }],
  });
  assert.equal(list.priceEstimateComplete, false);
  assert.equal(list.meetsFreeDeliveryMinimum, false);
  assert.equal(list.minimumCents, 35_000);
  assert.equal(list.targetCents, 40_000);
});

test("WhatsApp stock observations require shortage wording and return only matching SKUs", () => {
  assert.deepEqual(
    stockObservationSkus("We are almost out of towels and need more guest soap"),
    ["hand_soap", "towel_set"],
  );
  assert.deepEqual(stockObservationSkus("I cleaned the mugs and glasses"), []);
  assert.deepEqual(stockObservationSkus("Please buy dish soap"), ["dishwashing_liquid"]);
});

test("Sixty60 confirmations are provisional and only a 1 Bowie invoice credits stock", () => {
  assert.deepEqual(decideOrderEvidence({ kind: "confirmation" }), {
    addressStatus: "unknown",
    alertManagement: true,
    creditInventory: false,
    ignore: false,
  });
  for (const address of [
    "1 Bowie Street",
    "1 Bowie St",
    "1 Bowie Street, Nahoon",
    "1 Bowie St., Nahoon",
    "1 Bowie Street Nahoon East London 5241 South Africa",
    "1 Bowie St, Nahoon Beach, KuGompo City, 5210, South Africa",
  ]) {
    assert.equal(decideOrderEvidence({ kind: "invoice", deliveryAddress: address }).creditInventory, true);
  }
  for (const address of [
    "1 Bowie",
    "1 Bowie Road",
    "11 Bowie Street",
    "1 Bowie Street Extension",
    "1 Bowie Street, Cape Town",
  ]) {
    const decision = decideOrderEvidence({ kind: "invoice", deliveryAddress: address });
    assert.equal(decision.creditInventory, false);
    assert.equal(decision.ignore, true);
  }
  assert.equal(decideOrderEvidence({ kind: "invoice", deliveryAddress: "18 Other Road" }).ignore, true);
});

test("support auto-reply gate is whitelist and verified-facts only", () => {
  assert.equal(supportDisposition({
    topic: "wifi",
    riskTier: "low",
    messageWhitelisted: true,
    factsVerified: true,
    confidence: 0.97,
    replyNeeded: true,
    draft: "The verified Wi-Fi details are available.",
  }).autoReply, true);
  assert.equal(supportDisposition({
    topic: "refund",
    riskTier: "low",
    factsVerified: true,
    confidence: 0.99,
    replyNeeded: true,
    draft: "A refund has been approved.",
  }).autoReply, false);
  assert.equal(supportDisposition({
    topic: "wifi",
    riskTier: "low",
    factsVerified: false,
    confidence: 0.99,
    replyNeeded: true,
    draft: "Use an unverified password.",
  }).autoReply, false);
  assert.equal(supportDisposition({
    topic: "thanks",
    riskTier: "low",
    factsVerified: true,
    confidence: 0.99,
    replyNeeded: false,
    draft: null,
  }).autoReply, false);
});

test("automated footer is subtle, exact, and idempotent", () => {
  const message = withAutomatedReplyFooter("The Wi-Fi details are in your check-in message.");
  assert.ok(message.endsWith(AUTOMATED_REPLY_FOOTER));
  assert.equal(withAutomatedReplyFooter(message), message);
});

test("support auto-reply templates use verified facts rather than model prose", async () => {
  const { verifiedSupportDraft } = await import("./support.mjs");
  assert.equal(verifiedSupportDraft("greeting", {}), "Hello! Thank you for your message. We look forward to hosting you.");
  assert.equal(
    verifiedSupportDraft("address", { address: "1 Verified Street" }),
    "The address is 1 Verified Street.",
  );
  assert.equal(verifiedSupportDraft("wifi", {}), null);
  assert.equal(supportMessageRequiresHuman("Hello, can I get a refund and change my dates?"), true);
  assert.equal(supportMessageRequiresHuman("Hello, we are looking forward to the stay."), false);
});

test("support message whitelist accepts only the matching low-risk template intent", () => {
  assert.equal(supportMessageMatchesTopic("Please resend the Wi-Fi network name and password.", "wifi"), true);
  assert.equal(supportMessageMatchesTopic("Could you please send directions from the airport?", "directions"), true);
  assert.equal(supportMessageMatchesTopic("What time may I check in?", "check_in_time"), true);
  assert.equal(supportMessageMatchesTopic("Thanks, I won't be coming after all", "thanks"), false);
  assert.equal(supportMessageMatchesTopic("Please modify my reservation", "greeting"), false);
  assert.equal(supportMessageMatchesTopic("There is no hot water", "thanks"), false);
  assert.equal(
    supportMessageMatchesTopic("Could you send directions from the airport and help with something?", "directions"),
    false,
  );
});

test("reservation changes, cancellations, and maintenance always require a human", () => {
  for (const message of [
    "Thanks, I won't be coming after all",
    "Please modify my reservation",
    "I need to shorten my stay",
    "There is no hot water",
  ]) {
    assert.equal(supportMessageRequiresHuman(message), true, message);
  }
});

test("early check-in policy accepts only the two-hour window and keeps the promise conditional", () => {
  const accepted = supportTimeRequestDecision("Could we check in early at 1pm?", {
    checkInTime: "15:00",
    checkOutTime: "10:00",
  });
  assert.equal(accepted.action, "accept_conditional");
  assert.equal(accepted.effectiveTime, "13:00");
  assert.equal(accepted.createsOperationalRequest, true);
  assert.match(accepted.reply, /cannot be guaranteed/i);

  const tooEarly = supportTimeRequestDecision("Can we check in early at 12:00?", {});
  assert.equal(tooEarly.action, "offer_earliest");
  assert.equal(tooEarly.effectiveTime, "13:00");
  assert.equal(tooEarly.createsOperationalRequest, false);
  assert.equal(
    supportTimeRequestDecision("Check-in is 3pm, could we arrive at 2pm?", {}).effectiveTime,
    "14:00",
  );
  assert.equal(
    supportTimeRequestDecision("Could we check in earlier than 3pm, ideally 2pm?", {}).effectiveTime,
    "14:00",
  );
  assert.equal(
    supportTimeRequestDecision("Could we check in at 2pm instead of 3pm?", {}).effectiveTime,
    "14:00",
  );
});

test("late checkout policy allows 11:00, not later, and creates a cleaner note only when accepted", () => {
  const accepted = supportTimeRequestDecision("Could we have a late checkout at 11am?", {});
  assert.equal(accepted.action, "accept");
  assert.equal(accepted.effectiveTime, "11:00");
  assert.equal(accepted.createsOperationalRequest, true);

  const declined = supportTimeRequestDecision("May we check out late at 12pm?", {});
  assert.equal(declined.action, "decline");
  assert.equal(declined.createsOperationalRequest, false);
  assert.match(declined.reply, /can['’]t offer check-out later than 11:00/i);
  assert.equal(supportTimeRequestDecision("Could we have a late checkout at 1?", {}).requestedTime, "13:00");
  assert.equal(
    supportTimeRequestDecision("Checkout is 10am, could we leave at 11am?", {}).effectiveTime,
    "11:00",
  );
  assert.equal(
    supportTimeRequestDecision("Can we check out after 10am, say 11am?", {}).effectiveTime,
    "11:00",
  );
  assert.equal(
    supportTimeRequestDecision("Can we check out at 11am rather than 10am?", {}).effectiveTime,
    "11:00",
  );
});

test("timing autonomy rejects mixed requests", () => {
  assert.equal(supportTimeRequestIsFocused("Could we check in early at 2pm?"), true);
  assert.equal(supportTimeRequestIsFocused("The room is dirty. Could we check in early at 2pm?"), false);
  assert.equal(supportTimeRequestIsFocused("Could we check in early at 2pm and get a refund?"), false);
  assert.equal(supportTimeRequestIsFocused("Can we check in early at 2pm, the sheets have stains?"), false);
  assert.equal(supportTimeRequestIsFocused("Can we check in early at 2pm, what is the Wi-Fi password?"), false);
});

test("early check-in follow-ups never offer entry before 13:00 and use the approved no-response wording", () => {
  const activeRequest = {
    requestType: "early_checkin",
    stayDate: "2026-08-24",
    effectiveTime: "13:00",
    status: "awaiting_ready",
  };
  const before = supportTimeFollowUpDecision(
    "Is the studio ready?",
    activeRequest,
    new Date("2026-08-24T12:45:00+02:00"),
  );
  assert.equal(before.action, "still_waiting");
  assert.match(before.reply, /wait for an update/i);

  const atTime = supportTimeFollowUpDecision(
    "Can we check in now?",
    activeRequest,
    new Date("2026-08-24T13:00:00+02:00"),
  );
  assert.equal(atTime.action, "no_cleaner_response");
  assert.match(atTime.reply, /did get an early notification/i);
  assert.equal(supportTimeFollowUpDecision(
    "Can we check in now?",
    activeRequest,
    new Date("2026-08-25T13:00:00+02:00"),
  ), null);
});

test("support escalation stages are immediate, reminded at 45 minutes, and overdue at 60", () => {
  const latestEventAt = "2026-08-21T12:00:00Z";
  assert.deepEqual(
    supportEscalationStages({ latestEventAt, now: new Date("2026-08-21T12:44:59Z") }).map((item) => item.stage),
    ["immediate"],
  );
  assert.deepEqual(
    supportEscalationStages({ latestEventAt, now: new Date("2026-08-21T12:45:00Z") }).map((item) => item.stage),
    ["immediate", "reminder"],
  );
  assert.deepEqual(
    supportEscalationStages({ latestEventAt, now: new Date("2026-08-21T13:00:00Z") }).map((item) => item.stage),
    ["immediate", "reminder", "overdue"],
  );
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

test("Sixty60 confirmation stays provisional while its 1 Bowie invoice is creditable", () => {
  const confirmation = parseSixty60Message({
    providerMessageId: "order-1",
    from: "no-reply@checkers.sixty60.co.za",
    subject: "We've received your order. We're on it!",
    body: "Order No.: 218300001 Date placed: 18 Aug, 2026 2:36 PM ETA 3:36PM Delivery 1 (of 1) Guest Water 6 x 500ml Qty 1 R 44.99 Product sub-total R 44.99 Total R 44.99",
  });
  assert.equal(confirmation.kind, "confirmation");
  assert.equal(confirmation.deliveryAddress, null);
  assert.equal(confirmation.eta, "3:36PM");

  const invoice = parseSixty60Message({
    providerMessageId: "invoice-1",
    from: "no-reply@checkers.sixty60.co.za",
    subject: "Sixty60 invoice for order 218300001",
    body: "Order No.: 218300001 Delivery address: 1 Bowie St, Nahoon Beach, KuGompo City, 5210, South Africa 60 MIN Delivered on 18 August 2026, 14:59 Product Detail Price (per item) Total Guest Water 6 x 500ml Qty 1 R 44.99 R 44.99 Domestos Multipurpose Thick Bleach 750ml Qty 2 R 36.99 R 73.98 Product sub-total R 118.97 Total R 118.97",
  });
  assert.equal(invoice.kind, "invoice");
  assert.match(invoice.deliveryAddress, /^1 Bowie St/);
  assert.equal(decideOrderEvidence(invoice).creditInventory, true);
  assert.equal(invoice.totalCents, 11897);
  assert.deepEqual(invoice.items.map((item) => [item.inventorySku, item.creditedQuantity]), [
    ["water_500ml", 6],
    ["bleach", 2],
  ]);
});

test("Sixty60 ignores other senders and unrelated household groceries", () => {
  assert.equal(parseSixty60Message({ from: "offers@example.com", subject: "Sixty60 invoice", body: "Order No 123456" }), null);
  assert.equal(classifyInventorySku("Selati Golden Brown Sugar 2kg"), null);
  assert.equal(classifyInventorySku("Individually wrapped buttermilk rusks 20 Pack"), "wrapped_rusk");
  assert.equal(classifyInventorySku("NESCAF Gold Cappuccino Sticks 20 x 18g"), "coffee_portion");
  assert.equal(classifyInventorySku("Bakers Choc-kits Classic Chocolate Oat Biscuits 200g"), null);
  assert.equal(classifyInventorySku("Magnum Death By Chocolate Flavoured Ice Cream 100ml"), null);
  assert.equal(classifyInventorySku("Staffords Magicmelt Choc Chips Box 250g"), null);
  assert.equal(classifyInventorySku("TV Bar Chocolate Slab 80g"), null);
  assert.equal(classifyInventorySku("Kitchen Towel 2 Pack"), null);
  assert.equal(classifyInventorySku("Luxury Bath Towels 4 Pack"), null);
});

test("Sixty60 hand-soap packs credit bottles without inferring ready towel sets", () => {
  const items = parseSixty60LineItems([
    "Product Detail Price (per item) Total",
    "Guest Hand Soap 2 Pack Qty 3 R 39.99 R 119.97",
    "Luxury Bath Towels 4 Pack Qty 1 R 299.99 R 299.99",
    "Product sub-total R 419.96",
  ].join(" "));
  assert.deepEqual(items.map((item) => [
    item.inventorySku,
    item.creditedQuantity,
    item.inventoryQuantityKnown,
  ]), [
    ["hand_soap", 6, true],
    [null, 0, false],
  ]);
});

test("Sixty60 converts only verified guest-chocolate packs into individual portions", () => {
  const items = parseSixty60LineItems([
    "Product Detail Price (per item) Total",
    "KitKat Mini Chocolate Bars 180g Qty 2 R 59.99 R 119.98",
    "KitKat Mini Chocolate Bars 2 x 180g Qty 1 R 119.98 R 119.98",
    "Cadbury Lunch Bar Mini Milk Chocolate Bars 168g Qty 1 R 59.99 R 59.99",
    "Nestle Bar-One Minis Chocolate Bar 189g Qty 1 R 59.99 R 59.99",
    "Nosh Chocolate Bar 56g Qty 1 R 14.99 R 14.99",
    "Nosh Chocolate Bars 4 x 56g Qty 1 R 49.99 R 49.99",
    "Tex Minis Chocolate Bars 9 x 20g Qty 1 R 59.99 R 59.99",
    "NESCAF Gold Cappuccino Sticks 20 x 18g Qty 1 R 144.99 R 144.99",
    "Regal Assorted Chocolate Treats 400g Qty 1 R 79.99 R 79.99",
    "Product sub-total R 394.94",
  ].join(" "));
  assert.deepEqual(items.map((item) => [
    item.creditedQuantity,
    item.inventoryQuantityKnown,
  ]), [
    [18, true],
    [18, true],
    [8, true],
    [9, true],
    [1, true],
    [4, true],
    [9, true],
    [20, true],
    [0, false],
  ]);
});

test("Airbnb conversation parser treats every Host event as human without inferring identity", () => {
  const parsed = parseAirbnbConversationEmail({
    providerMessageId: "mail-1",
    from: "express@airbnb.com",
    subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    occurredAt: "2026-08-21T16:24:00Z",
    body: [
      "RESERVATION FOR JASMINE STUDIO STAY, AUG 22 - 23",
      "For your protection and safety, always communicate through Airbnb.",
      "SAMPLE GUEST",
      "Booker",
      "May I arrive slightly later?",
      "JANE",
      "Host",
      "Yes, that should be fine.",
      "Reply",
      "https://www.airbnb.co.za/hosting/thread/2635168007?thread_type=home_booking",
    ].join("\n"),
  });
  assert.equal(parsed.providerThreadId, "2635168007");
  assert.deepEqual(parsed.entries.map((entry) => entry.direction), ["guest", "host"]);
  assert.equal(parsed.entries[1].name, "JANE");
  assert.equal(parsed.listingName, "JASMINE STUDIO STAY");
});

test("Airbnb conversation parser accepts trusted automated copies for supplemental host evidence", () => {
  const parsed = parseAirbnbConversationEmail({
    providerMessageId: "mail-automated-1",
    from: "automated@airbnb.com",
    subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    occurredAt: "2026-08-21T16:25:00Z",
    body: [
      "RESERVATION FOR JASMINE STUDIO STAY, AUG 22 - 23",
      "GUEST FIXTURE",
      "Guest",
      "Hello",
      "JANE",
      "Host",
      "Welcome",
      "https://www.airbnb.co.za/hosting/thread/2635168007?thread_type=home_booking",
    ].join("\n"),
  });
  assert.deepEqual(parsed.entries.map((entry) => entry.direction), ["guest", "host"]);
});

test("identical repeated guest messages retain distinct stable conversation keys", () => {
  const shared = { direction: "guest", contentHash: "same-content" };
  const first = conversationEntryKey("thread-1", { ...shared, sequence: 0 });
  const second = conversationEntryKey("thread-1", { ...shared, sequence: 1 });
  assert.notEqual(first, second);
  assert.equal(first, conversationEntryKey("thread-1", { ...shared, sequence: 0 }));
});

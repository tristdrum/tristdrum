import assert from "node:assert/strict";
import test from "node:test";
import {
  appendOnlyReconciliation,
  learnedUnitPrices,
  loadSuppressedStockAlerts,
  markStockAlertNotified,
  requiredStateMovement,
  reservationConsumptionRequirements,
  storeStockCountReview,
} from "./repository.mjs";

test("Bowie invoice prices become per-stock-unit estimates", () => {
  const prices = learnedUnitPrices([
    { inventorySku: "water_500ml", creditedQuantity: 6, lineTotalCents: 4499 },
    { inventorySku: "water_500ml", creditedQuantity: 6, lineTotalCents: 4799 },
    { inventorySku: null, creditedQuantity: 1, lineTotalCents: 2000 },
  ]);
  assert.equal(prices.get("water_500ml"), 775);
  assert.equal(prices.has(null), false);
});

test("pack prices use provider unit price rather than an ambiguous line total", () => {
  const prices = learnedUnitPrices([
    {
      inventorySku: "guest_chocolate",
      quantity: 2,
      creditedQuantity: 18,
      unitPriceCents: 5999,
      lineTotalCents: 5999,
    },
  ]);
  assert.equal(prices.get("guest_chocolate"), 667);
});

test("reservation consumption counts adults and children, excludes infants, and keeps per-stay items singular", () => {
  const requirements = reservationConsumptionRequirements(
    { adults: 1, children: 1, infants: 2, guestCountKnown: true },
    [
      { sku: "guest_chocolate", consumptionBasis: "per_guest", quantityPerBasis: 1 },
      { sku: "sugar_portion", consumptionBasis: "per_guest", quantityPerBasis: 2 },
      { sku: "milk_250ml", consumptionBasis: "per_stay", quantityPerBasis: 1 },
    ],
  );
  assert.deepEqual(requirements.map(({ sku, quantity }) => [sku, quantity]), [
    ["guest_chocolate", 2],
    ["sugar_portion", 4],
    ["milk_250ml", 1],
  ]);
});

test("reservation stock transitions stay idempotent across cancellation and re-confirmation", () => {
  assert.equal(requiredStateMovement({ targetQuantity: -2, priorNetQuantity: 0 }), -2);
  assert.equal(requiredStateMovement({
    targetQuantity: -2,
    priorNetQuantity: 0,
    currentStateQuantity: -2,
  }), null);
  assert.equal(requiredStateMovement({ targetQuantity: 0, priorNetQuantity: -2 }), 2);
  assert.equal(requiredStateMovement({ targetQuantity: -2, priorNetQuantity: 0 }), -2);
});

test("invoice reconciliation remains exact when normalized quantities cycle", () => {
  const movements = [{ dedupeKey: "legacy", quantityDelta: 1 }];
  for (const targetQuantity of [0, 1, 2, 1]) {
    const reconciliation = appendOnlyReconciliation({ targetQuantity, movements });
    assert.ok(reconciliation);
    movements.push({
      dedupeKey: `basis:${reconciliation.basisFingerprint}:target:${targetQuantity}`,
      quantityDelta: reconciliation.transitionQuantity,
    });
    assert.equal(
      movements.reduce((total, movement) => total + movement.quantityDelta, 0),
      targetQuantity,
    );
  }
  assert.equal(appendOnlyReconciliation({ targetQuantity: 1, movements }), null);
});

test("stock alert loading is restricted to current actionable stock and order alerts", async () => {
  let query = "";
  const sql = async (strings) => {
    query = strings.join("?");
    return [];
  };
  await loadSuppressedStockAlerts(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    limit: 12,
    now: new Date("2026-08-23T20:00:00.000Z"),
  });
  assert.match(query, /alert\.status = 'suppressed'/);
  assert.match(query, /alert\.alert_type in \('stock_low', 'stock_count_review', 'order_update'\)/);
  assert.match(query, /current_list\.status = 'draft'/);
  assert.match(query, /current_order\.status = 'confirmation_received'/);
  assert.match(query, /interval '24 hours'/);
});

test("weekly reviews preserve every count that still needs confirmation", async () => {
  let captured = null;
  const sql = async (strings, ...values) => {
    captured = { query: strings.join("?"), values };
    return [{ id: "review-alert", status: "suppressed" }];
  };
  sql.json = (value) => value;
  const result = await storeStockCountReview(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    runDate: "2026-08-25",
    projections: [
      { sku: "bath_mat", displayName: "Bath mats", category: "linen", stockUnit: "each", countToConfirm: true },
      { sku: "mug", displayName: "Mugs", category: "tableware", stockUnit: "each", countToConfirm: true },
      { sku: "coffee_portion", displayName: "Coffee portions", category: "guest_supply", stockUnit: "portion", countToConfirm: false },
    ],
  });
  assert.deepEqual(result, { id: "review-alert", status: "suppressed" });
  assert.match(captured.query, /'stock_count_review'/);
  const details = captured.values.find((value) => Array.isArray(value?.countsToConfirm));
  assert.deepEqual(details.countsToConfirm.map((item) => item.sku), ["bath_mat", "mug"]);
});

test("notified stock alerts and their worker audit are committed together", async () => {
  const queries = [];
  const transaction = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("update airbnb.alerts")) {
      return [{ id: "alert-1", alertType: "stock_low", dedupeKey: "stock:fixture" }];
    }
    return [];
  };
  transaction.json = (value) => value;
  const sql = {
    begin: async (callback) => callback(transaction),
  };
  const result = await markStockAlertNotified(sql, {
    householdId: "22222222-2222-4222-8222-222222222222",
    alertId: "alert-1",
    idempotencyKey: "airbnb-stock-alert:fixture",
    now: new Date("2026-08-23T20:00:00.000Z"),
  });
  assert.deepEqual(result, { id: "alert-1", status: "notified" });
  assert.equal(queries.length, 2);
  assert.match(queries[1].query, /insert into airbnb\.audit_events/);
  assert.match(queries[1].query, /'worker', 'stock', 'stock_alert_notified'/);
  assert.deepEqual(
    queries[1].values.find((value) => value?.verifiedReadback === true),
    {
      alertType: "stock_low",
      alertDedupeKey: "stock:fixture",
      idempotencyKey: "airbnb-stock-alert:fixture",
      verifiedReadback: true,
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  learnedUnitPrices,
  requiredStateMovement,
  reservationConsumptionRequirements,
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

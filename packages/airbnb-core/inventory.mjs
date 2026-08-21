const DAY_MS = 86_400_000;

export const INVENTORY_POLICY = Object.freeze({
  forecastDays: 7,
  bufferPercent: 25,
  triggerHorizonDays: 3,
  freeDeliveryMinimumCents: 35_000,
  targetOrderCents: 40_000,
});

export const DEFAULT_INVENTORY_RULES = Object.freeze([
  Object.freeze({ sku: "guest_chocolate", basis: "per_guest", quantity: 1 }),
  Object.freeze({ sku: "water_500ml", basis: "per_guest", quantity: 1 }),
  Object.freeze({ sku: "milk_250ml", basis: "per_stay", quantity: 1 }),
  Object.freeze({ sku: "wrapped_rusk", basis: "per_guest", quantity: 1 }),
  Object.freeze({ sku: "coffee_portion", basis: "per_guest", quantity: 1 }),
  Object.freeze({ sku: "sugar_portion", basis: "per_guest", quantity: 2 }),
]);

function dateKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOffset(startDate, targetDate) {
  return Math.round(
    (Date.parse(`${targetDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / DAY_MS,
  );
}

export function setupGuestCount(reservation, { unknownGuestDefault = 2 } = {}) {
  if (reservation.guestCountKnown === false) return unknownGuestDefault;
  const adults = Math.max(0, Number(reservation.adults ?? 0));
  const children = Math.max(0, Number(reservation.children ?? 0));
  const knownTotal = adults + children;
  return knownTotal > 0 ? knownTotal : unknownGuestDefault;
}

export function forecastInventoryDemand({
  reservations,
  startDate,
  days = INVENTORY_POLICY.forecastDays,
  bufferPercent = INVENTORY_POLICY.bufferPercent,
  rules = DEFAULT_INVENTORY_RULES,
  unknownGuestDefault = 2,
}) {
  const start = dateKey(startDate);
  const end = addDays(start, days - 1);
  const arrivals = reservations
    .filter((reservation) => reservation.status === "confirmed")
    .filter((reservation) => {
      const checkIn = dateKey(reservation.checkIn);
      return checkIn >= start && checkIn <= end;
    })
    .map((reservation) => ({
      ...reservation,
      checkIn: dateKey(reservation.checkIn),
      setupGuests: setupGuestCount(reservation, { unknownGuestDefault }),
    }))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const demandBySku = new Map(rules.map((rule) => [rule.sku, {
    sku: rule.sku,
    basis: rule.basis,
    quantityPerBasis: rule.quantity,
    rawDemand: 0,
    bufferedDemand: 0,
    dailyDemand: [],
  }]));

  for (const reservation of arrivals) {
    for (const rule of rules) {
      const basisCount = rule.basis === "per_stay" ? 1 : reservation.setupGuests;
      const quantity = basisCount * rule.quantity;
      const demand = demandBySku.get(rule.sku);
      demand.rawDemand += quantity;
      demand.dailyDemand.push({
        date: reservation.checkIn,
        daysFromStart: dayOffset(start, reservation.checkIn),
        quantity,
        reservationId: reservation.id ?? null,
      });
    }
  }

  for (const demand of demandBySku.values()) {
    demand.bufferedDemand = Math.ceil(demand.rawDemand * (1 + bufferPercent / 100));
  }

  return {
    startDate: start,
    endDate: end,
    days,
    bufferPercent,
    arrivals: arrivals.map(({ id, checkIn, setupGuests }) => ({ id: id ?? null, checkIn, setupGuests })),
    demand: [...demandBySku.values()],
  };
}

function firstRunoutDay(onHand, dailyDemand) {
  let remaining = Number(onHand ?? 0);
  for (const event of dailyDemand) {
    remaining -= event.quantity;
    if (remaining < 0) return event.daysFromStart;
  }
  return null;
}

export function projectInventory({ inventoryItems, forecast, triggerHorizonDays = INVENTORY_POLICY.triggerHorizonDays }) {
  const demandBySku = new Map(forecast.demand.map((demand) => [demand.sku, demand]));
  return inventoryItems.map((item) => {
    const demand = demandBySku.get(item.sku) ?? {
      rawDemand: 0,
      bufferedDemand: 0,
      dailyDemand: [],
    };
    const onHand = Number(item.quantityOnHand ?? 0);
    const runoutDay = firstRunoutDay(onHand, demand.dailyDemand);
    const requiredQuantity = Math.max(0, Math.ceil(demand.bufferedDemand - onHand));
    return {
      ...item,
      quantityOnHand: onHand,
      rawDemand: demand.rawDemand,
      bufferedDemand: demand.bufferedDemand,
      projectedBalance: onHand - demand.bufferedDemand,
      requiredQuantity,
      runoutDay,
      urgent: runoutDay !== null && runoutDay <= triggerHorizonDays,
      countToConfirm: item.countStatus !== "confirmed",
    };
  });
}

export function buildShoppingList({
  projections,
  includeAllProjectedShortages = true,
  minimumCents = INVENTORY_POLICY.freeDeliveryMinimumCents,
  targetCents = INVENTORY_POLICY.targetOrderCents,
}) {
  const selected = projections
    .filter((item) => item.requiredQuantity > 0 && (includeAllProjectedShortages || item.urgent))
    .map((item) => ({
      sku: item.sku,
      displayName: item.displayName,
      quantity: item.requiredQuantity,
      estimatedUnitPriceCents: item.targetUnitPriceCents ?? null,
      reason: item.urgent ? "Projected to run out within three days" : "Seven-day demand plus buffer",
      countToConfirm: item.countToConfirm,
      staplePriority: item.staplePriority ?? 100,
    }));

  const selectedSkus = new Set(selected.map((item) => item.sku));
  const estimatedTotal = () => selected.reduce(
    (total, item) => total + (item.estimatedUnitPriceCents ?? 0) * item.quantity,
    0,
  );

  if (selected.length && estimatedTotal() < minimumCents) {
    const staples = projections
      .filter((item) => !selectedSkus.has(item.sku) && Number(item.targetUnitPriceCents ?? 0) > 0)
      .sort((a, b) => (a.staplePriority ?? 100) - (b.staplePriority ?? 100));
    for (const staple of staples) {
      if (estimatedTotal() >= targetCents) break;
      const price = Number(staple.targetUnitPriceCents);
      const quantity = Math.max(1, Math.ceil((targetCents - estimatedTotal()) / price));
      selected.push({
        sku: staple.sku,
        displayName: staple.displayName,
        quantity,
        estimatedUnitPriceCents: price,
        reason: "Useful nonperishable buffer to reach the delivery minimum",
        countToConfirm: staple.countStatus !== "confirmed",
        staplePriority: staple.staplePriority ?? 100,
      });
      selectedSkus.add(staple.sku);
    }
  }

  const totalCents = estimatedTotal();
  return {
    items: selected,
    estimatedTotalCents: totalCents,
    meetsFreeDeliveryMinimum: totalCents >= minimumCents,
    countsToConfirm: selected.filter((item) => item.countToConfirm).map((item) => item.sku),
    orderPlacementAllowed: false,
  };
}

function normalizedAddress(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function decideOrderEvidence({ kind, deliveryAddress }) {
  if (kind === "confirmation" && !deliveryAddress) {
    return { addressStatus: "unknown", alertManagement: true, creditInventory: false, ignore: false };
  }
  const address = normalizedAddress(deliveryAddress);
  const isBowie = /(?:^| )1 bowie(?: street| st)?(?: |$)/.test(address);
  if (kind === "invoice" && isBowie) {
    return { addressStatus: "bowie_1", alertManagement: false, creditInventory: true, ignore: false };
  }
  if (kind === "invoice" && address) {
    return { addressStatus: "other", alertManagement: false, creditInventory: false, ignore: true };
  }
  return { addressStatus: "unknown", alertManagement: false, creditInventory: false, ignore: false };
}

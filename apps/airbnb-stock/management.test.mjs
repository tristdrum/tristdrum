import assert from "node:assert/strict";
import test from "node:test";
import {
  notifyStockManagement,
  renderStockManagementAlert,
} from "./management.mjs";

function stockAlert() {
  return {
    id: "alert-stock",
    alertType: "stock_low",
    dedupeKey: "stock:2026-08-24:fixture",
    summary: "2 Airbnb stock items need attention",
    details: { countsToConfirm: ["coffee"] },
    shoppingList: { estimatedTotalCents: 40020 },
    items: [
      { displayName: "Guest chocolates", quantity: "6.000", countToConfirm: false },
      { displayName: "Coffee sachets", quantity: "2.500", countToConfirm: true },
    ],
  };
}

test("shopping-list alerts use stored quantities and flag counts to confirm", () => {
  const text = renderStockManagementAlert(stockAlert());
  assert.match(text, /^\*Airbnb stock shopping list\*/);
  assert.match(text, /- 6 x Guest chocolates/);
  assert.match(text, /- 2\.5 x Coffee sachets/);
  assert.match(text, /Estimated total: R400\.20/);
  assert.match(text, /Count to confirm: Coffee sachets/);
  assert.match(text, /Review: https:\/\/www\.tristdrum\.com\/dashboard\/airbnb$/);
});

test("shopping-list alerts never guess a missing item quantity", () => {
  const alert = stockAlert();
  alert.items = [{ displayName: "Sugar portions", quantity: null, countToConfirm: true }];
  const text = renderStockManagementAlert(alert);
  assert.doesNotMatch(text, /x Sugar portions/);
  assert.match(text, /Shopping list is ready in the dashboard\./);
  assert.match(text, /Count to confirm: Sugar portions/);
});

test("a blank dashboard override retains the canonical review link", () => {
  const text = renderStockManagementAlert(stockAlert(), "  ");
  assert.match(text, /Review: https:\/\/www\.tristdrum\.com\/dashboard\/airbnb$/);
});

test("order confirmation and delivery alerts are concise", () => {
  const confirmation = renderStockManagementAlert({
    alertType: "order_update",
    dedupeKey: "sixty60:confirmation:123",
    summary: "Sixty60 order 123 was placed",
    details: { deliveryDueAt: "2026-08-24T16:30:00+02:00" },
  });
  assert.match(confirmation, /^\*Airbnb stock order placed\*/);
  assert.match(confirmation, /Delivery due:/);

  const delivery = renderStockManagementAlert({
    alertType: "order_update",
    dedupeKey: "sixty60:invoice:123",
    summary: "Sixty60 order 123 was delivered to 1 Bowie",
    details: {},
  });
  assert.match(delivery, /^\*Airbnb stock delivery confirmed\*/);
  assert.doesNotMatch(delivery, /Delivery due:/);
});

test("weekly stock counts include cleaning, linen, and tableware confirmations", () => {
  const text = renderStockManagementAlert({
    alertType: "stock_count_review",
    dedupeKey: "stock-count-review:2026-08-25",
    details: {
      countsToConfirm: [
        { displayName: "Bleach", stockUnit: "bottle" },
        { displayName: "Ready linen sets", stockUnit: "set" },
        { displayName: "Mugs", stockUnit: "each" },
      ],
    },
  });
  assert.match(text, /^\*Airbnb weekly stock count\*/);
  assert.match(text, /- Bleach \(bottle\)/);
  assert.match(text, /- Ready linen sets \(set\)/);
  assert.match(text, /- Mugs \(each\)/);
});

test("verified sends are marked and audited through the repository transition", async () => {
  const calls = [];
  let loadedLimit;
  const result = await notifyStockManagement({
    sql: {},
    householdId: "22222222-2222-4222-8222-222222222222",
    env: { AIRBNB_STOCK_ALERT_LIMIT: "24" },
    loadAlerts: async (_sql, options) => {
      loadedLimit = options.limit;
      return [stockAlert()];
    },
    sendMessage: async (message) => {
      calls.push(["send", message]);
      return { verification: { found: true } };
    },
    markNotified: async (_sql, value) => {
      calls.push(["mark", value]);
      return { id: value.alertId, status: "notified" };
    },
    now: () => new Date("2026-08-23T20:00:00.000Z"),
  });
  assert.equal(loadedLimit, 1);
  assert.deepEqual(calls.map(([name]) => name), ["send", "mark"]);
  assert.match(calls[0][1].idempotencyKey, /^airbnb-stock-alert:[a-f0-9]{64}$/);
  assert.equal(calls[1][1].idempotencyKey, calls[0][1].idempotencyKey);
  assert.deepEqual(result, [{
    alertId: "alert-stock",
    alertType: "stock_low",
    verified: true,
    markedNotified: true,
  }]);
});

test("an unverified sender result never marks an alert notified", async () => {
  let marked = false;
  await assert.rejects(
    notifyStockManagement({
      sql: {},
      householdId: "22222222-2222-4222-8222-222222222222",
      env: {},
      loadAlerts: async () => [stockAlert()],
      sendMessage: async () => ({ verification: { found: false } }),
      markNotified: async () => {
        marked = true;
      },
    }),
    (error) => error.code === "MANAGEMENT_READBACK_UNVERIFIED",
  );
  assert.equal(marked, false);
});

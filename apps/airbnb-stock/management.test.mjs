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
    shoppingList: {
      estimatedTotalCents: 40020,
      priceEstimateComplete: true,
      meetsFreeDeliveryMinimum: true,
    },
    items: [
      { displayName: "Guest chocolates", quantity: "6.000", countToConfirm: false },
      { displayName: "Coffee sachets", quantity: "2.500", countToConfirm: true },
    ],
  };
}

test("shopping-list alerts summarize the stored list and flag counts to confirm", () => {
  const text = renderStockManagementAlert(stockAlert());
  assert.match(text, /^The Airbnb shopping list has 2 items to review in the dashboard\./);
  assert.match(text, /historical estimate is R400\.20; confirm current prices/);
  assert.match(text, /current Sixty60 basket is at least R350/);
  assert.match(text, /aim for about R400/);
  assert.match(text, /Some stock counts still need confirmation/);
  assert.doesNotMatch(text, /Guest chocolates|Coffee sachets|\n|https?:|\*/);
});

test("shopping-list alerts state the minimum when prices cannot prove it", () => {
  const alert = stockAlert();
  alert.shoppingList = {
    estimatedTotalCents: 12_000,
    priceEstimateComplete: false,
    meetsFreeDeliveryMinimum: false,
  };
  const text = renderStockManagementAlert(alert);
  assert.match(text, /historical estimate is R120\.00 plus unpriced items; confirm current prices/);
  assert.match(text, /at least R350/);
  assert.match(text, /aim for about R400/);
});

test("shopping-list alerts keep the basket reminder even when a historical estimate exceeds R350", () => {
  const text = renderStockManagementAlert(stockAlert());
  assert.match(text, /current Sixty60 basket is at least R350/);
  assert.match(text, /aim for about R400/);
});

test("shopping-list alerts never guess a missing item quantity", () => {
  const alert = stockAlert();
  alert.items = [{ displayName: "Sugar portions", quantity: null, countToConfirm: true }];
  const text = renderStockManagementAlert(alert);
  assert.doesNotMatch(text, /x Sugar portions/);
  assert.match(text, /1 item to review in the dashboard/);
  assert.match(text, /Some stock counts still need confirmation/);
});

test("large shopping lists and weekly reviews remain natural summaries under 1000 characters", () => {
  const items = Array.from({ length: 200 }, (_, index) => ({ displayName: `Bathroom supply ${index} ${"long ".repeat(100)}`,
    quantity: "1.000", stockUnit: "bottle", countToConfirm: true }));
  for (const alert of [{ ...stockAlert(), items }, { alertType: "stock_count_review", details: { countsToConfirm: items } }]) {
    const text = renderStockManagementAlert(alert);
    assert.ok(text.length <= 1000);
    assert.equal(text, text.trim());
    assert.match(text, /200/);
    assert.doesNotMatch(text, /Bathroom supply|\n|https?:|\*/);
  }
});

test("order confirmation and delivery alerts are concise", () => {
  const confirmation = renderStockManagementAlert({
    alertType: "order_update",
    dedupeKey: "sixty60:confirmation:123",
    summary: "Sixty60 order 123 was placed",
    details: { deliveryDueAt: "2026-08-24T16:30:00+02:00" },
  });
  assert.match(confirmation, /^Sixty60 order 123 was placed\./);
  assert.match(confirmation, /Delivery is due/);

  const delivery = renderStockManagementAlert({
    alertType: "order_update",
    dedupeKey: "sixty60:invoice:123",
    summary: "Sixty60 order 123 was delivered to 1 Bowie",
    details: {},
  });
  assert.equal(delivery, "Sixty60 order 123 was delivered to 1 Bowie.");
  assert.doesNotMatch(delivery, /Delivery is due/);
});

test("oversized order summaries use a bounded factual fallback", () => {
  for (const [key, summary] of [["sixty60:confirmation:123", "A Sixty60 stock order was placed."],
    ["sixty60:invoice:123", "A Sixty60 stock delivery was confirmed."]]) {
    const text = renderStockManagementAlert({ alertType: "order_update", dedupeKey: key, summary: "x".repeat(1001), details: {} });
    assert.equal(text, summary);
  }
});

test("weekly stock counts summarize confirmation needs without an item list", () => {
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
  assert.equal(text, "Please confirm 3 Airbnb stock counts in the dashboard.");
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
    sendNotification: async (message) => {
      calls.push(["send", message]);
      return { id: "notification-stock", whatsappStatus: "verified", pingStatus: "accepted" };
    },
    markNotified: async (_sql, value) => {
      calls.push(["mark", value]);
      return { id: value.alertId, status: "notified" };
    },
    now: () => new Date("2026-08-23T20:00:00.000Z"),
  });
  assert.equal(loadedLimit, 1);
  assert.deepEqual(calls.map(([name]) => name), ["send", "mark"]);
  assert.match(calls[0][1].notificationKey, /^airbnb-stock-alert:[a-f0-9]{64}$/);
  assert.equal(calls[1][1].idempotencyKey, calls[0][1].notificationKey);
  assert.equal(calls[0][1].sourceService, "stock");
  assert.deepEqual(result, [{
    alertId: "alert-stock",
    alertType: "stock_low",
    verified: true,
    markedNotified: true,
    pingStatus: "accepted",
    pingError: null,
    notificationId: "notification-stock",
    persistenceError: null,
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
      sendNotification: async () => ({ whatsappStatus: "ambiguous" }),
      markNotified: async () => {
        marked = true;
      },
    }),
    (error) => error.code === "MANAGEMENT_READBACK_UNVERIFIED",
  );
  assert.equal(marked, false);
});

test("Ping failure still marks verified WhatsApp notified and retains the failure for the receipt", async () => {
  let marked = 0;
  const result = await notifyStockManagement({ sql: {}, householdId: "household", env: {},
    loadAlerts: async () => [stockAlert()],
    sendNotification: async ({ text }) => {
      assert.equal(text, renderStockManagementAlert(stockAlert()));
      return { id: "notification", whatsappStatus: "verified", pingStatus: "failed", pingError: "permanent:invalid_api_key" };
    },
    markNotified: async () => { marked += 1; return { id: "alert-stock" }; },
  });
  assert.equal(marked, 1);
  assert.equal(result[0].verified, true);
  assert.equal(result[0].pingStatus, "failed");
  assert.equal(result[0].pingError, "permanent:invalid_api_key");
});

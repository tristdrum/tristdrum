import { contentFingerprint } from "@tristdrum/airbnb-core";
import { sendManagementNotification } from "@tristdrum/airbnb-db";
import {
  loadSuppressedStockAlerts,
  markStockAlertNotified,
} from "./repository.mjs";

function currencyLabel(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `R${(value / 100).toFixed(2)}`;
}

function deliveryLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function renderShoppingList(alert) {
  const items = Array.isArray(alert.items) ? alert.items : [];
  const hasUnresolvedConfirmations = items.some((item) => item.countToConfirm === true)
    || (Array.isArray(alert.details?.countsToConfirm) && alert.details.countsToConfirm.length > 0);
  const total = currencyLabel(alert.shoppingList?.estimatedTotalCents);
  const estimateComplete = alert.shoppingList?.priceEstimateComplete === true;
  return [
    items.length
      ? `The Airbnb shopping list has ${items.length} item${items.length === 1 ? "" : "s"} to review in the dashboard.`
      : "An Airbnb shopping list is ready to review in the dashboard.",
    ...(total ? [`The historical estimate is ${total}${estimateComplete ? "" : " plus unpriced items"}; confirm current prices.`] : []),
    "Check that the current Sixty60 basket is at least R350 for free delivery; aim for about R400.",
    ...(hasUnresolvedConfirmations
      ? ["Some stock counts still need confirmation."]
      : []),
  ].join(" ");
}

function renderOrderUpdate(alert) {
  const delivered = String(alert.dedupeKey ?? "").includes(":invoice:")
    || /delivered/i.test(String(alert.summary ?? ""));
  const due = delivered ? null : deliveryLabel(alert.details?.deliveryDueAt);
  const summary = String(alert.summary ?? "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const fallback = delivered ? "A Sixty60 stock delivery was confirmed." : "A Sixty60 stock order was placed.";
  return [
    summary && summary.length <= 800 ? `${summary}${/[.!?]$/.test(summary) ? "" : "."}` : fallback,
    ...(due ? [`Delivery is due ${due}.`] : []),
  ].join(" ");
}

function renderStockCountReview(alert) {
  const items = Array.isArray(alert.details?.countsToConfirm)
    ? alert.details.countsToConfirm
    : [];
  return items.length
    ? `Please confirm ${items.length} Airbnb stock count${items.length === 1 ? "" : "s"} in the dashboard.`
    : "Please confirm the outstanding Airbnb stock counts in the dashboard.";
}

export function renderStockManagementAlert(alert) {
  if (alert.alertType === "stock_low") return renderShoppingList(alert);
  if (alert.alertType === "stock_count_review") return renderStockCountReview(alert);
  if (alert.alertType === "order_update") return renderOrderUpdate(alert);
  throw new Error(`Unsupported stock alert type ${alert.alertType}.`);
}

export async function notifyStockManagement({
  sql,
  householdId,
  now = () => new Date(),
  env = process.env,
  loadAlerts = loadSuppressedStockAlerts,
  markNotified = markStockAlertNotified,
  sendNotification = sendManagementNotification,
}) {
  const configuredLimit = Number.parseInt(env.AIRBNB_STOCK_ALERT_LIMIT ?? "1", 10);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.min(configuredLimit, 1)
    : 1;
  const checkedAt = now();
  const alerts = await loadAlerts(sql, { householdId, limit, now: checkedAt });
  const results = [];
  for (const alert of alerts) {
    const text = renderStockManagementAlert(alert);
    const idempotencyKey = `airbnb-stock-alert:${contentFingerprint(alert.dedupeKey)}`;
    const delivery = await sendNotification({ sql, householdId, sourceService: "stock", text,
      notificationKey: idempotencyKey, env, now });
    if (delivery.whatsappStatus !== "verified") {
      throw Object.assign(new Error("Stock Management alert readback was not verified."), {
        code: "MANAGEMENT_READBACK_UNVERIFIED",
      });
    }
    const marked = await markNotified(sql, {
      householdId,
      alertId: alert.id,
      idempotencyKey,
      now: checkedAt,
    });
    results.push({
      alertId: alert.id,
      alertType: alert.alertType,
      verified: true,
      markedNotified: marked != null,
      pingStatus: delivery.pingStatus,
      pingError: delivery.pingError ?? null,
      notificationId: delivery.id,
      persistenceError: delivery.persistenceError ?? null,
    });
  }
  return results;
}

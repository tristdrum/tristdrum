import { contentFingerprint, sendVerifiedManagementMessage } from "@tristdrum/airbnb-core";
import {
  loadSuppressedStockAlerts,
  markStockAlertNotified,
} from "./repository.mjs";

const DEFAULT_DASHBOARD_URL = "https://www.tristdrum.com/dashboard/airbnb";

function quantityLabel(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return Number.isInteger(quantity)
    ? String(quantity)
    : String(Number(quantity.toFixed(3)));
}

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

function renderShoppingList(alert, dashboardUrl) {
  const items = Array.isArray(alert.items) ? alert.items : [];
  const itemLines = items.flatMap((item) => {
    const quantity = quantityLabel(item.quantity);
    const name = String(item.displayName ?? "").trim();
    return quantity && name ? [`- ${quantity} x ${name}`] : [];
  });
  const confirmNames = items
    .filter((item) => item.countToConfirm === true)
    .map((item) => String(item.displayName ?? "").trim())
    .filter(Boolean);
  const hasUnresolvedConfirmations = confirmNames.length > 0
    || (Array.isArray(alert.details?.countsToConfirm) && alert.details.countsToConfirm.length > 0);
  const total = currencyLabel(alert.shoppingList?.estimatedTotalCents);
  const estimateComplete = alert.shoppingList?.priceEstimateComplete === true;
  return [
    "*Airbnb stock shopping list*",
    ...(itemLines.length ? itemLines : ["Shopping list is ready in the dashboard."]),
    ...(total ? [`Historical price estimate: ${total}${estimateComplete ? "" : " plus unpriced items"} (informational only).`] : []),
    "Keep the current Sixty60 basket at R350 or more for free delivery; aim for about R400.",
    ...(hasUnresolvedConfirmations
      ? [`Count to confirm: ${confirmNames.length ? confirmNames.join(", ") : "see dashboard"}`]
      : []),
    `Review: ${dashboardUrl}`,
  ].join("\n");
}

function renderOrderUpdate(alert, dashboardUrl) {
  const delivered = String(alert.dedupeKey ?? "").includes(":invoice:")
    || /delivered/i.test(String(alert.summary ?? ""));
  const due = delivered ? null : deliveryLabel(alert.details?.deliveryDueAt);
  return [
    delivered ? "*Airbnb stock delivery confirmed*" : "*Airbnb stock order placed*",
    String(alert.summary ?? "").trim(),
    ...(due ? [`Delivery due: ${due}`] : []),
    `Review: ${dashboardUrl}`,
  ].filter(Boolean).join("\n");
}

function renderStockCountReview(alert, dashboardUrl) {
  const items = Array.isArray(alert.details?.countsToConfirm)
    ? alert.details.countsToConfirm
    : [];
  const lines = items.flatMap((item) => {
    const name = String(item?.displayName ?? "").trim();
    const unit = String(item?.stockUnit ?? "").trim();
    return name ? [`- ${name}${unit ? ` (${unit})` : ""}`] : [];
  });
  return [
    "*Airbnb weekly stock count*",
    ...(lines.length ? lines : ["Please confirm the outstanding stock counts in the dashboard."]),
    `Review: ${dashboardUrl}`,
  ].join("\n");
}

export function renderStockManagementAlert(
  alert,
  dashboardUrl = DEFAULT_DASHBOARD_URL,
) {
  const reviewUrl = String(dashboardUrl ?? "").trim() || DEFAULT_DASHBOARD_URL;
  if (alert.alertType === "stock_low") return renderShoppingList(alert, reviewUrl);
  if (alert.alertType === "stock_count_review") return renderStockCountReview(alert, reviewUrl);
  if (alert.alertType === "order_update") return renderOrderUpdate(alert, reviewUrl);
  throw new Error(`Unsupported stock alert type ${alert.alertType}.`);
}

export async function notifyStockManagement({
  sql,
  householdId,
  now = () => new Date(),
  env = process.env,
  loadAlerts = loadSuppressedStockAlerts,
  markNotified = markStockAlertNotified,
  sendMessage = sendVerifiedManagementMessage,
}) {
  const configuredLimit = Number.parseInt(env.AIRBNB_STOCK_ALERT_LIMIT ?? "1", 10);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.min(configuredLimit, 1)
    : 1;
  const checkedAt = now();
  const alerts = await loadAlerts(sql, { householdId, limit, now: checkedAt });
  const results = [];
  for (const alert of alerts) {
    const text = renderStockManagementAlert(alert, env.AIRBNB_DASHBOARD_URL);
    const idempotencyKey = `airbnb-stock-alert:${contentFingerprint(alert.dedupeKey)}`;
    const delivery = await sendMessage({ text, idempotencyKey, env });
    if (delivery.verification?.found !== true) {
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
    });
  }
  return results;
}

import { contentFingerprint, sendVerifiedManagementMessage } from "@tristdrum/airbnb-core";
import {
  loadSuppressedSupportAlerts,
  markSupportAlertNotified,
} from "./repository.mjs";

const STAGE_RANK = Object.freeze({ immediate: 0, reminder: 1, overdue: 2, delivery_ambiguous: 3 });

export function latestSupportAlerts(alerts) {
  const selected = new Map();
  for (const alert of alerts) {
    const key = alert.details?.threadId ?? alert.dedupeKey;
    const existing = selected.get(key);
    const rank = STAGE_RANK[alert.details?.stage] ?? -1;
    const existingRank = STAGE_RANK[existing?.details?.stage] ?? -1;
    if (!existing || rank > existingRank) selected.set(key, alert);
  }
  return [...selected.values()].sort((left, right) => {
    const stageDifference = (STAGE_RANK[right.details?.stage] ?? -1)
      - (STAGE_RANK[left.details?.stage] ?? -1);
    return stageDifference || Date.parse(left.openedAt) - Date.parse(right.openedAt);
  });
}

export function renderSupportManagementAlert(alert, dashboardUrl = "https://www.tristdrum.com/dashboard/airbnb") {
  const stage = alert.details?.stage ?? "immediate";
  const heading = stage === "delivery_ambiguous"
    ? "Airbnb reply delivery needs confirmation"
    : stage === "overdue"
    ? "Airbnb guest reply overdue"
    : stage === "reminder"
      ? "Airbnb guest reply reminder"
      : alert.details?.requiresManagementAction === true
        ? "Airbnb guest needs host attention"
        : "Airbnb guest message needs review";
  const context = [
    alert.details?.listingName,
    alert.details?.guestName ? `Guest: ${alert.details.guestName}` : null,
    alert.details?.decisionSummary ?? alert.details?.classificationSummary,
  ].filter(Boolean);
  return [
    `*${heading}*`,
    ...context,
    `Review: ${dashboardUrl}`,
  ].join("\n");
}

export async function notifySupportManagement({
  sql,
  householdId,
  now = () => new Date(),
  env = process.env,
  loadAlerts = loadSuppressedSupportAlerts,
  markNotified = markSupportAlertNotified,
  sendMessage = sendVerifiedManagementMessage,
}) {
  const configuredLimit = Number.parseInt(env.AIRBNB_SUPPORT_ALERT_LIMIT ?? "1", 10);
  const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.min(configuredLimit, 1)
    : 1;
  const scanLimit = Math.max(24, limit);
  const alerts = latestSupportAlerts(await loadAlerts(sql, {
    householdId,
    limit: scanLimit,
    notBefore: String(env.AIRBNB_SUPPORT_AUTOMATION_NOT_BEFORE ?? "").trim() || null,
  })).slice(0, limit);
  const results = [];
  for (const alert of alerts) {
    const text = renderSupportManagementAlert(alert, env.AIRBNB_DASHBOARD_URL);
    const idempotencyKey = `airbnb-support-alert:${contentFingerprint(alert.dedupeKey)}`;
    const delivery = await sendMessage({ text, idempotencyKey, env });
    if (delivery.verification?.found !== true) {
      throw Object.assign(new Error("Support Management alert readback was not verified."), {
        code: "MANAGEMENT_READBACK_UNVERIFIED",
      });
    }
    await markNotified(sql, { householdId, alertId: alert.id, now: now() });
    results.push({
      alertId: alert.id,
      stage: alert.details?.stage ?? null,
      verified: true,
    });
  }
  return results;
}

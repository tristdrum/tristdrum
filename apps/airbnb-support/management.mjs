import { contentFingerprint } from "@tristdrum/airbnb-core";
import { sendManagementNotification } from "@tristdrum/airbnb-db";
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

export function renderSupportManagementAlert(alert) {
  const summary = alert.details?.managementSummary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  // Legacy and transport-error records predate model-written Management text.
  const name = String(alert.details?.guestName || "A guest").toLocaleLowerCase("en-ZA")
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-ZA"));
  const dates = alert.details?.stayLabel || alert.stayLabel;
  const issue = alert.details?.stage === "delivery_ambiguous"
      ? "Reply delivery is uncertain; check the conversation before sending again."
      : "A host needs to check the unresolved guest request.";
  return `${name}${dates ? `, staying ${dates}` : ""}: ${issue}`.slice(0, 1000);
}

export async function notifySupportManagement({
  sql,
  householdId,
  now = () => new Date(),
  env = process.env,
  loadAlerts = loadSuppressedSupportAlerts,
  markNotified = markSupportAlertNotified,
  sendNotification = sendManagementNotification,
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
    const text = renderSupportManagementAlert(alert);
    const idempotencyKey = `airbnb-support-alert:${contentFingerprint(alert.dedupeKey)}`;
    const delivery = await sendNotification({ sql, householdId, sourceService: "support", text,
      notificationKey: idempotencyKey, env, now });
    if (delivery.whatsappStatus !== "verified") {
      throw Object.assign(new Error("Support Management alert readback was not verified."), {
        code: "MANAGEMENT_READBACK_UNVERIFIED",
      });
    }
    await markNotified(sql, { householdId, alertId: alert.id, now: now() });
    results.push({
      alertId: alert.id,
      stage: alert.details?.stage ?? null,
      verified: true,
      pingStatus: delivery.pingStatus,
      notificationId: delivery.id,
    });
  }
  return results;
}

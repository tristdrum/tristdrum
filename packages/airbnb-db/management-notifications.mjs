import { createHash } from "node:crypto";
import { sendPing as defaultSendPing, validatePingPayload } from "../airbnb-core/ping.mjs";
import { readWhatsAppChatMessages, sendVerifiedManagementMessage } from "../airbnb-core/whatsapp.mjs";

const SIX_HOURS = 6 * 60 * 60 * 1000;
const CLAIM_LEASE = 60_000;
const SAFE_PING_ERRORS = new Set([
  "missing_api_key", "invalid_api_key", "alert_level_not_allowed", "critical_not_available",
  "installation_unreachable", "invalid_request", "payload_too_large", "apns_submission_failed",
  "rate_limited", "invalid_response", "request_failed", "network_or_timeout", "retry_window_closed",
]);
const PERMANENT_PING_ERRORS = new Set([
  "missing_api_key", "invalid_api_key", "alert_level_not_allowed", "critical_not_available",
  "installation_unreachable", "invalid_request", "payload_too_large",
]);

function instant(now) {
  const value = new Date(typeof now === "function" ? now() : (now ?? Date.now()));
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid notification time.");
  return value.toISOString();
}

function services(sourceService) {
  if (!["support", "stock", "operator"].includes(sourceService)) throw new Error("Invalid notification sourceService.");
  return sourceService === "support" ? ["support", "operator"] : [sourceService];
}

function keyFor(householdId, notificationKey) {
  return `airbnb-management:${createHash("sha256").update(JSON.stringify([householdId, notificationKey])).digest("hex")}`;
}

function receipt(row, persistenceError = null) {
  return {
    id: row.id,
    notificationKey: row.notificationKey,
    sourceService: row.sourceService,
    whatsappStatus: row.whatsappStatus,
    whatsappError: row.whatsappError ?? null,
    verification: {
      found: row.whatsappStatus === "verified",
      providerMessageId: row.whatsappProviderMessageId ?? null,
    },
    pingStatus: row.pingStatus,
    pingAccepted: row.pingStatus === "accepted",
    pingAttemptCount: row.pingAttemptCount,
    pingRequestId: row.pingRequestId ?? null,
    pingError: row.pingError ?? null,
    manualReviewRequired: row.whatsappStatus === "ambiguous" || Boolean(persistenceError),
    persistenceError,
  };
}

async function claimPing({ sql, householdId, sourceService, at, id = null, retry = false, retryBefore = at }) {
  // The counter is the fencing token. A crashed attempt consumes its budget too.
  const [row] = await sql`
    update airbnb.management_notifications
    set ping_status = 'sending', ping_attempt_count = ping_attempt_count + 1,
        ping_first_attempt_at = coalesce(ping_first_attempt_at, ${at}::timestamptz),
        ping_last_attempt_at = ${at}, ping_error = null, updated_at = ${at}
    where id = (
      select id from airbnb.management_notifications
      where household_id = ${householdId} and source_service = any(${services(sourceService)}::text[])
        and (${id}::uuid is null or id = ${id}) and whatsapp_status = 'verified'
        and (
          (ping_status = 'pending' and ping_attempt_count = 0)
          or (${retry} and ping_attempt_count = 1
            and ping_first_attempt_at > ${at}::timestamptz - interval '6 hours'
            and ping_last_attempt_at < ${retryBefore}::timestamptz
            and ((ping_status = 'failed' and ping_error like 'retryable:%')
              or (ping_status = 'sending' and ping_last_attempt_at <= ${at}::timestamptz - interval '1 minute')))
        )
      order by created_at, id limit 1 for update skip locked
    )
    returning *
  `;
  return row;
}

async function deliverClaimedPing({ sql, row, env, sendPing, now }) {
  let result;
  const age = Date.parse(instant(now)) - new Date(row.pingFirstAttemptAt).getTime();
  if (row.pingAttemptCount > 1 && (!Number.isFinite(age) || age < 0 || age >= SIX_HOURS)) {
    result = { accepted: false, retryable: false, error: "retry_window_closed" };
  } else {
    try {
      result = await sendPing({
        title: "Airbnb Management", urgency: "normal", body: row.text,
        dedupeKey: keyFor(row.householdId, row.notificationKey),
      }, { env });
    } catch {
      result = { accepted: false, retryable: true, error: "network_or_timeout" };
    }
  }
  const accepted = result?.accepted === true && result?.status === 202;
  const code = SAFE_PING_ERRORS.has(result?.error) ? result.error : "request_failed";
  const permanentStatus = result?.status >= 400 && result.status < 500 && ![408, 425, 429].includes(result.status);
  const retryable = result?.retryable === true && !PERMANENT_PING_ERRORS.has(code) && !permanentStatus;
  const error = accepted ? null : `${retryable ? "retryable" : "permanent"}:${code}`;
  const requestId = typeof result?.requestId === "string" && /^[0-9a-f-]{36}$/i.test(result.requestId)
    ? result.requestId : null;
  try {
    const at = instant(now);
    const [saved] = await sql`
      update airbnb.management_notifications
      set ping_status = ${accepted ? "accepted" : "failed"}, ping_error = ${error},
          ping_request_id = ${requestId}, ping_accepted_at = ${accepted ? at : null}, updated_at = ${at}
      where id = ${row.id} and household_id = ${row.householdId} and source_service = ${row.sourceService}
        and ping_status <> 'accepted'
        and ((${accepted} and ping_attempt_count >= ${row.pingAttemptCount})
          or (ping_status = 'sending' and ping_attempt_count = ${row.pingAttemptCount}))
      returning *
    `;
    if (saved) return receipt(saved);
    const [current] = await sql`
      select * from airbnb.management_notifications
      where id = ${row.id} and household_id = ${row.householdId} and source_service = ${row.sourceService}
    `;
    return receipt(current ?? row);
  } catch {
    return receipt(row, "ping_result_not_persisted");
  }
}

async function saveWhatsApp({ sql, row, status, providerMessageId, error, at }) {
  const [saved] = await sql`
    update airbnb.management_notifications
    set whatsapp_status = ${status}, whatsapp_provider_message_id = ${providerMessageId},
        whatsapp_verified_at = ${status === "verified" ? at : null}, whatsapp_error = ${error}, updated_at = ${at}
    where id = ${row.id} and household_id = ${row.householdId} and source_service = ${row.sourceService}
      and whatsapp_status in ('sending', 'ambiguous')
    returning *
  `;
  return saved ?? row;
}

async function reconcileWhatsApp({ sql, row, env, at }) {
  const stale = row.whatsappStatus === "sending" && Date.parse(row.updatedAt) <= Date.parse(at) - CLAIM_LEASE;
  if (row.whatsappStatus !== "ambiguous" && !stale) return row;
  let found = false;
  if (row.whatsappProviderMessageId) {
    const chatId = String(env.AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID ?? "").trim();
    if (chatId.endsWith("@g.us") && chatId !== String(env.AIRBNB_WHATSAPP_CHAT_ID ?? "").trim()) {
      try {
        const messages = await readWhatsAppChatMessages({ chatId, env, limit: 100 });
        found = messages.some((message) => message.providerMessageId === row.whatsappProviderMessageId
          && message.chatId === chatId && message.fromMe && message.text === row.text);
      } catch { /* Unavailable evidence cannot authorize another WhatsApp send. */ }
    }
  }
  return saveWhatsApp({ sql, row, at, status: found ? "verified" : "ambiguous",
    providerMessageId: row.whatsappProviderMessageId ?? null,
    error: found ? null : "manual_review_required" });
}

export async function sendManagementNotification({
  sql, householdId, notificationKey, text, sourceService = "support", env = process.env,
  sendWhatsApp = sendVerifiedManagementMessage, sendPing = defaultSendPing, now,
}) {
  services(sourceService);
  if (typeof householdId !== "string" || !householdId.trim()) throw new Error("householdId is required.");
  if (typeof notificationKey !== "string" || !notificationKey.trim()) throw new Error("notificationKey is required.");
  if (typeof text === "string") text = text.trim();
  validatePingPayload({ title: "Airbnb Management", body: text, dedupeKey: keyFor(householdId, notificationKey) });
  const at = instant(now);
  await sql`
    insert into airbnb.management_notifications (
      household_id, notification_key, source_service, text, whatsapp_status, ping_status, ping_attempt_count, created_at, updated_at
    ) values (${householdId}, ${notificationKey}, ${sourceService}, ${text}, 'pending', 'pending', 0, ${at}, ${at})
    on conflict (household_id, notification_key) do nothing
  `;
  let [row] = await sql`
    select * from airbnb.management_notifications
    where household_id = ${householdId} and notification_key = ${notificationKey} and source_service = ${sourceService}
  `;
  if (!row || row.text !== text) throw new Error("Notification key already belongs to different text or service.");
  const [claimed] = await sql`
    update airbnb.management_notifications set whatsapp_status = 'sending', updated_at = ${at}
    where id = ${row.id} and household_id = ${householdId} and source_service = ${sourceService} and whatsapp_status = 'pending'
    returning *
  `;
  if (claimed) {
    row = claimed;
    let result;
    try {
      result = await sendWhatsApp({ text, idempotencyKey: notificationKey, env });
    } catch { /* A failed call can already have written; never resend automatically. */ }
    const providerMessageId = result?.verification?.providerMessageId ?? result?.live?.providerMessageId;
    const hasIdentity = typeof providerMessageId === "string" && Boolean(providerMessageId.trim());
    const verified = result?.verification?.found === true && hasIdentity;
    try {
      row = await saveWhatsApp({ sql, row, at: instant(now), status: verified ? "verified" : "ambiguous",
        providerMessageId: hasIdentity ? providerMessageId : null, error: verified ? null : "manual_review_required" });
    } catch {
      return receipt({ ...row, whatsappStatus: "ambiguous", whatsappError: "manual_review_required" }, "whatsapp_result_not_persisted");
    }
  } else {
    try {
      row = await reconcileWhatsApp({ sql, row, env, at });
    } catch {
      return receipt(row, "whatsapp_reconciliation_not_persisted");
    }
  }
  if (row.whatsappStatus !== "verified" || row.pingStatus !== "pending") return receipt(row);
  try {
    const ping = await claimPing({ sql, householdId, sourceService, at: instant(now), id: row.id });
    return ping ? await deliverClaimedPing({ sql, row: ping, env, sendPing, now }) : receipt(row);
  } catch {
    return receipt(row, "ping_claim_not_persisted");
  }
}

export async function retryPendingManagementPings({
  sql, householdId, sourceService = "support", env = process.env, sendPing = defaultSendPing, now, limit = 20,
}) {
  const scope = services(sourceService);
  if (typeof householdId !== "string" || !householdId.trim()) throw new Error("householdId is required.");
  const at = instant(now);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Ping drain limit must be an integer from 1 to 100.");
  const notifications = [];
  try {
    // Close uncertain or exhausted attempts, without ever extending the provider dedupe window.
    await sql`
      update airbnb.management_notifications
      set ping_status = 'failed', ping_error = 'permanent:retry_window_closed', updated_at = ${at}
      where household_id = ${householdId} and source_service = any(${scope}::text[]) and whatsapp_status = 'verified'
        and (ping_status = 'sending' or (ping_status = 'failed' and ping_error like 'retryable:%'))
        and ping_last_attempt_at <= ${at}::timestamptz - interval '1 minute'
        and (ping_attempt_count >= 2 or ping_first_attempt_at <= ${at}::timestamptz - interval '6 hours')
    `;
    for (let index = 0; index < limit; index += 1) {
      const row = await claimPing({ sql, householdId, sourceService, at: instant(now), retry: true, retryBefore: at });
      if (!row) break;
      notifications.push(await deliverClaimedPing({ sql, row, env, sendPing, now }));
    }
    return { notifications, error: null };
  } catch {
    return { notifications, error: "ping_drain_not_persisted" };
  }
}

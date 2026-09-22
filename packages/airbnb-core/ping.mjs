const ENDPOINT = "https://ping.techlocal.co.za/api/v1/notify";
const KNOWN_ERRORS = new Set([
  "invalid_api_key", "alert_level_not_allowed", "critical_not_available",
  "installation_unreachable", "invalid_request", "payload_too_large",
  "apns_submission_failed", "rate_limited",
]);
const PERMANENT_ERRORS = new Set([
  "invalid_api_key", "alert_level_not_allowed", "critical_not_available",
  "installation_unreachable", "invalid_request", "payload_too_large",
]);

export function validatePingPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ping payload must be an object.");
  }
  const urgency = value.urgency ?? "normal";
  if (!["normal", "time_sensitive"].includes(urgency)) throw new Error("Invalid Ping urgency.");
  const payload = { urgency };
  for (const [field, max] of [["title", 120], ["body", 1000], ["dedupeKey", 128]]) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > max) {
      throw new Error(`Ping ${field} must be nonempty text of at most ${max} characters.`);
    }
    payload[field] = value[field];
  }
  if (!/^[\x20-\x7E]+$/.test(payload.dedupeKey)) throw new Error("Ping dedupeKey must be printable ASCII.");
  return payload;
}

// A single attempt only. The durable caller owns the retry budget and dedupe window.
export async function sendPing(value, { env = process.env, fetchFn = fetch, timeoutMs = 15_000 } = {}) {
  const payload = validatePingPayload(value);
  const apiKey = String(env.PING_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, accepted: false, error: "missing_api_key", delivery: "not_sent", retryable: false };
  try {
    const response = await fetchFn(ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    const valid = data && typeof data === "object" && !Array.isArray(data);
    const accepted = response.status === 202 && valid && data.accepted === true;
    const error = valid ? (KNOWN_ERRORS.has(data.error) ? data.error : "request_failed") : "invalid_response";
    const retryableStatus = [408, 425, 429].includes(response.status)
      || response.status >= 500 || (response.status >= 200 && response.status < 300);
    return {
      ok: Boolean(accepted),
      accepted: Boolean(accepted),
      status: response.status,
      deduplicated: Boolean(valid && data.deduplicated === true),
      delivery: accepted ? "accepted" : "unconfirmed",
      retryable: !accepted && retryableStatus && !PERMANENT_ERRORS.has(error),
      ...(valid && typeof data.requestId === "string" && /^[0-9a-f-]{36}$/i.test(data.requestId)
        ? { requestId: data.requestId } : {}),
      ...(!accepted ? { error } : {}),
    };
  } catch {
    // Transport exceptions and response bodies may contain credentials; never retain them.
    return { ok: false, accepted: false, error: "network_or_timeout", delivery: "unknown", retryable: true };
  }
}

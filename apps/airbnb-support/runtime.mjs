const LIVE_CONFIRMATION = "ENABLE_AIRBNB_SUPPORT_WRITES";

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function supportRuntimeCapabilities(env = process.env) {
  const externalWritesRequested = enabled(env.AIRBNB_SUPPORT_EXTERNAL_WRITES_ENABLED);
  const confirmationMatched = String(env.AIRBNB_SUPPORT_LIVE_CONFIRMATION ?? "").trim()
    === LIVE_CONFIRMATION;
  const janeMailboxConfigured = Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_USER ?? "").trim())
    && Boolean(String(env.AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD ?? "").trim());
  const externalWritesEnabled = externalWritesRequested && confirmationMatched;
  const replyDeliveryEnabled = externalWritesEnabled
    && enabled(env.AIRBNB_SUPPORT_REPLY_DELIVERY_ENABLED);
  const autonomousRepliesEnabled = replyDeliveryEnabled
    && enabled(env.AIRBNB_SUPPORT_AUTONOMOUS_REPLIES_ENABLED)
    && janeMailboxConfigured;
  const managementAlertsEnabled = externalWritesEnabled
    && enabled(env.AIRBNB_SUPPORT_MANAGEMENT_ALERTS_ENABLED);
  return {
    mode: replyDeliveryEnabled || managementAlertsEnabled ? "live" : "shadow",
    externalWritesRequested,
    confirmationMatched,
    externalWritesEnabled,
    janeMailboxConfigured,
    replyDeliveryEnabled,
    autonomousRepliesEnabled,
    managementAlertsEnabled,
  };
}

export function assertSupportModeAllowed(mode, env = process.env) {
  if (mode === "shadow") return supportRuntimeCapabilities(env);
  if (mode !== "live") throw Object.assign(new Error("Unsupported Airbnb support mode."), { code: "INVALID_MODE" });
  const capabilities = supportRuntimeCapabilities(env);
  if (capabilities.mode !== "live") {
    throw Object.assign(new Error("Airbnb support live mode is disabled."), { code: "LIVE_MODE_DISABLED" });
  }
  return capabilities;
}

export const supportLiveConfirmation = LIVE_CONFIRMATION;

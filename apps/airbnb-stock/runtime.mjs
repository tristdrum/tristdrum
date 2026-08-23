const LIVE_CONFIRMATION = "ENABLE_AIRBNB_STOCK_MANAGEMENT_WRITES";

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function stockRuntimeCapabilities(env = process.env) {
  const externalWritesRequested = enabled(env.AIRBNB_STOCK_EXTERNAL_WRITES_ENABLED);
  const confirmationMatched = String(env.AIRBNB_STOCK_LIVE_CONFIRMATION ?? "").trim()
    === LIVE_CONFIRMATION;
  const externalWritesEnabled = externalWritesRequested && confirmationMatched;
  const managementAlertsEnabled = externalWritesEnabled
    && enabled(env.AIRBNB_STOCK_MANAGEMENT_ALERTS_ENABLED);
  return {
    mode: managementAlertsEnabled ? "live" : "observation",
    externalWritesRequested,
    confirmationMatched,
    externalWritesEnabled,
    managementAlertsEnabled,
    orderPlacementAllowed: false,
  };
}

export function assertStockModeAllowed(mode, env = process.env) {
  if (mode === "observation") return stockRuntimeCapabilities(env);
  if (mode !== "live") {
    throw Object.assign(new Error("Unsupported Airbnb stock mode."), { code: "INVALID_MODE" });
  }
  const capabilities = stockRuntimeCapabilities(env);
  if (!capabilities.managementAlertsEnabled) {
    throw Object.assign(new Error("Airbnb stock live alert mode is disabled."), {
      code: "LIVE_MODE_DISABLED",
    });
  }
  return capabilities;
}

export const stockLiveConfirmation = LIVE_CONFIRMATION;

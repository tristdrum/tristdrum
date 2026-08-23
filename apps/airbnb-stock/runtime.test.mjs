import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStockModeAllowed,
  stockLiveConfirmation,
  stockRuntimeCapabilities,
} from "./runtime.mjs";

test("stock live mode remains disabled unless every write gate matches", () => {
  const partial = stockRuntimeCapabilities({
    AIRBNB_STOCK_EXTERNAL_WRITES_ENABLED: "true",
    AIRBNB_STOCK_LIVE_CONFIRMATION: stockLiveConfirmation,
  });
  assert.equal(partial.externalWritesEnabled, true);
  assert.equal(partial.whatsappGroupsConfigured, false);
  assert.equal(partial.managementAlertsEnabled, false);
  assert.equal(partial.orderPlacementAllowed, false);
  assert.throws(
    () => assertStockModeAllowed("live", {}),
    (error) => error.code === "LIVE_MODE_DISABLED",
  );
});

test("the exact confirmation and both boolean gates allow Management alerts only", () => {
  const capabilities = assertStockModeAllowed("live", {
    AIRBNB_STOCK_EXTERNAL_WRITES_ENABLED: "true",
    AIRBNB_STOCK_LIVE_CONFIRMATION: stockLiveConfirmation,
    AIRBNB_STOCK_MANAGEMENT_ALERTS_ENABLED: "true",
    AIRBNB_WHATSAPP_CHAT_ID: "maids@g.us",
    AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us",
  });
  assert.equal(capabilities.mode, "live");
  assert.equal(capabilities.whatsappGroupsConfigured, true);
  assert.equal(capabilities.managementAlertsEnabled, true);
  assert.equal(capabilities.orderPlacementAllowed, false);

  assert.throws(
    () => assertStockModeAllowed("live", {
      AIRBNB_STOCK_EXTERNAL_WRITES_ENABLED: "true",
      AIRBNB_STOCK_LIVE_CONFIRMATION: `${stockLiveConfirmation}_TYPO`,
      AIRBNB_STOCK_MANAGEMENT_ALERTS_ENABLED: "true",
      AIRBNB_WHATSAPP_CHAT_ID: "maids@g.us",
      AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us",
    }),
    (error) => error.code === "LIVE_MODE_DISABLED",
  );
});

test("observation is always allowed and unsupported modes fail closed", () => {
  const observation = assertStockModeAllowed("observation", {});
  assert.equal(observation.mode, "observation");
  assert.equal(observation.whatsappGroupsConfigured, false);
  assert.equal(observation.orderPlacementAllowed, false);
  assert.throws(
    () => assertStockModeAllowed("order", {}),
    (error) => error.code === "INVALID_MODE",
  );
});

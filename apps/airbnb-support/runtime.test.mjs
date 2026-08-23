import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSupportModeAllowed,
  supportLiveConfirmation,
  supportRuntimeCapabilities,
} from "./runtime.mjs";

test("support writes remain disabled unless the global gate and exact confirmation both match", () => {
  const partial = supportRuntimeCapabilities({
    AIRBNB_SUPPORT_EXTERNAL_WRITES_ENABLED: "true",
    AIRBNB_SUPPORT_REPLY_DELIVERY_ENABLED: "true",
  });
  assert.equal(partial.externalWritesEnabled, false);
  assert.equal(partial.replyDeliveryEnabled, false);
  assert.throws(
    () => assertSupportModeAllowed("live", {}),
    (error) => error.code === "LIVE_MODE_DISABLED",
  );
});

test("reviewed delivery, autonomous approval, and management alerts have independent gates", () => {
  const base = {
    AIRBNB_SUPPORT_EXTERNAL_WRITES_ENABLED: "true",
    AIRBNB_SUPPORT_LIVE_CONFIRMATION: supportLiveConfirmation,
    AIRBNB_SUPPORT_REPLY_DELIVERY_ENABLED: "true",
  };
  const reviewed = supportRuntimeCapabilities(base);
  assert.equal(reviewed.replyDeliveryEnabled, true);
  assert.equal(reviewed.autonomousRepliesEnabled, false);
  assert.equal(reviewed.managementAlertsEnabled, false);

  const all = assertSupportModeAllowed("live", {
    ...base,
    AIRBNB_SUPPORT_AUTONOMOUS_REPLIES_ENABLED: "true",
    AIRBNB_SUPPORT_MANAGEMENT_ALERTS_ENABLED: "true",
  });
  assert.equal(all.autonomousRepliesEnabled, true);
  assert.equal(all.managementAlertsEnabled, true);
});

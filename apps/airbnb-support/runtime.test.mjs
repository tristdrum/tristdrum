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
    AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
    AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured",
  });
  assert.equal(all.autonomousRepliesEnabled, true);
  assert.equal(all.managementAlertsEnabled, true);
  assert.equal(all.timeRequestsEnabled, false);

  const withTimeRequests = supportRuntimeCapabilities({
    ...base,
    AIRBNB_SUPPORT_AUTONOMOUS_REPLIES_ENABLED: "true",
    AIRBNB_SUPPORT_TIME_REQUESTS_ENABLED: "true",
    AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
    AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured",
  });
  assert.equal(withTimeRequests.timeRequestsEnabled, true);
});

test("autonomous replies fail closed when Jane mailbox credentials are incomplete", () => {
  const base = {
    AIRBNB_SUPPORT_EXTERNAL_WRITES_ENABLED: "true",
    AIRBNB_SUPPORT_LIVE_CONFIRMATION: supportLiveConfirmation,
    AIRBNB_SUPPORT_REPLY_DELIVERY_ENABLED: "true",
    AIRBNB_SUPPORT_AUTONOMOUS_REPLIES_ENABLED: "true",
  };
  for (const janeCredentials of [
    {},
    { AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test" },
    { AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured" },
  ]) {
    const capabilities = supportRuntimeCapabilities({ ...base, ...janeCredentials });
    assert.equal(capabilities.replyDeliveryEnabled, true);
    assert.equal(capabilities.janeMailboxConfigured, false);
    assert.equal(capabilities.autonomousRepliesEnabled, false);
  }
});

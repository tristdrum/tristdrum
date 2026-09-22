import assert from "node:assert/strict";
import test from "node:test";
import { sendOperatorManagementNotice } from "./management-notice.mjs";

test("operator messages use the same durable paired sender and require live authority", async () => {
  const env = {AIRBNB_MANAGEMENT_NOTICE_CONFIRMATION: "SEND_AIRBNB_MANAGEMENT_NOTICE",
    AIRBNB_SUPPORT_EXTERNAL_WRITES_ENABLED: "true", AIRBNB_SUPPORT_MANAGEMENT_ALERTS_ENABLED: "true",
    AIRBNB_SUPPORT_LIVE_CONFIRMATION: "ENABLE_AIRBNB_SUPPORT_WRITES"};
  const input = {notificationKey: "owner-instruction-123", text: "Alex, staying 23-25 September, needs help at the gate."};
  let called = 0;
  const options = { env, database: {sql: {}, householdId: async () => "household"}, send: async (value) => {
    called += 1;
    assert.equal(value.sourceService, "operator");
    assert.equal(value.notificationKey, "operator:owner-instruction-123");
    assert.equal(value.text, input.text);
    return {whatsappStatus: "verified", pingStatus: "accepted"};
  }};
  assert.equal((await sendOperatorManagementNotice(input, options)).pingStatus, "accepted");
  await assert.rejects(sendOperatorManagementNotice(input, {...options, env: {}}), /explicit confirmation/);
  assert.equal(called, 1);
});

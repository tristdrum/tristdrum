import assert from "node:assert/strict";
import test from "node:test";
import { contentFingerprint } from "@tristdrum/airbnb-core";
import { latestSupportAlerts, notifySupportManagement, renderSupportManagementAlert } from "./management.mjs";

const summary = "Alex, staying 23-25 September, cannot get through the gate and needs help now.";
function alert(id, stage, threadId = "thread-1") {
  return { id, dedupeKey: `guest:${threadId}:${stage}`, openedAt: "2026-09-22T10:00:00Z",
    details: { threadId, stage, guestName: "ALEX", stayLabel: "Sep 23 - 25",
      listingName: "Jasmine Studio Stay", managementSummary: summary } };
}

test("Management uses the model's natural summary unchanged with no framing or links", () => {
  for (const stage of ["immediate", "reminder", "overdue", "delivery_ambiguous"]) {
    const item = alert("example", stage);
    item.providerThreadId = "9900001001";
    assert.equal(renderSupportManagementAlert(item), summary);
  }
});

test("legacy and transport failures have a brief factual fallback without inventing stay dates", () => {
  const item = alert("legacy", "immediate");
  delete item.details.managementSummary;
  item.details.decisionSummary = "The guest needs help with access. https://example.invalid/private";
  assert.equal(renderSupportManagementAlert(item), "Alex, staying Sep 23 - 25: A host needs to check the unresolved guest request.");
  delete item.details.stayLabel;
  item.stayLabel = "Sep 25 - 26";
  assert.match(renderSupportManagementAlert(item), /Sep 25 - 26/);
  delete item.stayLabel;
  delete item.details.decisionSummary;
  item.details.stage = "delivery_ambiguous";
  assert.match(renderSupportManagementAlert(item), /Reply delivery is uncertain/);
  assert.doesNotMatch(renderSupportManagementAlert(item), /https?:|Guest:|Review:|\*/);
});

test("only the most important stage per thread is selected, preserving other threads", () => {
  const selected = latestSupportAlerts([alert("immediate", "immediate"), alert("reminder", "reminder"),
    alert("overdue", "overdue"), alert("ambiguous", "delivery_ambiguous"), alert("other", "immediate", "thread-2")]);
  assert.deepEqual(selected.map((a) => a.id), ["ambiguous", "other"]);
});

test("rejected model summaries never leak through an internal-summary fallback", () => {
  const item = alert("unsafe", "immediate");
  item.details.managementSummary = null;
  item.details.decisionVersion = 3;
  item.details.decisionSummary = "The access information is fixture-private-information.";
  assert.doesNotMatch(renderSupportManagementAlert(item), /fixture-private-information/);
  delete item.details.decisionVersion;
  item.details.decisionSummary = "Guest needs password: fixture-only-secret";
  assert.doesNotMatch(renderSupportManagementAlert(item), /fixture-only-secret/);
  assert.match(renderSupportManagementAlert(item), /unresolved guest request/);
});

test("paired delivery receives the exact summary and stable key; WhatsApp success remains notified when Ping fails", async () => {
  const calls = [];
  const result = await notifySupportManagement({
    sql: {}, householdId: "household", env: { AIRBNB_SUPPORT_ALERT_LIMIT: "24" },
    loadAlerts: async (_sql, options) => {
      assert.equal(options.limit, 24);
      return [alert("first", "immediate"), alert("other", "immediate", "thread-2")];
    },
    sendNotification: async (input) => {
      calls.push(input);
      return { id: "notification", whatsappStatus: "verified", pingStatus: "failed" };
    },
    markNotified: async (_sql, input) => calls.push(input),
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].text, summary);
  assert.equal(calls[0].notificationKey, `airbnb-support-alert:${contentFingerprint("guest:thread-1:immediate")}`);
  assert.equal(calls[0].sourceService, "support");
  assert.equal(calls[1].alertId, "first");
  assert.deepEqual(result, [{ alertId: "first", stage: "immediate", verified: true,
    pingStatus: "failed", notificationId: "notification" }]);
});

test("uncertain WhatsApp delivery never marks an alert notified", async () => {
  let marked = false;
  await assert.rejects(notifySupportManagement({
    sql: {}, householdId: "household", loadAlerts: async () => [alert("first", "immediate")],
    sendNotification: async () => ({ whatsappStatus: "ambiguous", pingStatus: "pending" }),
    markNotified: async () => { marked = true; },
  }), { code: "MANAGEMENT_READBACK_UNVERIFIED" });
  assert.equal(marked, false);
});

test("there is no notification for an empty eligible alert list", async () => {
  assert.deepEqual(await notifySupportManagement({sql: {}, householdId: "household", loadAlerts: async () => [],
    sendNotification: async () => { throw new Error("Must not send"); }}), []);
});

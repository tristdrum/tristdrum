import assert from "node:assert/strict";
import test from "node:test";
import {
  latestSupportAlerts,
  notifySupportManagement,
  renderSupportManagementAlert,
} from "./management.mjs";

function alert(id, stage, threadId = "thread-1") {
  return {
    id,
    alertType: stage === "overdue" ? "guest_overdue" : "guest_escalation",
    dedupeKey: `guest:${threadId}:${stage}`,
    openedAt: "2026-08-23T12:00:00.000Z",
    details: {
      threadId,
      stage,
      listingName: "Jasmine Studio Stay",
      guestName: "Guest Fixture",
      classificationSummary: "A booking question needs a human answer.",
    },
  };
}

test("a delayed first alert sends only the most useful stage for each thread", () => {
  assert.deepEqual(
    latestSupportAlerts([
      alert("immediate", "immediate"),
      alert("reminder", "reminder"),
      alert("overdue", "overdue"),
      alert("ambiguous", "delivery_ambiguous"),
      alert("other", "immediate", "thread-2"),
    ]).map((item) => item.id),
    ["ambiguous", "other"],
  );
});

test("higher-stage alerts are selected before older immediate alerts", () => {
  const immediate = alert("old-immediate", "immediate", "thread-old");
  immediate.openedAt = "2026-08-23T10:00:00.000Z";
  const overdue = alert("new-overdue", "overdue", "thread-new");
  overdue.openedAt = "2026-08-23T12:00:00.000Z";
  assert.deepEqual(latestSupportAlerts([immediate, overdue]).map((item) => item.id), [
    "new-overdue",
    "old-immediate",
  ]);
});

test("support Management alert is concise and does not include raw message text", () => {
  const text = renderSupportManagementAlert(alert("overdue", "overdue"));
  assert.match(text, /^\*Airbnb guest reply overdue\*/);
  assert.match(text, /Jasmine Studio Stay/);
  assert.match(text, /Review: https:\/\/www\.tristdrum\.com\/dashboard\/airbnb$/);
});

test("ambiguous delivery alerts ask for explicit reconciliation", () => {
  const item = alert("ambiguous", "delivery_ambiguous");
  item.details.classificationSummary = "Check Sent mail, then mark the reply sent, retry it, or cancel it.";
  const text = renderSupportManagementAlert(item);
  assert.match(text, /^\*Airbnb reply delivery needs confirmation\*/);
  assert.match(text, /Check Sent mail/);
});

test("verified Management sends are marked notified exactly once", async () => {
  const calls = [];
  let loadedLimit;
  const result = await notifySupportManagement({
    sql: {},
    householdId: "22222222-2222-4222-8222-222222222222",
    env: { AIRBNB_SUPPORT_ALERT_LIMIT: "24" },
    loadAlerts: async (_sql, options) => {
      loadedLimit = options.limit;
      return [alert("immediate", "immediate")];
    },
    sendMessage: async (message) => {
      calls.push(["send", message]);
      return { verification: { found: true } };
    },
    markNotified: async (_sql, value) => calls.push(["mark", value.alertId]),
    now: () => new Date("2026-08-23T12:05:00.000Z"),
  });
  assert.equal(loadedLimit, 24);
  assert.equal(result[0].verified, true);
  assert.deepEqual(calls.map(([name]) => name), ["send", "mark"]);
});

test("a delayed first notification scans all stages and sends only the overdue alert", async () => {
  const calls = [];
  const result = await notifySupportManagement({
    sql: {},
    householdId: "22222222-2222-4222-8222-222222222222",
    loadAlerts: async () => [
      alert("immediate", "immediate"),
      alert("reminder", "reminder"),
      alert("overdue", "overdue"),
    ],
    sendMessage: async (message) => {
      calls.push(message.text);
      return { verification: { found: true } };
    },
    markNotified: async (_sql, value) => calls.push(value.alertId),
  });
  assert.equal(result[0].stage, "overdue");
  assert.match(calls[0], /reply overdue/i);
  assert.equal(calls[1], "overdue");
});

test("an unverified Management send is never marked notified", async () => {
  let marked = false;
  await assert.rejects(
    notifySupportManagement({
      sql: {},
      householdId: "22222222-2222-4222-8222-222222222222",
      loadAlerts: async () => [alert("immediate", "immediate")],
      sendMessage: async () => ({ verification: { found: false } }),
      markNotified: async () => { marked = true; },
    }),
    { code: "MANAGEMENT_READBACK_UNVERIFIED" },
  );
  assert.equal(marked, false);
});

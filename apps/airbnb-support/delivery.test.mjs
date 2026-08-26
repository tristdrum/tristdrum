import assert from "node:assert/strict";
import test from "node:test";
import { parseAirbnbConversationEmail } from "@tristdrum/airbnb-core";
import { eventsAddedAfterDraft, processDeliveryGuard } from "./delivery.mjs";

const householdId = "22222222-2222-4222-8222-222222222222";
const deliveryId = "33333333-3333-4333-8333-333333333333";
const providerThreadId = "1234567890";
const outboundMessageId = "<stable-reply@airbnb.tristdrum.com>";

function conversationEmail(entries, occurredAt = "2026-08-21T12:00:00.000Z") {
  const messageId = `<source-${Date.parse(occurredAt)}@example.test>`;
  return {
    mailboxScope: "tristan",
    providerMessageId: messageId,
    rfcMessageId: messageId,
    subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    from: "express@airbnb.com",
    replyTo: "express@airbnb.com",
    references: ["<older@example.test>"],
    occurredAt,
    body: [
      "Reservation for Jasmine Studio Stay, Aug 22 - 23",
      `https://www.airbnb.test/hosting/thread/${providerThreadId}`,
      ...entries.flatMap((entry) => [entry.name, entry.role, entry.text]),
    ].join("\n"),
  };
}

function harness(currentEmail, overrides = {}) {
  const sourceEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const source = parseAirbnbConversationEmail(sourceEmail);
  const calls = [];
  const claimed = {
    action: "claimed",
    id: deliveryId,
    providerThreadId,
    sourceFingerprint: source.sourceFingerprint,
    sourceLastEventAt: sourceEmail.occurredAt,
    sourceEvents: source.entries.map((entry) => ({ direction: entry.direction, contentHash: entry.contentHash })),
    draftText: "Hello, and welcome!",
    finalText: null,
    outboundMessageId,
  };
  return {
    source,
    calls,
    options: {
      sql: {},
      householdId,
      deliveryId,
      now: () => new Date("2026-08-21T12:05:00.000Z"),
      env: {
        AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
        AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured",
      },
      claimDelivery: async () => {
        calls.push(["claim"]);
        return claimed;
      },
      collectMessages: async ({ mailboxScope }) => {
        calls.push([`collect-${mailboxScope}`]);
        return { messages: [currentEmail], envelopesFound: 1 };
      },
      reconcileSent: async () => {
        calls.push(["sent-check"]);
        return [];
      },
      applyDecision: async (_sql, value) => calls.push(["decision", value.decision]),
      recordAttempt: async () => {
        calls.push(["attempt"]);
        return { sendAttemptCount: 1 };
      },
      markSent: async (_sql, value) => calls.push(["sent", value.providerMessageId]),
      recordAmbiguous: async () => calls.push(["ambiguous"]),
      recordGuardFailure: async (_sql, value) => calls.push(["guard-failed", value.attemptRecorded]),
      sendReply: async (value) => {
        calls.push(["send", value]);
        return { messageId: value.messageId };
      },
      ...overrides,
    },
  };
}

test("event comparison ignores the source snapshot and detects only appended actors", () => {
  const sourceEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const source = parseAirbnbConversationEmail(sourceEmail);
  const currentEmail = conversationEmail([
    { name: "Guest Alpha", role: "Guest", text: "Hello" },
    { name: "JANE", role: "Host", text: "Welcome" },
  ], "2026-08-21T12:02:00.000Z");
  const current = parseAirbnbConversationEmail(currentEmail);
  assert.deepEqual(eventsAddedAfterDraft(current, currentEmail.occurredAt, source.entries), [{
    direction: "host",
    occurredAt: "2026-08-21T12:02:00.001Z",
  }]);
});

test("event comparison treats a repeated identical message as a new event", () => {
  assert.deepEqual(eventsAddedAfterDraft({ entries: [
    { direction: "guest", contentHash: "same", sequence: 0 },
    { direction: "guest", contentHash: "same", sequence: 1 },
  ] }, "2026-08-21T12:02:00.000Z", [
    { direction: "guest", contentHash: "same" },
  ]), [{
    direction: "guest",
    occurredAt: "2026-08-21T12:02:00.001Z",
  }]);
});

test("stable canonical thread sends exactly once without the automated footer", async () => {
  const currentEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const { calls, options } = harness(currentEmail);
  const result = await processDeliveryGuard(options);
  assert.equal(result.action, "sent");
  const sends = calls.filter(([name]) => name === "send");
  assert.equal(sends.length, 1);
  assert.equal(sends[0][1].messageId, outboundMessageId);
  assert.equal(sends[0][1].text, "Hello, and welcome!");
  assert.deepEqual(calls.at(-1), ["sent", outboundMessageId]);
  assert.deepEqual(calls.map(([name]) => name), [
    "claim",
    "attempt",
    "collect-tristan",
    "collect-jane",
    "sent-check",
    "sent-check",
    "send",
    "sent",
  ]);
});

test("newer host or guest activity prevents an autonomous reply", async () => {
  const hostEmail = conversationEmail([
    { name: "Guest Alpha", role: "Guest", text: "Hello" },
    { name: "JANE", role: "Host", text: "Welcome" },
  ], "2026-08-21T12:02:00.000Z");
  const hostHarness = harness(hostEmail);
  const hostResult = await processDeliveryGuard(hostHarness.options);
  assert.equal(hostResult.action, "handled_by_human");
  assert.equal(hostHarness.calls.some(([name]) => name === "send"), false);

  const guestEmail = conversationEmail([
    { name: "Guest Alpha", role: "Guest", text: "Hello" },
    { name: "Guest Alpha", role: "Guest", text: "Can I arrive early?" },
  ], "2026-08-21T12:03:00.000Z");
  const guestHarness = harness(guestEmail);
  const guestResult = await processDeliveryGuard(guestHarness.options);
  assert.equal(guestResult.action, "cancel_and_reevaluate");
  assert.equal(guestHarness.calls.some(([name]) => name === "send"), false);
});

test("a human reply observed after the database claim cancels before SMTP", async () => {
  const hostEmail = conversationEmail([
    { name: "Guest Alpha", role: "Guest", text: "Hello" },
    { name: "JANE", role: "Host", text: "Welcome" },
  ], "2026-08-21T12:02:00.000Z");
  const afterClaim = harness(hostEmail);
  const result = await processDeliveryGuard(afterClaim.options);
  assert.equal(result.action, "handled_by_human");
  assert.deepEqual(afterClaim.calls.map(([name]) => name), [
    "claim",
    "attempt",
    "collect-tristan",
    "collect-jane",
    "sent-check",
    "sent-check",
    "decision",
  ]);
});

test("a recent human Sent reply cancels before SMTP even if Airbnb mail has not refreshed", async () => {
  const currentEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const sentReply = harness(currentEmail, {
    reconcileSent: async ({ mailboxScope }) => mailboxScope === "jane"
      ? { messageIds: [], humanReplyAt: "2026-08-21T12:03:00.000Z" }
      : { messageIds: [], humanReplyAt: null },
  });
  const result = await processDeliveryGuard(sentReply.options);
  assert.equal(result.action, "handled_by_human");
  assert.equal(sentReply.calls.some(([name]) => name === "send"), false);
});

test("missing or incomplete Jane mailbox access disables the guard before claiming", async () => {
  const currentEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  for (const env of [
    {},
    { AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test" },
    { AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured" },
  ]) {
    const disabled = harness(currentEmail, { env });
    assert.deepEqual(await processDeliveryGuard(disabled.options), {
      action: "guard_disabled",
      reason: "jane_mailbox_unavailable",
    });
    assert.deepEqual(disabled.calls, []);
  }
});

test("a synthetic IMAP identity cannot become a reply anchor", async () => {
  const currentEmail = {
    ...conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]),
    providerMessageId: "imap:42",
    rfcMessageId: null,
  };
  const missingMessageId = harness(currentEmail);
  const result = await processDeliveryGuard(missingMessageId.options);
  assert.deepEqual(result, { action: "guard_error", retrySafeBeforeSmtp: true });
  assert.equal(missingMessageId.calls.some(([name]) => name === "sent-check"), false);
  assert.equal(missingMessageId.calls.some(([name]) => name === "send"), false);
});

test("Jane evidence may veto a send but never becomes the SMTP reply target", async () => {
  const tristanEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const janeEmail = {
    ...conversationEmail([
      { name: "Guest Alpha", role: "Guest", text: "Hello" },
      { name: "JANE", role: "Host", text: "Welcome" },
    ], "2026-08-21T12:02:00.000Z"),
    mailboxScope: "jane",
    from: "automated@airbnb.com",
    replyTo: "jane-specific-route@example.test",
  };
  const veto = harness(tristanEmail, {
    env: {
      AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
      AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured",
    },
    collectMessages: async ({ mailboxScope }) => ({
      messages: [mailboxScope === "jane" ? janeEmail : tristanEmail],
      envelopesFound: 1,
    }),
  });
  const vetoResult = await processDeliveryGuard(veto.options);
  assert.equal(vetoResult.action, "handled_by_human");
  assert.equal(veto.calls.some(([name]) => name === "send"), false);

  const staleJaneEmail = {
    ...tristanEmail,
    mailboxScope: "jane",
    from: "automated@airbnb.com",
    replyTo: "jane-specific-route@example.test",
  };
  const send = harness(tristanEmail, {
    env: {
      AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
      AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "configured",
    },
    collectMessages: async ({ mailboxScope }) => ({
      messages: [mailboxScope === "jane" ? staleJaneEmail : tristanEmail],
      envelopesFound: 1,
    }),
  });
  const sendResult = await processDeliveryGuard(send.options);
  assert.equal(sendResult.action, "sent");
  const smtp = send.calls.find(([name]) => name === "send")[1];
  assert.equal(smtp.to, tristanEmail.replyTo);
  assert.notEqual(smtp.to, staleJaneEmail.replyTo);
});

test("an ambiguous SMTP result is terminal until manual Sent reconciliation", async () => {
  const currentEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const first = harness(currentEmail, {
    sendReply: async () => { throw new Error("SMTP connection closed after DATA"); },
  });
  const firstResult = await processDeliveryGuard(first.options);
  assert.deepEqual(firstResult, { action: "ambiguous", manualReconciliationRequired: true });
  assert.equal(first.calls.some(([name]) => name === "ambiguous"), true);

  const retry = harness(currentEmail, {
    claimDelivery: async () => null,
  });
  const retryResult = await processDeliveryGuard(retry.options);
  assert.equal(retryResult.action, "not_claimed");
  assert.equal(retry.calls.some(([name]) => name === "send"), false);
});

test("a mailbox guard failure returns the delivery to a safe pre-SMTP retry", async () => {
  const currentEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const { calls, options } = harness(currentEmail, {
    collectMessages: async ({ mailboxScope }) => {
      calls.push([`collect-${mailboxScope}`]);
      throw new Error("IMAP unavailable");
    },
    recordGuardFailure: async (_sql, value) => calls.push(["guard-failed", value.attemptRecorded]),
  });
  const result = await processDeliveryGuard(options);
  assert.deepEqual(result, { action: "guard_error", retrySafeBeforeSmtp: true });
  assert.equal(calls.some(([name]) => name === "send"), false);
  assert.deepEqual(calls.at(-1), ["guard-failed", true]);
});

test("a Sent-mail deadline remains retry-safe before SMTP", async () => {
  const currentEmail = conversationEmail([{ name: "Guest Alpha", role: "Guest", text: "Hello" }]);
  const { calls, options } = harness(currentEmail, {
    reconcileSent: async () => {
      throw Object.assign(new Error("Sent-mail guard timed out."), { code: "IMAP_GUARD_DEADLINE" });
    },
    recordGuardFailure: async (_sql, value) => calls.push(["guard-failed", value.attemptRecorded]),
  });
  const result = await processDeliveryGuard(options);
  assert.deepEqual(result, { action: "guard_error", retrySafeBeforeSmtp: true });
  assert.equal(calls.some(([name]) => name === "send"), false);
  assert.deepEqual(calls.at(-1), ["guard-failed", true]);
});

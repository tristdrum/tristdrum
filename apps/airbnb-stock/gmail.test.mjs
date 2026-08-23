import assert from "node:assert/strict";
import test from "node:test";
import { collectSixty60Messages } from "./gmail.mjs";

test("collector filters untrusted mail and always closes IMAP", async () => {
  let released = false;
  let loggedOut = false;
  const source = Buffer.from([
    "Message-ID: <sixty60-test@example.test>",
    "From: no-reply@checkers.sixty60.co.za",
    "Subject: Sixty60 invoice for order 218300001",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Order No.: 218300001",
  ].join("\r\n"));
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() { released = true; } }; },
    async search() { return [1, 2]; },
    async *fetch() {
      yield { uid: 1, internalDate: new Date("2026-08-18T12:00:00Z"), envelope: { subject: "Sixty60 invoice for order 218300001", from: [{ address: "no-reply@checkers.sixty60.co.za" }], messageId: "<sixty60-test@example.test>" } };
      yield { uid: 2, internalDate: new Date("2026-08-18T12:01:00Z"), envelope: { subject: "Sixty60 invoice", from: [{ address: "attacker@example.com" }] } };
    },
    async fetchOne() { return { source }; },
    async logout() { loggedOut = true; },
    close() {},
  };
  const result = await collectSixty60Messages({
    since: new Date("2026-08-01T00:00:00Z"),
    env: { JANE_GMAIL_USER: "jane@example.test", JANE_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: () => client,
  });
  assert.equal(result.envelopesFound, 1);
  assert.equal(result.messages[0].providerMessageId, "<sixty60-test@example.test>");
  assert.equal(released, true);
  assert.equal(loggedOut, true);
});

test("collector does not download bodies for already ingested message IDs", async () => {
  let bodyFetches = 0;
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [1]; },
    async *fetch() {
      yield {
        uid: 1,
        internalDate: new Date("2026-08-18T12:00:00Z"),
        envelope: {
          subject: "Sixty60 invoice for order 218300001",
          from: [{ address: "no-reply@checkers.sixty60.co.za" }],
          messageId: "<already-ingested@example.test>",
        },
      };
    },
    async fetchOne() {
      bodyFetches += 1;
      throw new Error("known messages must not be fetched");
    },
    async logout() {},
    close() {},
  };
  const result = await collectSixty60Messages({
    since: new Date("2026-08-01T00:00:00Z"),
    knownProviderMessageIds: ["<already-ingested@example.test>"],
    env: { JANE_GMAIL_USER: "jane@example.test", JANE_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: () => client,
  });
  assert.equal(bodyFetches, 0);
  assert.equal(result.envelopesFound, 1);
  assert.equal(result.envelopesSkippedKnown, 1);
  assert.deepEqual(result.messages, []);
});

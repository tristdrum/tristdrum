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

test("known boundary-day mail is skipped while unseen mail from the same day is downloaded", async () => {
  const fetched = [];
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search({ since }) { assert.equal(since.toISOString(), "2026-05-16T00:00:00.000Z"); return [1, 2]; },
    async *fetch() {
      for (const uid of [1, 2]) yield {
        uid,
        internalDate: new Date(`2026-05-16T08:5${uid}:00Z`),
        envelope: { subject: `Sixty60 invoice for order 12345678${uid}`,
          from: [{ address: "no-reply@checkers.sixty60.co.za" }],
          messageId: `<boundary-${uid}@example.test>` },
      };
    },
    async fetchOne(uid) {
      fetched.push(uid);
      return { source: Buffer.from(`Message-ID: <boundary-${uid}@example.test>\r\nFrom: no-reply@checkers.sixty60.co.za\r\nSubject: Sixty60 invoice for order 12345678${uid}\r\n\r\nOrder No.: 12345678${uid}`) };
    },
    async logout() {},
    close() {},
  };
  const result = await collectSixty60Messages({
    since: new Date("2026-05-16T00:00:00Z"),
    knownProviderMessageIds: ["<boundary-1@example.test>"],
    env: { JANE_GMAIL_USER: "jane@example.test", JANE_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: () => client,
  });
  assert.deepEqual(fetched, [2]);
  assert.equal(result.envelopesSkippedKnown, 1);
  assert.deepEqual(result.messages.map((message) => message.providerMessageId), ["<boundary-2@example.test>"]);
});

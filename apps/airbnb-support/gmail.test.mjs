import assert from "node:assert/strict";
import test from "node:test";
import {
  collectConversationMessages,
  findSentMessageIds,
  sendThreadedReply,
} from "./gmail.mjs";

test("canonical collector accepts only Tristan's express stream and closes IMAP", async () => {
  let released = false;
  let loggedOut = false;
  let sourceFetchRange = null;
  let clientOptions = null;
  const source = Buffer.from([
    "Message-ID: <conversation@example.test>",
    "From: express@airbnb.com",
    "Reply-To: express@airbnb.com",
    "Subject: RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "RESERVATION FOR JASMINE STUDIO STAY, AUG 22 - 23",
    "Guest",
    "Hello",
  ].join("\r\n"));
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() { released = true; } }; },
    async search() { return [1, 2]; },
    async *fetch(range, query) {
      if (query.source) {
        sourceFetchRange = range;
        yield { uid: 1, source };
        return;
      }
      yield { uid: 1, internalDate: new Date("2026-08-21T12:00:00Z"), envelope: { subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23", from: [{ address: "express@airbnb.com" }] } };
      yield { uid: 2, internalDate: new Date("2026-08-21T12:01:00Z"), envelope: { subject: "Reservation confirmed", from: [{ address: "automated@airbnb.com" }] } };
    },
    async logout() { loggedOut = true; },
    close() {},
  };
  const result = await collectConversationMessages({
    since: new Date("2026-08-01T00:00:00Z"),
    env: { AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test", AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: (options) => {
      clientOptions = options;
      return client;
    },
  });
  assert.equal(result.envelopesFound, 1);
  assert.equal(result.messages[0].providerMessageId, "<conversation@example.test>");
  assert.equal(result.messages[0].mailboxScope, "tristan");
  assert.deepEqual(sourceFetchRange, [1]);
  assert.equal(clientOptions.connectionTimeout, 15_000);
  assert.equal(clientOptions.socketTimeout, 30_000);
  assert.equal(released, true);
  assert.equal(loggedOut, true);
});

test("collector closes a stalled IMAP import at the configured deadline", async () => {
  let closed = false;
  const client = {
    usable: false,
    connect: () => new Promise(() => {}),
    close() { closed = true; },
  };
  await assert.rejects(
    collectConversationMessages({
      since: new Date("2026-08-01T00:00:00Z"),
      env: {
        AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test",
        AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret",
        AIRBNB_SUPPORT_GMAIL_IMPORT_DEADLINE_MS: "10",
      },
      createClient: () => client,
    }),
    { code: "IMAP_IMPORT_DEADLINE" },
  );
  assert.equal(closed, true);
});

test("supplemental collector uses Jane's isolated credentials and labels its evidence", async () => {
  let clientOptions;
  let searchQuery;
  const source = Buffer.from([
    "Message-ID: <jane-copy@example.test>",
    "From: automated@airbnb.com",
    "Subject: RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "RESERVATION FOR JASMINE STUDIO STAY, AUG 22 - 23",
    "Guest",
    "Hello",
  ].join("\r\n"));
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) { searchQuery = query; return [7]; },
    async *fetch(_range, query) {
      if (query.source) yield { uid: 7, source };
      else yield {
        uid: 7,
        internalDate: new Date("2026-08-21T12:00:00Z"),
        envelope: {
          subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
          from: [{ address: "automated@airbnb.com" }],
        },
      };
    },
    async logout() {},
    close() {},
  };
  const result = await collectConversationMessages({
    since: new Date("2026-08-01T00:00:00Z"),
    mailboxScope: "jane",
    env: {
      AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
      AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "not-a-secret",
    },
    createClient: (options) => {
      clientOptions = options;
      return client;
    },
  });
  assert.equal(clientOptions.auth.user, "jane@example.test");
  assert.equal(searchQuery.from, "airbnb.com");
  assert.equal(result.messages[0].mailboxScope, "jane");
});

test("Sent reconciliation searches Gmail by the stable outbound Message-ID", async () => {
  const searches = [];
  let released = false;
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock(folder) {
      assert.equal(folder, "[Gmail]/Sent Mail");
      return { release() { released = true; } };
    },
    async search(query) {
      searches.push(query);
      return query.header["message-id"] === "<sent@example.test>" ? [10] : [];
    },
    async logout() {},
    close() {},
  };
  const found = await findSentMessageIds({
    messageIds: ["<sent@example.test>", "<missing@example.test>"],
    env: { AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test", AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: () => client,
  });
  assert.deepEqual(found, ["<sent@example.test>"]);
  assert.equal(searches.length, 2);
  assert.equal(released, true);
});

test("threaded sender preserves the stable Message-ID and refuses non-Airbnb recipients", async () => {
  let transportOptions;
  let message;
  let closed = false;
  const createTransport = (options) => {
    transportOptions = options;
    return {
      async sendMail(value) {
        message = value;
        return { messageId: value.messageId, accepted: [value.to], rejected: [] };
      },
      close() { closed = true; },
    };
  };
  const result = await sendThreadedReply({
    to: "express@airbnb.com",
    subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    text: "Hello\n\nAutomated reply on behalf of your hosts.",
    messageId: "<stable@example.test>",
    inReplyTo: "<source@example.test>",
    references: ["<older@example.test>"],
    env: { AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test", AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret" },
    createTransport,
  });
  assert.equal(transportOptions.auth.user, "tristan@example.test");
  assert.equal(message.messageId, "<stable@example.test>");
  assert.deepEqual(message.references, ["<older@example.test>", "<source@example.test>"]);
  assert.equal(result.messageId, "<stable@example.test>");
  assert.equal(closed, true);

  await assert.rejects(sendThreadedReply({
    to: "attacker@example.test",
    subject: "RE: Reservation",
    text: "No",
    messageId: "<blocked@example.test>",
    env: { AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test", AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret" },
    createTransport,
  }), /not trusted/i);
});

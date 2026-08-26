import assert from "node:assert/strict";
import test from "node:test";
import {
  collectBookingLifecycleMessages,
  collectConversationMessages,
  findSentMessageIds,
  findSentThreadEvidence,
  sendThreadedReply,
} from "./gmail.mjs";

test("booking lifecycle collector keeps only trusted non-payment dismissals", async () => {
  const source = Buffer.from([
    "Message-ID: <expired-request@example.test>",
    "From: Airbnb <automated@airbnb.com>",
    "Subject: Sep 4 - 6 request at Bougainvillea Courtyard Studio dismissed - no payment",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "We didn't receive payment from Somila for their Sep 4 - 6 reservation request at Bougainvillea Courtyard Studio.",
    "The reservation request has been automatically declined.",
  ].join("\r\n"));
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) {
      assert.equal(query.from, "automated@airbnb.com");
      return [1, 2];
    },
    async *fetch(_range, query) {
      if (query.source) {
        yield { uid: 1, source };
        return;
      }
      yield {
        uid: 1,
        internalDate: new Date("2026-08-26T10:23:00Z"),
        envelope: {
          subject: "Sep 4 - 6 request at Bougainvillea Courtyard Studio dismissed - no payment",
          from: [{ address: "automated@airbnb.com" }],
        },
      };
      yield {
        uid: 2,
        internalDate: new Date("2026-08-26T10:24:00Z"),
        envelope: {
          subject: "Reservation confirmed - Unrelated Guest arrives Sep 4",
          from: [{ address: "automated@airbnb.com" }],
        },
      };
    },
    async logout() {},
    close() {},
  };
  const result = await collectBookingLifecycleMessages({
    since: new Date("2026-08-25T00:00:00Z"),
    env: {
      AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test",
      AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret",
    },
    createClient: () => client,
  });
  assert.equal(result.envelopesFound, 1);
  assert.equal(result.messages[0].providerMessageId, "<expired-request@example.test>");
  assert.match(result.messages[0].body, /didn't receive payment from Somila/i);
});

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
  assert.equal(result.messages[0].rfcMessageId, "<conversation@example.test>");
  assert.equal(result.messages[0].mailboxScope, "tristan");
  assert.deepEqual(sourceFetchRange, [1]);
  assert.equal(clientOptions.connectionTimeout, 15_000);
  assert.equal(clientOptions.socketTimeout, 30_000);
  assert.equal(released, true);
  assert.equal(loggedOut, true);
});

test("historical collection pages forward by UID without rereading newer mail", async () => {
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [1, 2, 3, 4]; },
    async *fetch(range, query) {
      if (query.source) {
        for (const uid of range) {
          yield {
            uid,
            source: Buffer.from([
              `Message-ID: <conversation-${uid}@example.test>`,
              "From: express@airbnb.com",
              `Subject: RE: Inquiry for Jasmine Studio Stay, Aug ${20 + uid} - ${21 + uid}`,
              "Content-Type: text/plain; charset=utf-8",
              "",
              "Guest",
              "Hello",
            ].join("\r\n")),
          };
        }
        return;
      }
      for (let uid = 1; uid <= 4; uid += 1) {
        yield {
          uid,
          internalDate: new Date(`2026-08-${20 + uid}T12:00:00Z`),
          envelope: {
            subject: `RE: Inquiry for Jasmine Studio Stay, Aug ${20 + uid} - ${21 + uid}`,
            from: [{ address: "express@airbnb.com" }],
          },
        };
      }
    },
    async logout() {},
    close() {},
  };
  const result = await collectConversationMessages({
    since: new Date("2026-08-01T00:00:00Z"),
    afterUid: 1,
    oldestFirst: true,
    maxRead: 2,
    env: { AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test", AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: () => client,
  });
  assert.deepEqual(result.messages.map((message) => message.uid), [2, 3]);
  assert.equal(result.lastUid, 3);
});

test("collector closes a stalled IMAP import at the configured deadline", async () => {
  let closed = false;
  const client = {
    usable: false,
    connect: () => new Promise(() => {}),
    close() {
      closed = true;
      throw new Error("Connection not available");
    },
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

test("deadline cleanup stays bounded when a usable client's logout never settles", async () => {
  let closed = false;
  const client = {
    usable: true,
    connect: () => new Promise(() => {}),
    logout: () => new Promise(() => {}),
    close() { closed = true; },
  };
  const startedAt = Date.now();
  await assert.rejects(
    collectConversationMessages({
      since: new Date("2026-08-01T00:00:00Z"),
      env: {
        AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test",
        AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret",
        AIRBNB_SUPPORT_GMAIL_IMPORT_DEADLINE_MS: "10",
        AIRBNB_SUPPORT_GMAIL_CLEANUP_TIMEOUT_MS: "10",
      },
      createClient: () => client,
    }),
    { code: "IMAP_IMPORT_DEADLINE" },
  );
  assert.equal(closed, true);
  assert.ok(Date.now() - startedAt < 250);
});

test("Sent-thread reconciliation has a bounded pre-SMTP deadline", async () => {
  let closed = false;
  const client = {
    usable: true,
    connect: () => new Promise(() => {}),
    logout: () => new Promise(() => {}),
    close() { closed = true; },
  };
  await assert.rejects(
    findSentThreadEvidence({
      messageIds: ["<outbound@example.test>"],
      since: new Date("2026-08-01T00:00:00Z"),
      referenceIds: ["<source@example.test>"],
      env: {
        AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test",
        AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret",
        AIRBNB_SUPPORT_GMAIL_GUARD_DEADLINE_MS: "10",
        AIRBNB_SUPPORT_GMAIL_CLEANUP_TIMEOUT_MS: "10",
      },
      createClient: () => client,
    }),
    { code: "IMAP_GUARD_DEADLINE" },
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

test("Sent reconciliation detects a recent human reply in the Airbnb thread", async () => {
  const source = Buffer.from([
    "Message-ID: <human-reply@example.test>",
    "From: tristan@example.test",
    "To: express@airbnb.com",
    "Subject: Re: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    "In-Reply-To: <conversation@example.test>",
    "References: <conversation@example.test>",
    "Date: Fri, 21 Aug 2026 12:03:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "I have replied to the guest.",
  ].join("\r\n"));
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) {
      return query.header ? [] : [11];
    },
    async *fetch() {
      yield { uid: 11, source, internalDate: new Date("2026-08-21T12:03:00.000Z") };
    },
    async logout() {},
    close() {},
  };
  const evidence = await findSentThreadEvidence({
    messageIds: ["<bot-reply@example.test>"],
    since: new Date("2026-08-21T12:00:00.000Z"),
    referenceIds: ["<conversation@example.test>"],
    mailboxScope: "tristan",
    env: { AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test", AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: () => client,
  });
  assert.deepEqual(evidence, {
    messageIds: [],
    humanReplyAt: "2026-08-21T12:03:00.000Z",
  });
});

test("Sent reconciliation uses Jane's isolated Sent mailbox", async () => {
  let clientUser;
  const source = Buffer.from([
    "Message-ID: <jane-human-reply@example.test>",
    "From: jane@example.test",
    "To: express@airbnb.com",
    "Subject: Re: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    "In-Reply-To: <conversation@example.test>",
    "Date: Fri, 21 Aug 2026 12:04:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Jane has replied to the guest.",
  ].join("\r\n"));
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) { return query.header ? [] : [12]; },
    async *fetch() {
      yield { uid: 12, source, internalDate: new Date("2026-08-21T12:04:00.000Z") };
    },
    async logout() {},
    close() {},
  };
  const evidence = await findSentThreadEvidence({
    messageIds: [],
    since: new Date("2026-08-21T12:00:00.000Z"),
    referenceIds: ["<conversation@example.test>"],
    mailboxScope: "jane",
    env: {
      AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
      AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "not-a-secret",
    },
    createClient: (options) => {
      clientUser = options.auth.user;
      return client;
    },
  });
  assert.equal(clientUser, "jane@example.test");
  assert.equal(evidence.humanReplyAt, "2026-08-21T12:04:00.000Z");
});

test("Sent reconciliation ignores a matching subject from a different Airbnb thread", async () => {
  const source = Buffer.from([
    "Message-ID: <unrelated-human-reply@example.test>",
    "From: jane@example.test",
    "To: express@airbnb.com",
    "Subject: Re: Reservation for Jasmine Studio Stay, Aug 22 - 23",
    "In-Reply-To: <different-conversation@example.test>",
    "References: <different-conversation@example.test>",
    "Date: Fri, 21 Aug 2026 12:04:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "A reply to another guest with the same subject.",
  ].join("\r\n"));
  const client = {
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) { return query.header ? [] : [13]; },
    async *fetch() {
      yield { uid: 13, source, internalDate: new Date("2026-08-21T12:04:00.000Z") };
    },
    async logout() {},
    close() {},
  };
  const evidence = await findSentThreadEvidence({
    messageIds: [],
    since: new Date("2026-08-21T12:00:00.000Z"),
    referenceIds: ["<conversation@example.test>"],
    mailboxScope: "jane",
    env: {
      AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
      AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "not-a-secret",
    },
    createClient: () => client,
  });
  assert.deepEqual(evidence, { messageIds: [], humanReplyAt: null });
});

test("Sent reconciliation fails closed without a thread reference anchor", async () => {
  await assert.rejects(findSentThreadEvidence({
    messageIds: [],
    since: new Date("2026-08-21T12:00:00.000Z"),
    referenceIds: [],
    mailboxScope: "jane",
    env: {
      AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
      AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "not-a-secret",
    },
  }), /requires a message reference anchor/);
});

test("Sent reconciliation rejects a synthetic IMAP identity as a thread anchor", async () => {
  await assert.rejects(findSentThreadEvidence({
    messageIds: [],
    since: new Date("2026-08-21T12:00:00.000Z"),
    referenceIds: ["imap:42"],
    mailboxScope: "jane",
    env: {
      AIRBNB_SUPPORT_JANE_GMAIL_USER: "jane@example.test",
      AIRBNB_SUPPORT_JANE_GMAIL_APP_PASSWORD: "not-a-secret",
    },
  }), /requires a message reference anchor/);
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

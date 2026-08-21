import assert from "node:assert/strict";
import test from "node:test";
import { collectConversationMessages } from "./gmail.mjs";

test("canonical collector accepts only Tristan's express stream and closes IMAP", async () => {
  let released = false;
  let loggedOut = false;
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
    async *fetch() {
      yield { uid: 1, internalDate: new Date("2026-08-21T12:00:00Z"), envelope: { subject: "RE: Reservation for Jasmine Studio Stay, Aug 22 - 23", from: [{ address: "express@airbnb.com" }] } };
      yield { uid: 2, internalDate: new Date("2026-08-21T12:01:00Z"), envelope: { subject: "Reservation confirmed", from: [{ address: "automated@airbnb.com" }] } };
    },
    async fetchOne() { return { source }; },
    async logout() { loggedOut = true; },
    close() {},
  };
  const result = await collectConversationMessages({
    since: new Date("2026-08-01T00:00:00Z"),
    env: { AIRBNB_SUPPORT_GMAIL_USER: "tristan@example.test", AIRBNB_SUPPORT_GMAIL_APP_PASSWORD: "not-a-secret" },
    createClient: () => client,
  });
  assert.equal(result.envelopesFound, 1);
  assert.equal(result.messages[0].providerMessageId, "<conversation@example.test>");
  assert.equal(released, true);
  assert.equal(loggedOut, true);
});

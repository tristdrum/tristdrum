import assert from "node:assert/strict";
import test from "node:test";
import { readWhatsAppChatMessages, sendVerifiedManagementMessage } from "./whatsapp.mjs";

const env = {
  MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://min.example",
  MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "test-key",
  AIRBNB_WHATSAPP_ACCOUNT_ID: "account-1",
  AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us",
  AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us",
};

test("Management WhatsApp delivery dry-runs, sends idempotently, and verifies exact readback", async () => {
  const calls = [];
  const result = await sendVerifiedManagementMessage({
    text: "Airbnb alert",
    idempotencyKey: "stable-alert-key",
    env,
    waitFn: async () => {},
    fetchFn: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET", headers: options.headers ?? {} });
      if ((options.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ messages: [{ from_me: true, text: "Airbnb alert" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, dry_run: String(url).includes("dry_run=true") }), {
        status: 200,
        headers: { "x-min-mutates-whatsapp-state": String(!String(url).includes("dry_run=true")) },
      });
    },
  });
  assert.equal(result.verification.found, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers["Idempotency-Key"], undefined);
  assert.equal(calls[1].headers["Idempotency-Key"], "stable-alert-key");
});

test("Management alerts can never target the cleaners chat", async () => {
  await assert.rejects(
    sendVerifiedManagementMessage({
      text: "Airbnb alert",
      idempotencyKey: "stable-alert-key",
      env: { ...env, AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "cleaners@g.us" },
      fetchFn: async () => { throw new Error("must not fetch"); },
    }),
    /may not target the cleaners chat/,
  );
});

test("WhatsApp evidence reads return a bounded normalized message shape without writing", async () => {
  let request;
  const messages = await readWhatsAppChatMessages({
    chatId: "cleaners@g.us",
    limit: 500,
    env,
    fetchFn: async (url, options = {}) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({
        messages: [{
          id: "provider-1",
          chat_id: "cleaners@g.us",
          from_me: false,
          sender_name: "Cleaner",
          text: "Need more towels",
          timestamp: "2026-08-24T09:00:00+02:00",
          provider_private_field: "not returned",
        }],
      }), { status: 200 });
    },
  });
  assert.equal(request.options.method, undefined);
  assert.match(request.url, /limit=100/);
  assert.deepEqual(messages, [{
    providerMessageId: "provider-1",
    chatId: "cleaners@g.us",
    fromMe: false,
    senderName: "Cleaner",
    text: "Need more towels",
    transcript: "",
    preview: "",
    occurredAt: "2026-08-24T09:00:00+02:00",
  }]);
});

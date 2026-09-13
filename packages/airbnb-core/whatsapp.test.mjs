import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  readWhatsAppChatMessages,
  sendVerifiedManagementMessage,
  sendVerifiedWhatsAppGroupMessage,
} from "./whatsapp.mjs";

const env = {
  MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL: "https://min.example",
  MINCOOL_CUSTOMER_WHATSAPP_API_KEY: "test-key",
  AIRBNB_WHATSAPP_ACCOUNT_ID: "account-1",
  AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us",
  AIRBNB_WHATSAPP_CHAT_ID: "cleaners@g.us",
};

test("Management WhatsApp delivery dry-runs, sends idempotently, and verifies exact readback", async () => {
  const calls = [];
  let liveSent = false;
  const result = await sendVerifiedManagementMessage({
    text: "Airbnb alert",
    idempotencyKey: "stable-alert-key",
    env,
    waitFn: async () => {},
    fetchFn: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET", headers: options.headers ?? {} });
      if ((options.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          messages: liveSent ? [{ id: "new-alert", from_me: true, text: "Airbnb alert" }] : [],
        }), { status: 200 });
      }
      if (!String(url).includes("dry_run=true")) liveSent = true;
      return new Response(JSON.stringify({ ok: true, dry_run: String(url).includes("dry_run=true") }), {
        status: 200,
        headers: { "x-min-mutates-whatsapp-state": String(!String(url).includes("dry_run=true")) },
      });
    },
  });
  assert.equal(result.verification.found, true);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].headers["Idempotency-Key"], undefined);
  assert.equal(calls[2].headers["Idempotency-Key"], "stable-alert-key");
});

test("a historical identical Management message cannot verify a new send", async () => {
  await assert.rejects(
    sendVerifiedManagementMessage({
      text: "Repeated alert",
      idempotencyKey: "new-alert-key",
      env: { ...env, AIRBNB_WHATSAPP_READBACK_ATTEMPTS: "1" },
      waitFn: async () => {},
      fetchFn: async (url, options = {}) => {
        if ((options.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({
            messages: [{ id: "historical-alert", from_me: true, text: "Repeated alert" }],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    }),
    /was not found in readback/,
  );
});

test("a newly appearing identical Management message verifies the send", async () => {
  let liveSent = false;
  const result = await sendVerifiedManagementMessage({
    text: "Repeated alert",
    idempotencyKey: "new-alert-key",
    env,
    waitFn: async () => {},
    fetchFn: async (url, options = {}) => {
      if ((options.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          messages: [
            { id: "historical-alert", from_me: true, text: "Repeated alert" },
            ...(liveSent ? [{ id: "new-alert", from_me: true, text: "Repeated alert" }] : []),
          ],
        }), { status: 200 });
      }
      if (!String(url).includes("dry_run=true")) liveSent = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.equal(result.verification.found, true);
});

test("a provider message ID requires exact Management readback", async () => {
  await assert.rejects(
    sendVerifiedManagementMessage({
      text: "Airbnb alert",
      idempotencyKey: "provider-id-alert-key",
      env: { ...env, AIRBNB_WHATSAPP_READBACK_ATTEMPTS: "1" },
      waitFn: async () => {},
      fetchFn: async (url, options = {}) => {
        if ((options.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({
            messages: [{ id: "different-new-alert", from_me: true, text: "Airbnb alert" }],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          ok: true,
          message_id: String(url).includes("dry_run=true") ? null : "expected-alert",
        }), { status: 200 });
      },
    }),
    /was not found in readback/,
  );
});

test("Management alerts can never target the cleaning team chat", async () => {
  await assert.rejects(
    sendVerifiedManagementMessage({
      text: "Airbnb alert",
      idempotencyKey: "stable-alert-key",
      env: { ...env, AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "cleaners@g.us" },
      fetchFn: async () => { throw new Error("must not fetch"); },
    }),
    /may not target the cleaning team chat/,
  );
});

test("the generic verified sender can safely target the cleaning team group", async () => {
  let liveSent = false;
  const result = await sendVerifiedWhatsAppGroupMessage({
    chatId: "cleaners@g.us",
    text: "Unit 2: early check-in requested for 13:00.",
    idempotencyKey: "time-request-1",
    env,
    waitFn: async () => {},
    fetchFn: async (url, options = {}) => {
      if ((options.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          messages: liveSent
            ? [{ id: "cleaner-note-1", from_me: true, text: "Unit 2: early check-in requested for 13:00." }]
            : [],
        }), { status: 200 });
      }
      if (!String(url).includes("dry_run=true")) liveSent = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.equal(result.verification.found, true);
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

test("Min Unix-second timestamps normalize while ISO timestamps remain compatible", async () => {
  const instant = "2026-09-13T10:41:00.000Z";
  const seconds = Date.parse(instant) / 1000;
  const timestamps = [seconds, String(seconds), instant, null, "", "not-a-date"];
  const messages = await readWhatsAppChatMessages({
    chatId: "cleaners@g.us", env,
    fetchFn: async () => new Response(JSON.stringify({
      messages: timestamps.map((timestamp, index) => ({ id: `message-${index}`, timestamp })),
    })),
  });
  assert.deepEqual(messages.map((message) => message.occurredAt), [instant, instant, instant, "", "", ""]);
});

test("the evidence-read deadline is independent of unchanged write and readback deadlines", async (t) => {
  const deadlines = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });
  const configured = { ...env, AIRBNB_WHATSAPP_TIMEOUT_MS: "8000", AIRBNB_WHATSAPP_EVIDENCE_READ_TIMEOUT_MS: "30000" };
  await readWhatsAppChatMessages({ chatId: "cleaners@g.us", env: configured,
    fetchFn: async () => new Response('{"messages":[]}') });
  let sent = false;
  await sendVerifiedManagementMessage({ text: "Scoped timeout test", idempotencyKey: "timeout-test", env: configured,
    fetchFn: async (url, options) => {
      if (options.method === "POST") {
        if (!String(url).includes("dry_run=true")) sent = true;
        return new Response('{"ok":true}');
      }
      const messages = sent ? [{ id: "receipt", from_me: true, text: "Scoped timeout test" }] : [];
      return new Response(JSON.stringify({ messages }));
    },
  });
  assert.deepEqual(deadlines, [30000, 8000, 8000, 8000, 8000]);
  for (const value of [undefined, "0", "invalid"]) {
    await readWhatsAppChatMessages({ chatId: "cleaners@g.us",
      env: { ...env, AIRBNB_WHATSAPP_TIMEOUT_MS: "8000", AIRBNB_WHATSAPP_EVIDENCE_READ_TIMEOUT_MS: value },
      fetchFn: async () => new Response('{"messages":[]}') });
    assert.equal(deadlines.at(-1), 8000);
  }
});

test("an evidence timeout fails closed with a credential-free phase identity and no retry", async () => {
  let calls = 0;
  await assert.rejects(readWhatsAppChatMessages({
    chatId: "cleaners@g.us", env: { ...env, AIRBNB_WHATSAPP_EVIDENCE_READ_TIMEOUT_MS: "5" },
    fetchFn: async (_url, options) => {
      calls += 1;
      await delay(100, undefined, { signal: options.signal });
      return new Response('{"messages":[]}');
    },
  }), { code: "WHATSAPP_EVIDENCE_READ_TIMEOUT", message: "WhatsApp evidence read exceeded its deadline." });
  assert.equal(calls, 1);
});

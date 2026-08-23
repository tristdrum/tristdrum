import assert from "node:assert/strict";
import test from "node:test";

import { collectStockWhatsAppObservations } from "./whatsapp.mjs";

test("stock WhatsApp collection is read-only, ignores our messages, and keeps no raw body", async () => {
  const chats = [];
  const result = await collectStockWhatsAppObservations({
    env: {
      AIRBNB_WHATSAPP_CHAT_ID: "maids@g.us",
      AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID: "management@g.us",
    },
    readChatMessages: async ({ chatId }) => {
      chats.push(chatId);
      return [{
        providerMessageId: `${chatId}:1`,
        fromMe: false,
        senderName: "Fixture person",
        text: "We need more towels and guest soap",
        transcript: "",
        preview: "",
        occurredAt: "2026-08-24T09:00:00+02:00",
      }, {
        providerMessageId: `${chatId}:2`,
        fromMe: true,
        senderName: "Automation",
        text: "Need more chocolates",
        occurredAt: "2026-08-24T09:01:00+02:00",
      }];
    },
  });
  assert.deepEqual(chats, ["maids@g.us", "management@g.us"]);
  assert.equal(result.messagesFound, 4);
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.observations[0].matchedSkus, ["hand_soap", "towel_set"]);
  assert.equal("text" in result.observations[0], false);
  assert.match(result.observations[0].contentHash, /^[a-f0-9]{64}$/);
});

test("stock WhatsApp collection is optional when no groups are configured", async () => {
  assert.deepEqual(await collectStockWhatsAppObservations({ env: {} }), {
    status: "disabled",
    messagesFound: 0,
    observations: [],
  });
});

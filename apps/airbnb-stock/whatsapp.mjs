import {
  contentFingerprint,
  readWhatsAppChatMessages,
  stockObservationSkus,
} from "@tristdrum/airbnb-core";

function messageBody(message) {
  return String(message.text || message.transcript || message.preview || "")
    .replace(/\s+/g, " ")
    .trim();
}

function observation(message, chatScope) {
  if (message.fromMe) return null;
  const body = messageBody(message);
  const matchedSkus = stockObservationSkus(body);
  const occurredAt = new Date(message.occurredAt);
  if (!body || !matchedSkus.length || Number.isNaN(occurredAt.getTime())) return null;
  return {
    providerMessageId: message.providerMessageId,
    chatScope,
    senderName: message.senderName,
    occurredAt: occurredAt.toISOString(),
    contentHash: contentFingerprint(body),
    matchedSkus,
  };
}

export async function collectStockWhatsAppObservations({
  env = process.env,
  readChatMessages = readWhatsAppChatMessages,
} = {}) {
  const chats = [
    ["maids", String(env.AIRBNB_WHATSAPP_CHAT_ID ?? "").trim()],
    ["management", String(env.AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID ?? "").trim()],
  ].filter(([, chatId], index, entries) => (
    chatId && entries.findIndex(([, candidate]) => candidate === chatId) === index
  ));
  if (!chats.length) return { status: "disabled", messagesFound: 0, observations: [] };

  const observations = [];
  let messagesFound = 0;
  for (const [chatScope, chatId] of chats) {
    const messages = await readChatMessages({ chatId, limit: 100, env });
    messagesFound += messages.length;
    for (const message of messages) {
      const parsed = observation(message, chatScope);
      if (parsed) observations.push(parsed);
    }
  }
  return { status: "loaded", messagesFound, observations };
}

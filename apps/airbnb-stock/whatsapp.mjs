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

export function stockWhatsAppGroupConfiguration(env = process.env) {
  const maidsChatId = String(env.AIRBNB_WHATSAPP_CHAT_ID ?? "").trim();
  const managementChatId = String(env.AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID ?? "").trim();
  const configured = Boolean(
    maidsChatId
    && managementChatId
    && maidsChatId !== managementChatId
  );
  return {
    configured,
    chats: configured
      ? [["maids", maidsChatId], ["management", managementChatId]]
      : [],
  };
}

export async function collectStockWhatsAppObservations({
  env = process.env,
  readChatMessages = readWhatsAppChatMessages,
} = {}) {
  const groupConfiguration = stockWhatsAppGroupConfiguration(env);
  if (!groupConfiguration.configured) {
    throw Object.assign(new Error("Both distinct Airbnb WhatsApp group IDs are required."), {
      code: "AIRBNB_STOCK_WHATSAPP_GROUPS_REQUIRED",
    });
  }

  const observations = [];
  let messagesFound = 0;
  for (const [chatScope, chatId] of groupConfiguration.chats) {
    const messages = await readChatMessages({ chatId, limit: 100, env });
    messagesFound += messages.length;
    for (const message of messages) {
      const parsed = observation(message, chatScope);
      if (parsed) observations.push(parsed);
    }
  }
  return { status: "loaded", messagesFound, observations };
}

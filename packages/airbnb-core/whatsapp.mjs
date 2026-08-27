const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_READBACK_ATTEMPTS = 3;

function required(name, env) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function providerMessageId(message) {
  return String(
    message?.message_id
      ?? message?.messageId
      ?? message?.id
      ?? message?.message?.message_id
      ?? message?.message?.id
      ?? "",
  ).trim();
}

function messageIdentity(message) {
  const id = providerMessageId(message);
  if (id) return `id:${id}`;
  return [
    "fallback",
    String(message?.timestamp ?? message?.occurred_at ?? "").trim(),
    message?.from_me === true ? "out" : "in",
    normalizedText(message?.text),
  ].join(":");
}

function configuration(env, chatId) {
  const normalizedChatId = String(chatId ?? "").trim();
  if (!normalizedChatId.endsWith("@g.us")) throw new Error("Airbnb WhatsApp destination must be a group.");
  return {
    baseUrl: required("MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL", env),
    apiKey: required("MINCOOL_CUSTOMER_WHATSAPP_API_KEY", env),
    accountId: required("AIRBNB_WHATSAPP_ACCOUNT_ID", env),
    chatId: normalizedChatId,
  };
}

async function sendText({ chatId, text, idempotencyKey, dryRun, env, fetchFn }) {
  const { baseUrl, apiKey, accountId, chatId: destination } = configuration(env, chatId);
  const url = new URL(
    `/api/v1/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(destination)}/messages`,
    baseUrl,
  );
  if (dryRun) url.searchParams.set("dry_run", "true");
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Min-API-Key": apiKey,
      ...(dryRun ? {} : { "Idempotency-Key": idempotencyKey }),
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(positiveInteger(env.AIRBNB_WHATSAPP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(`WhatsApp ${dryRun ? "dry-run" : "send"} failed with HTTP ${response.status}.`);
  return {
    status: response.status,
    dryRun,
    mutatesWhatsappState: response.headers.get("x-min-mutates-whatsapp-state"),
    ok: body?.ok ?? true,
    providerMessageId: providerMessageId(body) || null,
  };
}

async function readMessages({ chatId, env, fetchFn }) {
  const { baseUrl, apiKey, accountId, chatId: destination } = configuration(env, chatId);
  const url = new URL(
    `/api/v1/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(destination)}/messages?limit=30`,
    baseUrl,
  );
  const response = await fetchFn(url, {
    headers: { "X-Min-API-Key": apiKey },
    signal: AbortSignal.timeout(positiveInteger(env.AIRBNB_WHATSAPP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(`WhatsApp readback failed with HTTP ${response.status}.`);
  return Array.isArray(body?.messages) ? body.messages : [];
}

export async function readWhatsAppChatMessages({
  chatId,
  limit = 100,
  env = process.env,
  fetchFn = fetch,
}) {
  const normalizedChatId = String(chatId ?? "").trim();
  if (!normalizedChatId.endsWith("@g.us")) throw new Error("WhatsApp stock evidence must come from a group.");
  const baseUrl = required("MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL", env);
  const apiKey = required("MINCOOL_CUSTOMER_WHATSAPP_API_KEY", env);
  const accountId = required("AIRBNB_WHATSAPP_ACCOUNT_ID", env);
  const boundedLimit = Math.min(100, positiveInteger(limit, 100));
  const url = new URL(
    `/api/v1/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(normalizedChatId)}/messages`,
    baseUrl,
  );
  url.searchParams.set("limit", String(boundedLimit));
  const response = await fetchFn(url, {
    headers: { "X-Min-API-Key": apiKey },
    signal: AbortSignal.timeout(positiveInteger(env.AIRBNB_WHATSAPP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
  });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(`WhatsApp evidence read failed with HTTP ${response.status}.`);
  return (Array.isArray(body?.messages) ? body.messages : []).map((message) => ({
    providerMessageId: String(message.message_id ?? message.id ?? "").trim(),
    chatId: String(message.chat_id ?? normalizedChatId).trim(),
    fromMe: message.from_me === true,
    senderName: String(message.sender_name ?? "").trim() || null,
    text: String(message.text ?? "").trim(),
    transcript: String(message.transcript ?? "").trim(),
    preview: String(message.preview ?? "").trim(),
    occurredAt: String(message.timestamp ?? "").trim(),
  })).filter((message) => message.providerMessageId);
}

export async function sendVerifiedManagementMessage({
  text,
  idempotencyKey,
  env = process.env,
  fetchFn = fetch,
  waitFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const chatId = required("AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID", env);
  const cleanersChatId = String(env.AIRBNB_WHATSAPP_CHAT_ID ?? "").trim();
  if (cleanersChatId && cleanersChatId === chatId) {
    throw new Error("Airbnb Management alerts may not target the cleaning team chat.");
  }
  return sendVerifiedWhatsAppGroupMessage({
    chatId,
    text,
    idempotencyKey,
    env,
    fetchFn,
    waitFn,
  });
}

export async function sendVerifiedWhatsAppGroupMessage({
  chatId,
  text,
  idempotencyKey,
  env = process.env,
  fetchFn = fetch,
  waitFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const message = String(text ?? "").trim();
  if (!message) throw new Error("WhatsApp group message text is empty.");
  if (!String(idempotencyKey ?? "").trim()) throw new Error("WhatsApp group message idempotency key is empty.");
  const destination = String(chatId ?? "").trim();
  const dryRun = await sendText({ chatId: destination, text: message, idempotencyKey, dryRun: true, env, fetchFn });
  const messagesBefore = await readMessages({ chatId: destination, env, fetchFn });
  const identitiesBefore = new Set(messagesBefore.map(messageIdentity));
  const live = await sendText({ chatId: destination, text: message, idempotencyKey, dryRun: false, env, fetchFn });
  const expected = normalizedText(message);
  const attempts = positiveInteger(env.AIRBNB_WHATSAPP_READBACK_ATTEMPTS, DEFAULT_READBACK_ATTEMPTS);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const messages = await readMessages({ chatId: destination, env, fetchFn });
    const found = messages.some((candidate) => {
      if (candidate.from_me !== true || normalizedText(candidate.text) !== expected) return false;
      const candidateId = providerMessageId(candidate);
      return live.providerMessageId
        ? candidateId === live.providerMessageId
        : !identitiesBefore.has(messageIdentity(candidate));
    });
    if (found) {
      return {
        dryRun,
        live,
        verification: { found: true, attempts: attempt },
      };
    }
    if (attempt < attempts) await waitFn(500 * attempt);
  }
  throw new Error("WhatsApp group message was not found in readback.");
}

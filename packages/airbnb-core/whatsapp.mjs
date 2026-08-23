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

function configuration(env) {
  const chatId = required("AIRBNB_MANAGEMENT_WHATSAPP_CHAT_ID", env);
  if (!chatId.endsWith("@g.us")) throw new Error("Airbnb Management WhatsApp destination must be a group.");
  const cleanersChatId = String(env.AIRBNB_WHATSAPP_CHAT_ID ?? "").trim();
  if (cleanersChatId && cleanersChatId === chatId) {
    throw new Error("Airbnb Management alerts may not target the cleaners chat.");
  }
  return {
    baseUrl: required("MINCOOL_CUSTOMER_WHATSAPP_API_BASE_URL", env),
    apiKey: required("MINCOOL_CUSTOMER_WHATSAPP_API_KEY", env),
    accountId: required("AIRBNB_WHATSAPP_ACCOUNT_ID", env),
    chatId,
  };
}

async function sendText({ text, idempotencyKey, dryRun, env, fetchFn }) {
  const { baseUrl, apiKey, accountId, chatId } = configuration(env);
  const url = new URL(
    `/api/v1/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatId)}/messages`,
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
  };
}

async function readMessages({ env, fetchFn }) {
  const { baseUrl, apiKey, accountId, chatId } = configuration(env);
  const url = new URL(
    `/api/v1/whatsapp/accounts/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatId)}/messages?limit=30`,
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

export async function sendVerifiedManagementMessage({
  text,
  idempotencyKey,
  env = process.env,
  fetchFn = fetch,
  waitFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const message = String(text ?? "").trim();
  if (!message) throw new Error("Management alert text is empty.");
  if (!String(idempotencyKey ?? "").trim()) throw new Error("Management alert idempotency key is empty.");
  const dryRun = await sendText({ text: message, idempotencyKey, dryRun: true, env, fetchFn });
  const live = await sendText({ text: message, idempotencyKey, dryRun: false, env, fetchFn });
  const expected = normalizedText(message);
  const attempts = positiveInteger(env.AIRBNB_WHATSAPP_READBACK_ATTEMPTS, DEFAULT_READBACK_ATTEMPTS);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const messages = await readMessages({ env, fetchFn });
    const found = messages.some((candidate) => candidate.from_me === true
      && normalizedText(candidate.text) === expected);
    if (found) {
      return {
        dryRun,
        live,
        verification: { found: true, attempts: attempt },
      };
    }
    if (attempt < attempts) await waitFn(500 * attempt);
  }
  throw new Error("WhatsApp Management alert was not found in readback.");
}

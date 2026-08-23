import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";

const DEFAULT_FOLDER = "[Gmail]/All Mail";
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;
const DEFAULT_SOCKET_TIMEOUT_MS = 60_000;
const DEFAULT_IMPORT_DEADLINE_MS = 60_000;

function required(name, env) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function readableBody(parsed) {
  if (parsed.text?.trim()) return parsed.text;
  if (typeof parsed.html === "string" && parsed.html.trim()) {
    return htmlToText(parsed.html, {
      wordwrap: false,
      selectors: [{ selector: "img", format: "skip" }],
    });
  }
  return "";
}

function addressList(value) {
  return value?.value?.map((address) => address.address).filter(Boolean) ?? [];
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function importDeadlineError(milliseconds) {
  return Object.assign(
    new Error(`Airbnb support Gmail import exceeded ${milliseconds}ms.`),
    { code: "IMAP_IMPORT_DEADLINE" },
  );
}

export async function collectConversationMessages({
  since,
  maxRead = 500,
  env = process.env,
  createClient = (options) => new ImapFlow(options),
}) {
  const client = createClient({
    host: String(env.AIRBNB_SUPPORT_GMAIL_IMAP_HOST ?? "imap.gmail.com"),
    port: Number.parseInt(env.AIRBNB_SUPPORT_GMAIL_IMAP_PORT ?? "993", 10),
    secure: true,
    auth: {
      user: required("AIRBNB_SUPPORT_GMAIL_USER", env),
      pass: required("AIRBNB_SUPPORT_GMAIL_APP_PASSWORD", env),
    },
    connectionTimeout: positiveInteger(
      env.AIRBNB_SUPPORT_GMAIL_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    socketTimeout: positiveInteger(
      env.AIRBNB_SUPPORT_GMAIL_SOCKET_TIMEOUT_MS,
      DEFAULT_SOCKET_TIMEOUT_MS,
    ),
    logger: false,
  });
  let lock;
  let deadlineTimer;
  try {
    const deadlineMs = positiveInteger(
      env.AIRBNB_SUPPORT_GMAIL_IMPORT_DEADLINE_MS,
      DEFAULT_IMPORT_DEADLINE_MS,
    );
    const importWork = (async () => {
      await client.connect();
      lock = await client.getMailboxLock(String(env.AIRBNB_SUPPORT_GMAIL_FOLDER ?? DEFAULT_FOLDER));
      const uids = await client.search({ since, from: "express@airbnb.com" }, { uid: true });
      if (!uids.length) return { messages: [], envelopesFound: 0 };
      const candidates = [];
      for await (const message of client.fetch(uids, { envelope: true, internalDate: true, uid: true }, { uid: true })) {
        const sender = String(message.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const subject = message.envelope?.subject ?? "";
        if (sender !== "express@airbnb.com" || !/^RE:\s*Reservation for /i.test(subject)) continue;
        candidates.push({ uid: Number(message.uid), occurredAt: message.internalDate?.toISOString?.() ?? null, from: sender, subject });
      }
      const selected = candidates
        .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
        .slice(-maxRead);
      if (!selected.length) return { messages: [], envelopesFound: 0 };
      const selectedByUid = new Map(selected.map((envelope) => [envelope.uid, envelope]));
      const parsedByUid = new Map();
      for await (const message of client.fetch(
        selected.map((envelope) => envelope.uid),
        { source: true, uid: true },
        { uid: true },
      )) {
        const envelope = selectedByUid.get(Number(message.uid));
        if (!envelope || !message.source) continue;
        const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true });
        parsedByUid.set(envelope.uid, {
          ...envelope,
          providerMessageId: parsed.messageId ?? `imap:${envelope.uid}`,
          replyTo: addressList(parsed.replyTo)[0] ?? null,
          references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
          inReplyTo: parsed.inReplyTo ?? null,
          body: readableBody(parsed),
        });
      }
      return {
        messages: selected.map((envelope) => parsedByUid.get(envelope.uid)).filter(Boolean),
        envelopesFound: selected.length,
      };
    })();
    const deadline = new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => {
        client.close();
        reject(importDeadlineError(deadlineMs));
      }, deadlineMs);
    });
    return await Promise.race([importWork, deadline]);
  } finally {
    clearTimeout(deadlineTimer);
    lock?.release();
    if (client.usable) await client.logout();
    else client.close();
  }
}

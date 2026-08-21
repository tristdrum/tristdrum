import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";

const DEFAULT_FOLDER = "[Gmail]/All Mail";

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
    logger: false,
  });
  await client.connect();
  let lock;
  try {
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
    const messages = [];
    for (const envelope of selected) {
      const message = await client.fetchOne(envelope.uid, { source: true }, { uid: true });
      if (!message?.source) continue;
      const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true });
      messages.push({
        ...envelope,
        providerMessageId: parsed.messageId ?? `imap:${envelope.uid}`,
        replyTo: addressList(parsed.replyTo)[0] ?? null,
        references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
        inReplyTo: parsed.inReplyTo ?? null,
        body: readableBody(parsed),
      });
    }
    return { messages, envelopesFound: selected.length };
  } finally {
    lock?.release();
    if (client.usable) await client.logout();
    else client.close();
  }
}

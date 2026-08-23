import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";
import { trustedSixty60Sender } from "@tristdrum/airbnb-core";

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

function candidateSubject(subject) {
  return /Sixty60 invoice for order|received your order|order is confirmed/i.test(String(subject ?? ""));
}

export async function collectSixty60Messages({
  since,
  maxRead = 400,
  knownProviderMessageIds = [],
  env = process.env,
  createClient = (options) => new ImapFlow(options),
}) {
  const client = createClient({
    host: String(env.JANE_GMAIL_IMAP_HOST ?? "imap.gmail.com"),
    port: Number.parseInt(env.JANE_GMAIL_IMAP_PORT ?? "993", 10),
    secure: true,
    auth: {
      user: required("JANE_GMAIL_USER", env),
      pass: required("JANE_GMAIL_APP_PASSWORD", env),
    },
    logger: false,
  });
  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock(String(env.JANE_GMAIL_FOLDER ?? DEFAULT_FOLDER));
    const uids = await client.search({ since, from: "checkers.sixty60.co.za" }, { uid: true });
    if (!uids.length) return { messages: [], envelopesFound: 0 };
    const candidates = [];
    for await (const message of client.fetch(uids, { envelope: true, internalDate: true, uid: true }, { uid: true })) {
      const sender = message.envelope?.from?.[0]?.address ?? "";
      const subject = message.envelope?.subject ?? "";
      if (!trustedSixty60Sender(sender) || !candidateSubject(subject)) continue;
      candidates.push({
        uid: Number(message.uid),
        occurredAt: message.internalDate?.toISOString?.() ?? null,
        from: sender,
        subject,
        providerMessageId: String(message.envelope?.messageId ?? "").trim() || `imap:${message.uid}`,
      });
    }
    const selected = candidates
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
      .slice(-maxRead);
    const knownIds = new Set(
      [...knownProviderMessageIds]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    );
    const unseen = selected.filter((envelope) => !knownIds.has(envelope.providerMessageId));
    const messages = [];
    for (const envelope of unseen) {
      const message = await client.fetchOne(envelope.uid, { source: true }, { uid: true });
      if (!message?.source) continue;
      const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true });
      messages.push({
        ...envelope,
        providerMessageId: parsed.messageId ?? envelope.providerMessageId,
        body: readableBody(parsed),
      });
    }
    return {
      messages,
      envelopesFound: selected.length,
      envelopesSkippedKnown: selected.length - unseen.length,
    };
  } finally {
    lock?.release();
    if (client.usable) await client.logout();
    else client.close();
  }
}

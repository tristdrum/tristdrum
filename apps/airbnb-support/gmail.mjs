import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";
import nodemailer from "nodemailer";
import {
  isAirbnbBookingLifecycleSubject,
  isAirbnbConversationSubject,
  isAirbnbInitialInquirySubject,
  trustedAirbnbSender,
} from "@tristdrum/airbnb-core";

const DEFAULT_FOLDER = "[Gmail]/All Mail";
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;
const DEFAULT_SOCKET_TIMEOUT_MS = 30_000;
const DEFAULT_IMPORT_DEADLINE_MS = 30_000;
const DEFAULT_GUARD_DEADLINE_MS = 20_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 1_000;
const DEFAULT_SENT_FOLDER = "[Gmail]/Sent Mail";

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

function observeClientErrors(client) {
  if (typeof client.on !== "function") {
    return new Promise(() => {});
  }
  let rejectError;
  const error = new Promise((_, reject) => { rejectError = reject; });
  const listener = (value) => {
    rejectError(value instanceof Error ? value : new Error("Airbnb support IMAP client failed."));
  };
  client.on("error", listener);
  return error;
}

function closeClientNoThrow(client) {
  try {
    const closing = client.close();
    closing?.catch?.(() => {});
  } catch {
    // ImapFlow can already be disconnected when a deadline closes the socket.
  }
}

async function finishClient(client, timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS) {
  if (!client.usable) {
    closeClientNoThrow(client);
    return;
  }
  let timer;
  const logout = Promise.resolve()
    .then(() => client.logout())
    .catch(() => closeClientNoThrow(client));
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      closeClientNoThrow(client);
      resolve();
    }, timeoutMs);
  });
  await Promise.race([logout, deadline]);
  clearTimeout(timer);
}

async function withClientDeadline(client, work, timeoutMs, errorFactory, clientError) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      closeClientNoThrow(client);
      reject(errorFactory(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, deadline, clientError]);
  } finally {
    clearTimeout(timer);
  }
}

function rfcMessageId(value) {
  const normalized = String(value ?? "").trim();
  return /^<[^<>\s]+@[^<>\s]+>$/.test(normalized) ? normalized : null;
}

function importDeadlineError(milliseconds) {
  return Object.assign(
    new Error(`Airbnb support Gmail import exceeded ${milliseconds}ms.`),
    { code: "IMAP_IMPORT_DEADLINE" },
  );
}

function guardDeadlineError(milliseconds) {
  return Object.assign(
    new Error(`Airbnb support Sent-mail guard exceeded ${milliseconds}ms.`),
    { code: "IMAP_GUARD_DEADLINE" },
  );
}

function mailboxPrefix(mailboxScope) {
  if (mailboxScope === "tristan") return "AIRBNB_SUPPORT_GMAIL";
  if (mailboxScope === "jane") return "AIRBNB_SUPPORT_JANE_GMAIL";
  throw new Error(`Unsupported Airbnb support mailbox scope: ${mailboxScope}`);
}

function mailboxValue(mailboxScope, suffix, env, fallback = null) {
  const scoped = String(env[`${mailboxPrefix(mailboxScope)}_${suffix}`] ?? "").trim();
  if (scoped) return scoped;
  if (fallback != null) return fallback;
  throw new Error(`Missing required environment variable ${mailboxPrefix(mailboxScope)}_${suffix}.`);
}

function imapOptions(mailboxScope, env) {
  return {
    host: mailboxValue(mailboxScope, "IMAP_HOST", env, String(env.AIRBNB_SUPPORT_GMAIL_IMAP_HOST ?? "imap.gmail.com")),
    port: Number.parseInt(mailboxValue(mailboxScope, "IMAP_PORT", env, String(env.AIRBNB_SUPPORT_GMAIL_IMAP_PORT ?? "993")), 10),
    secure: true,
    auth: {
      user: mailboxValue(mailboxScope, "USER", env),
      pass: mailboxValue(mailboxScope, "APP_PASSWORD", env),
    },
    connectionTimeout: positiveInteger(
      env[`${mailboxPrefix(mailboxScope)}_CONNECTION_TIMEOUT_MS`] ?? env.AIRBNB_SUPPORT_GMAIL_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    socketTimeout: positiveInteger(
      env[`${mailboxPrefix(mailboxScope)}_SOCKET_TIMEOUT_MS`] ?? env.AIRBNB_SUPPORT_GMAIL_SOCKET_TIMEOUT_MS,
      DEFAULT_SOCKET_TIMEOUT_MS,
    ),
    logger: false,
  };
}

export async function collectConversationMessages({
  since,
  maxRead = 500,
  afterUid = 0,
  oldestFirst = false,
  mailboxScope = "tristan",
  env = process.env,
  createClient = (options) => new ImapFlow(options),
}) {
  const client = createClient(imapOptions(mailboxScope, env));
  const clientError = observeClientErrors(client);
  let lock;
  try {
    const deadlineMs = positiveInteger(
      env.AIRBNB_SUPPORT_GMAIL_IMPORT_DEADLINE_MS,
      DEFAULT_IMPORT_DEADLINE_MS,
    );
    const importWork = (async () => {
      await client.connect();
      lock = await client.getMailboxLock(mailboxValue(
        mailboxScope,
        "FOLDER",
        env,
        String(env.AIRBNB_SUPPORT_GMAIL_FOLDER ?? DEFAULT_FOLDER),
      ));
      const senderQueries = mailboxScope === "tristan"
        ? [
          { since, from: "express@airbnb.com" },
          { since, from: "automated@airbnb.com", subject: "Inquiry for" },
        ]
        : [{ since, from: "airbnb.com" }];
      const uidSet = new Set();
      for (const senderQuery of senderQueries) {
        const matches = await client.search(senderQuery, { uid: true });
        for (const uid of matches ?? []) uidSet.add(Number(uid));
      }
      const uids = [...uidSet].sort((left, right) => left - right);
      if (!uids.length) return { messages: [], envelopesFound: 0, lastUid: Number(afterUid) };
      const candidates = [];
      for await (const message of client.fetch(uids, { envelope: true, internalDate: true, uid: true }, { uid: true })) {
        const sender = String(message.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const subject = message.envelope?.subject ?? "";
        const isReplyConversation = isAirbnbConversationSubject(subject);
        const isInitialInquiry = mailboxScope === "tristan"
          && sender === "automated@airbnb.com"
          && isAirbnbInitialInquirySubject(subject);
        if (!trustedAirbnbSender(sender) || (!isReplyConversation && !isInitialInquiry)) continue;
        if (mailboxScope === "tristan" && sender !== "express@airbnb.com" && !isInitialInquiry) continue;
        if (Number(message.uid) <= Number(afterUid)) continue;
        candidates.push({ uid: Number(message.uid), occurredAt: message.internalDate?.toISOString?.() ?? null, from: sender, subject });
      }
      const ordered = candidates.sort((a, b) => a.uid - b.uid);
      const selected = oldestFirst ? ordered.slice(0, maxRead) : ordered.slice(-maxRead);
      if (!selected.length) return { messages: [], envelopesFound: 0, lastUid: Number(afterUid) };
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
        const replyMessageId = rfcMessageId(parsed.messageId);
        parsedByUid.set(envelope.uid, {
          ...envelope,
          mailboxScope,
          providerMessageId: replyMessageId ?? `imap:${envelope.uid}`,
          rfcMessageId: replyMessageId,
          replyTo: addressList(parsed.replyTo)[0] ?? null,
          references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
          inReplyTo: parsed.inReplyTo ?? null,
          body: readableBody(parsed),
        });
      }
      return {
        messages: selected.map((envelope) => parsedByUid.get(envelope.uid)).filter(Boolean),
        envelopesFound: selected.length,
        lastUid: selected.at(-1)?.uid ?? Number(afterUid),
      };
    })();
    return await withClientDeadline(client, importWork, deadlineMs, importDeadlineError, clientError);
  } finally {
    lock?.release();
    await finishClient(
      client,
      positiveInteger(env.AIRBNB_SUPPORT_GMAIL_CLEANUP_TIMEOUT_MS, DEFAULT_CLEANUP_TIMEOUT_MS),
    );
  }
}

export async function collectBookingLifecycleMessages({
  since,
  maxRead = 100,
  env = process.env,
  createClient = (options) => new ImapFlow(options),
}) {
  const client = createClient(imapOptions("tristan", env));
  const clientError = observeClientErrors(client);
  let lock;
  try {
    const deadlineMs = positiveInteger(env.AIRBNB_SUPPORT_GMAIL_IMPORT_DEADLINE_MS, DEFAULT_IMPORT_DEADLINE_MS);
    const importWork = (async () => {
      await client.connect();
      lock = await client.getMailboxLock(mailboxValue(
        "tristan",
        "FOLDER",
        env,
        String(env.AIRBNB_SUPPORT_GMAIL_FOLDER ?? DEFAULT_FOLDER),
      ));
      const uids = await client.search({
        since,
        from: "automated@airbnb.com",
        subject: "request",
      }, { uid: true });
      if (!uids.length) return { messages: [], envelopesFound: 0 };
      const candidates = [];
      for await (const message of client.fetch(uids, { envelope: true, internalDate: true, uid: true }, { uid: true })) {
        const sender = String(message.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const subject = message.envelope?.subject ?? "";
        if (sender !== "automated@airbnb.com" || !isAirbnbBookingLifecycleSubject(subject)) continue;
        candidates.push({
          uid: Number(message.uid),
          occurredAt: message.internalDate?.toISOString?.() ?? null,
          from: sender,
          subject,
        });
      }
      const selected = candidates.sort((left, right) => left.uid - right.uid).slice(-maxRead);
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
          mailboxScope: "tristan",
          providerMessageId: rfcMessageId(parsed.messageId) ?? `imap:${envelope.uid}`,
          body: readableBody(parsed),
        });
      }
      return {
        messages: selected.map((envelope) => parsedByUid.get(envelope.uid)).filter(Boolean),
        envelopesFound: selected.length,
      };
    })();
    return await withClientDeadline(client, importWork, deadlineMs, importDeadlineError, clientError);
  } finally {
    lock?.release();
    await finishClient(
      client,
      positiveInteger(env.AIRBNB_SUPPORT_GMAIL_CLEANUP_TIMEOUT_MS, DEFAULT_CLEANUP_TIMEOUT_MS),
    );
  }
}

export async function findSentMessageIds({
  messageIds,
  env = process.env,
  createClient = (options) => new ImapFlow(options),
}) {
  const wanted = [...new Set((messageIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const client = createClient(imapOptions("tristan", env));
  const clientError = observeClientErrors(client);
  let lock;
  try {
    const guardWork = (async () => {
      await client.connect();
      lock = await client.getMailboxLock(String(env.AIRBNB_SUPPORT_GMAIL_SENT_FOLDER ?? DEFAULT_SENT_FOLDER));
      const found = [];
      for (const messageId of wanted) {
        const matches = await client.search({ header: { "message-id": messageId } }, { uid: true });
        if (matches?.length) found.push(messageId);
      }
      return found;
    })();
    return await withClientDeadline(
      client,
      guardWork,
      positiveInteger(env.AIRBNB_SUPPORT_GMAIL_GUARD_DEADLINE_MS, DEFAULT_GUARD_DEADLINE_MS),
      guardDeadlineError,
      clientError,
    );
  } finally {
    lock?.release();
    await finishClient(
      client,
      positiveInteger(env.AIRBNB_SUPPORT_GMAIL_CLEANUP_TIMEOUT_MS, DEFAULT_CLEANUP_TIMEOUT_MS),
    );
  }
}

export async function findSentThreadEvidence({
  messageIds,
  since,
  referenceIds = [],
  mailboxScope = "tristan",
  env = process.env,
  createClient = (options) => new ImapFlow(options),
}) {
  const wanted = [...new Set((messageIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  const cutoff = since instanceof Date ? since : new Date(since);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Sent-thread reconciliation cutoff is invalid.");
  const anchors = new Set(referenceIds.map(rfcMessageId).filter(Boolean));
  if (!anchors.size) throw new Error("Sent-thread reconciliation requires a message reference anchor.");
  const client = createClient(imapOptions(mailboxScope, env));
  const clientError = observeClientErrors(client);
  let lock;
  try {
    const guardWork = (async () => {
      await client.connect();
      lock = await client.getMailboxLock(mailboxValue(
        mailboxScope,
        "SENT_FOLDER",
        env,
        String(env.AIRBNB_SUPPORT_GMAIL_SENT_FOLDER ?? DEFAULT_SENT_FOLDER),
      ));
      const found = [];
      for (const messageId of wanted) {
        const matches = await client.search({ header: { "message-id": messageId } }, { uid: true });
        if (matches?.length) found.push(messageId);
      }

      const candidateUids = await client.search({ since: cutoff }, { uid: true });
      let humanReplyAt = null;
      const selectedUids = (candidateUids ?? []).slice(-200);
      if (selectedUids.length) {
        for await (const message of client.fetch(
          selectedUids,
          { source: true, internalDate: true, uid: true },
          { uid: true },
        )) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true });
          const messageId = String(parsed.messageId ?? "").trim();
          if (wanted.includes(messageId)) continue;
          const recipients = addressList(parsed.to).map((value) => String(value).toLowerCase());
          if (!recipients.some((address) => trustedAirbnbSender(address))) continue;
          const occurredAt = message.internalDate ?? parsed.date;
          const occurredAtMs = occurredAt instanceof Date ? occurredAt.getTime() : Date.parse(occurredAt);
          if (!Number.isFinite(occurredAtMs) || occurredAtMs <= cutoff.getTime()) continue;
          const sentReferences = [
            parsed.inReplyTo,
            ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
          ].map((value) => String(value ?? "").trim()).filter(Boolean);
          const linkedByReference = sentReferences.some((value) => anchors.has(value));
          if (!linkedByReference) continue;
          const candidateTime = new Date(occurredAtMs).toISOString();
          if (!humanReplyAt || Date.parse(candidateTime) > Date.parse(humanReplyAt)) humanReplyAt = candidateTime;
        }
      }
      return { messageIds: found, humanReplyAt };
    })();
    return await withClientDeadline(
      client,
      guardWork,
      positiveInteger(env.AIRBNB_SUPPORT_GMAIL_GUARD_DEADLINE_MS, DEFAULT_GUARD_DEADLINE_MS),
      guardDeadlineError,
      clientError,
    );
  } finally {
    lock?.release();
    await finishClient(
      client,
      positiveInteger(env.AIRBNB_SUPPORT_GMAIL_CLEANUP_TIMEOUT_MS, DEFAULT_CLEANUP_TIMEOUT_MS),
    );
  }
}

export async function sendThreadedReply({
  to,
  subject,
  text,
  messageId,
  inReplyTo,
  references = [],
  env = process.env,
  createTransport = (options) => nodemailer.createTransport(options),
}) {
  const recipient = String(to ?? "").trim().toLowerCase();
  if (!trustedAirbnbSender(recipient)) throw new Error("Airbnb reply recipient is not trusted.");
  const user = required("AIRBNB_SUPPORT_GMAIL_USER", env);
  const transport = createTransport({
    host: String(env.AIRBNB_SUPPORT_GMAIL_SMTP_HOST ?? "smtp.gmail.com"),
    port: Number.parseInt(env.AIRBNB_SUPPORT_GMAIL_SMTP_PORT ?? "465", 10),
    secure: String(env.AIRBNB_SUPPORT_GMAIL_SMTP_SECURE ?? "true") === "true",
    auth: { user, pass: required("AIRBNB_SUPPORT_GMAIL_APP_PASSWORD", env) },
    connectionTimeout: positiveInteger(env.AIRBNB_SUPPORT_GMAIL_CONNECTION_TIMEOUT_MS, DEFAULT_CONNECTION_TIMEOUT_MS),
    socketTimeout: positiveInteger(env.AIRBNB_SUPPORT_GMAIL_SOCKET_TIMEOUT_MS, DEFAULT_SOCKET_TIMEOUT_MS),
    logger: false,
  });
  try {
    const referenceIds = [...new Set([...references, inReplyTo].map((value) => String(value ?? "").trim()).filter(Boolean))];
    const info = await transport.sendMail({
      from: user,
      to: recipient,
      subject: String(subject ?? "").trim(),
      text: String(text ?? "").trim(),
      messageId,
      inReplyTo: inReplyTo || undefined,
      references: referenceIds,
    });
    return {
      messageId: String(info.messageId ?? messageId),
      acceptedCount: Array.isArray(info.accepted) ? info.accepted.length : null,
      rejectedCount: Array.isArray(info.rejected) ? info.rejected.length : null,
    };
  } finally {
    transport.close?.();
  }
}

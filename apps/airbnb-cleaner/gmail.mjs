import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";

const DEFAULT_FOLDER = "[Gmail]/All Mail";

function requireEnv(name, env) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function envelopeFromMessage(message) {
  const sender = message.envelope?.from?.[0] ?? {};
  return {
    id: String(message.uid),
    date: message.internalDate?.toISOString?.() ?? "",
    subject: message.envelope?.subject ?? "",
    from: {
      name: sender.name ?? "",
      addr: sender.address ?? "",
    },
  };
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

export async function collectAirbnbMessages({
  afterDate,
  maxRead,
  candidateEnvelope,
  subjectMayTouchTarget,
  describeEvidence = null,
  env = process.env,
  createClient = (options) => new ImapFlow(options),
}) {
  const user = requireEnv("AIRBNB_GMAIL_USER", env);
  const pass = requireEnv("AIRBNB_GMAIL_APP_PASSWORD", env);
  const folder = String(env.AIRBNB_GMAIL_FOLDER ?? DEFAULT_FOLDER);
  const client = createClient({
    host: String(env.AIRBNB_GMAIL_IMAP_HOST ?? "imap.gmail.com"),
    port: Number.parseInt(env.AIRBNB_GMAIL_IMAP_PORT ?? "993", 10),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  let lock;
  try {
    lock = await client.getMailboxLock(folder);
    const uids = await client.search({ since: new Date(`${afterDate}T00:00:00Z`), from: "airbnb.com" }, { uid: true });
    if (!uids.length) return { messages: [], envelopesFound: 0 };

    const envelopes = [];
    for await (const message of client.fetch(uids, { envelope: true, internalDate: true, uid: true }, { uid: true })) {
      const envelope = envelopeFromMessage(message);
      if (candidateEnvelope(envelope)) envelopes.push(envelope);
    }

    const touching = envelopes
      .filter((envelope) => subjectMayTouchTarget(envelope.subject ?? ""))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const evidencePriority = (envelope) => {
      if (!describeEvidence) return 1;
      const evidence = describeEvidence({ envelope, body: "" });
      if (["confirmed", "cancelled"].includes(evidence?.evidenceKind)) return 0;
      if (evidence?.evidenceSubtype === "update") return 1;
      if (evidence?.evidenceKind === "supplemental") return 2;
      return 3;
    };
    const selected = touching
      .sort((left, right) => evidencePriority(left) - evidencePriority(right)
        || Date.parse(right.date) - Date.parse(left.date))
      .slice(0, maxRead)
      .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
    const messageByEnvelopeId = new Map();
    const readMessage = async (envelope) => {
      const cached = messageByEnvelopeId.get(envelope.id);
      if (cached) return cached;
      const message = await client.fetchOne(Number(envelope.id), { source: true }, { uid: true });
      if (!message?.source) return null;
      const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true });
      const result = { envelope, body: readableBody(parsed) };
      messageByEnvelopeId.set(envelope.id, result);
      return result;
    };

    const messages = [];
    for (const envelope of selected) {
      const message = await readMessage(envelope);
      if (message) messages.push(message);
    }

    let missingConfirmationAnchorCount = 0;
    if (describeEvidence) {
      const described = messages.map((message) => ({ message, evidence: describeEvidence(message) }));
      const confirmedCodes = new Set(
        described
          .filter(({ evidence }) => evidence?.evidenceKind === "confirmed" && evidence.confirmationCode)
          .map(({ evidence }) => evidence.confirmationCode)
      );
      const missingCodes = new Set(
        described
          .filter(({ evidence }) =>
            evidence?.evidenceKind === "supplemental" &&
            evidence.evidenceSubtype === "update" &&
            evidence.confirmationCode &&
            !confirmedCodes.has(evidence.confirmationCode)
          )
          .map(({ evidence }) => evidence.confirmationCode)
      );

      const anchorSince = new Date(`${afterDate}T00:00:00Z`);
      anchorSince.setUTCDate(anchorSince.getUTCDate() - 400);
      for (const confirmationCode of [...missingCodes].slice(0, 8)) {
        const anchorUids = await client.search({
          since: anchorSince,
          from: "airbnb.com",
          body: confirmationCode,
        }, { uid: true });
        if (!anchorUids.length) continue;
        const anchorEnvelopes = [];
        for await (const message of client.fetch(
          anchorUids,
          { envelope: true, internalDate: true, uid: true },
          { uid: true },
        )) {
          const envelope = envelopeFromMessage(message);
          if (describeEvidence({ envelope, body: "" })?.evidenceKind === "confirmed") {
            anchorEnvelopes.push(envelope);
          }
        }
        anchorEnvelopes.sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
        for (const envelope of anchorEnvelopes) {
          const message = await readMessage(envelope);
          if (!message) continue;
          const evidence = describeEvidence(message);
          if (evidence?.evidenceKind !== "confirmed" || evidence.confirmationCode !== confirmationCode) continue;
          if (!messages.some((existing) => existing.envelope.id === envelope.id)) messages.push(message);
          missingCodes.delete(confirmationCode);
          break;
        }
      }
      missingConfirmationAnchorCount = missingCodes.size;
    }

    return { messages, envelopesFound: selected.length, missingConfirmationAnchorCount };
  } finally {
    lock?.release();
    if (client.usable) await client.logout();
    else client.close();
  }
}

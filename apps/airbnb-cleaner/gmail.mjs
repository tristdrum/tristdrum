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

    const selected = envelopes
      .filter((envelope) => subjectMayTouchTarget(envelope.subject ?? ""))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, maxRead);
    const readMessage = async (envelope) => {
      const message = await client.fetchOne(Number(envelope.id), { source: true }, { uid: true });
      if (!message?.source) return null;
      const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true });
      return { envelope, body: readableBody(parsed) };
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

      if (missingCodes.size) {
        const selectedIds = new Set(selected.map((envelope) => envelope.id));
        const confirmationCandidates = envelopes
          .filter((envelope) => !selectedIds.has(envelope.id))
          .filter((envelope) => describeEvidence({ envelope, body: "" })?.evidenceKind === "confirmed")
          .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

        for (const envelope of confirmationCandidates) {
          const message = await readMessage(envelope);
          if (!message) continue;
          const evidence = describeEvidence(message);
          if (evidence?.evidenceKind !== "confirmed" || !missingCodes.has(evidence.confirmationCode)) continue;
          messages.push(message);
          missingCodes.delete(evidence.confirmationCode);
          if (!missingCodes.size) break;
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

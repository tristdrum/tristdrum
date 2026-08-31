import { contentFingerprint, trustedAirbnbSender } from "./evidence.mjs";

function lines(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function conversationWindow(bodyLines) {
  const replyIndex = bodyLines.findIndex((line) => line === "Reply" || /^Reply\s*\[/.test(line));
  const end = replyIndex >= 0 ? replyIndex : bodyLines.length;
  const safetyIndex = bodyLines.findIndex((line) => /always communicate through Airbnb/i.test(line));
  return bodyLines.slice(safetyIndex >= 0 ? safetyIndex + 1 : 0, end);
}

function canonicalParticipantHash(name, role, text) {
  const canonicalName = String(name ?? "").trim().toLocaleLowerCase("en");
  const canonicalRole = /^(?:guest|booker)$/i.test(String(role ?? "").trim()) ? "guest" : "host";
  return contentFingerprint(`${canonicalName}|${canonicalRole}|${text}`);
}

const CONVERSATION_SUBJECT_PATTERNS = Object.freeze([
  /^RE:\s*(?:Reservation|Inquiry|Pre-approval)\s+for\s+(.+?),\s*(.+)$/i,
  /^RE:\s*Reservation request\s+(?:for|at)\s+(.+?)(?:,\s*|\s+for\s+)(.+)$/i,
]);

const CONVERSATION_HEADING_PATTERNS = Object.freeze([
  /(?:Reservation|Inquiry|Pre-approval)\s+for\s+(.+?),\s*(.+?)(?:\n|$)/i,
  /Reservation request\s+(?:for|at)\s+(.+?)(?:,\s*|\s+for\s+)(.+?)(?:\n|$)/i,
]);

const INITIAL_INQUIRY_SUBJECT_PATTERN = /^Inquiry for (.+?) for (.+)$/i;

export function isAirbnbConversationSubject(subject) {
  const value = String(subject ?? "").trim();
  return CONVERSATION_SUBJECT_PATTERNS.some((pattern) => pattern.test(value));
}

export function isAirbnbInitialInquirySubject(subject) {
  return INITIAL_INQUIRY_SUBJECT_PATTERN.test(String(subject ?? "").trim());
}

function conversationMetadata(subject, body) {
  const subjectText = String(subject ?? "").trim();
  const subjectMatch = CONVERSATION_SUBJECT_PATTERNS
    .map((pattern) => pattern.exec(subjectText))
    .find(Boolean);
  if (!subjectMatch) return null;

  const bodyText = String(body ?? "");
  const headingMatch = CONVERSATION_HEADING_PATTERNS
    .map((pattern) => pattern.exec(bodyText))
    .find(Boolean);
  const match = headingMatch ?? subjectMatch;
  return {
    listingName: match[1]?.trim() || null,
    stayLabel: match[2]?.trim() || null,
  };
}

export function parseConversationEntries(body) {
  const bodyLines = conversationWindow(lines(body));
  const entries = [];
  for (let index = 1; index < bodyLines.length; index += 1) {
    const role = bodyLines[index];
    if (!/^(?:Host|Guest|Booker)$/i.test(role)) continue;
    const name = bodyLines[index - 1];
    const messageLines = [];
    let cursor = index + 1;
    while (cursor < bodyLines.length) {
      if (/^(?:Host|Guest|Booker)$/i.test(bodyLines[cursor])) break;
      if (cursor + 1 < bodyLines.length && /^(?:Host|Guest|Booker)$/i.test(bodyLines[cursor + 1])) break;
      messageLines.push(bodyLines[cursor]);
      cursor += 1;
    }
    const text = messageLines.join(" ").replace(/\s+/g, " ").trim();
    if (!name || !text || /^https?:/i.test(name)) continue;
    entries.push({
      name,
      role: /^host$/i.test(role) ? "Host" : "Guest",
      direction: /^host$/i.test(role) ? "host" : "guest",
      text,
      sequence: entries.length,
      contentHash: contentFingerprint(`${name}|${role}|${text}`),
      canonicalContentHash: canonicalParticipantHash(name, role, text),
    });
    index = Math.max(index, cursor - 1);
  }
  return entries;
}

export function conversationEntryKey(providerThreadId, entry) {
  return [
    String(providerThreadId ?? "").trim(),
    Number(entry?.sequence ?? -1),
    String(entry?.direction ?? "unknown"),
    String(entry?.contentHash ?? "").trim(),
  ].join(":");
}

export function parseAirbnbConversationEmail({
  providerMessageId,
  subject,
  body,
  from,
  occurredAt,
  replyTo = null,
  references = [],
}) {
  if (!trustedAirbnbSender(from)) return null;
  const threadId = /\/hosting\/thread\/(\d+)/i.exec(body)?.[1] ?? null;
  const metadata = conversationMetadata(subject, body);
  if (!threadId || !metadata) return null;
  const entries = parseConversationEntries(body);
  if (!entries.length) return null;
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    providerEntryId: `${providerMessageId}:${entry.sequence}:${entry.contentHash.slice(0, 12)}`,
  }));
  return {
    providerMessageId,
    providerThreadId: threadId,
    subject: String(subject ?? "").trim(),
    listingName: metadata.listingName,
    stayLabel: metadata.stayLabel,
    occurredAt,
    replyTo,
    references,
    entries: normalizedEntries,
    sourceFingerprint: contentFingerprint(entries.map((entry) => `${entry.direction}:${entry.contentHash}`).join("|")),
    canonicalSourceFingerprint: contentFingerprint(
      entries.map((entry) => `${entry.direction}:${entry.canonicalContentHash}`).join("|"),
    ),
  };
}

export function parseAirbnbInitialInquiryEmail({
  providerMessageId,
  subject,
  body,
  from,
  occurredAt,
  references = [],
}) {
  if (String(from ?? "").trim().toLowerCase() !== "automated@airbnb.com") return null;
  const subjectMatch = INITIAL_INQUIRY_SUBJECT_PATTERN.exec(String(subject ?? "").trim());
  const threadId = /\/hosting\/thread\/(\d+)/i.exec(body)?.[1] ?? null;
  if (!subjectMatch || !threadId) return null;
  const bodyLines = lines(body);
  const headingIndex = bodyLines.findIndex((line) => /^RESPOND TO .+[’']S INQUIRY$/i.test(line));
  const identityIndex = bodyLines.findIndex((line, index) => index > headingIndex && /^Identity verified\b/i.test(line));
  const endIndex = bodyLines.findIndex((line, index) => index > identityIndex && /^Pre-approve\s*\/\s*Decline/i.test(line));
  if (headingIndex < 0 || identityIndex < 0 || endIndex < 0) return null;
  const headingName = /^RESPOND TO (.+?)[’']S INQUIRY$/i.exec(bodyLines[headingIndex])?.[1]?.trim();
  const bodyName = bodyLines.slice(headingIndex + 1, identityIndex)
    .find((line) => !/^https?:/i.test(line));
  const guestName = bodyName || headingName || null;
  const text = bodyLines.slice(identityIndex + 1, endIndex)
    .filter((line) => !/^https?:/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!guestName || !text) return null;
  const contentHash = contentFingerprint(`${guestName}|Guest|${text}`);
  const canonicalContentHash = canonicalParticipantHash(guestName, "Guest", text);
  const entries = [{
    name: guestName,
    role: "Guest",
    direction: "guest",
    text,
    sequence: 0,
    contentHash,
    canonicalContentHash,
    providerEntryId: `${providerMessageId}:0:${contentHash.slice(0, 12)}`,
  }];
  return {
    providerMessageId,
    providerThreadId: threadId,
    subject: String(subject ?? "").trim(),
    listingName: subjectMatch[1]?.trim() || null,
    stayLabel: subjectMatch[2]?.trim() || null,
    occurredAt,
    replyTo: null,
    references,
    entries,
    sourceKind: "initial_inquiry",
    replyRequired: true,
    replyCapable: false,
    sourceFingerprint: contentFingerprint(`guest:${contentHash}`),
    canonicalSourceFingerprint: contentFingerprint(`guest:${canonicalContentHash}`),
  };
}

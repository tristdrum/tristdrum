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
  if (!trustedAirbnbSender(from) || String(from).trim().toLowerCase() !== "express@airbnb.com") return null;
  const threadId = /\/hosting\/thread\/(\d+)/i.exec(body)?.[1] ?? null;
  if (!threadId || !/^RE:\s*Reservation for /i.test(String(subject ?? ""))) return null;
  const heading = /Reservation for\s+(.+?),\s+(.+?)(?:\n|$)/i.exec(String(body ?? ""));
  const entries = parseConversationEntries(body);
  if (!entries.length) return null;
  return {
    providerMessageId,
    providerThreadId: threadId,
    subject: String(subject ?? "").trim(),
    listingName: heading?.[1]?.trim() ?? null,
    stayLabel: heading?.[2]?.trim() ?? null,
    occurredAt,
    replyTo,
    references,
    entries: entries.map((entry) => ({
      ...entry,
      providerEntryId: `${providerMessageId}:${entry.sequence}:${entry.contentHash.slice(0, 12)}`,
    })),
    sourceFingerprint: contentFingerprint(entries.map((entry) => `${entry.direction}:${entry.contentHash}`).join("|")),
  };
}

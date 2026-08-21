import { createHash } from "node:crypto";

export function contentFingerprint(value) {
  return createHash("sha256")
    .update(String(value ?? "").replace(/\s+/g, " ").trim())
    .digest("hex");
}

export function canonicalConversationActor({ airbnbRoleLabel }) {
  const label = String(airbnbRoleLabel ?? "").toLowerCase();
  if (/\bhost\b/.test(label)) return { direction: "host", hostIdentity: null };
  if (/\bguest\b/.test(label)) return { direction: "guest", hostIdentity: null };
  return { direction: "system", hostIdentity: null };
}

export function trustedAirbnbSender(address) {
  const normalized = String(address ?? "").trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return normalized.includes("@") && (domain === "airbnb.com" || domain.endsWith(".airbnb.com"));
}

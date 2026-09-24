import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const PERMISSION_PATH = "/data/airbnb-automated-access-grant.pdf";
const REQUIRED_SCOPE = "automated_host_website_read_only_calendar_messages";

// Intentionally unset. A separately reviewed Airbnb-issued grant must be pinned in a later code review.
export const AIRBNB_AUTOMATED_ACCESS_GRANT = null;

export async function assertAirbnbAutomatedAccessAuthorized({ grant = AIRBNB_AUTOMATED_ACCESS_GRANT,
  documentPath = PERMISSION_PATH, now = () => new Date() } = {}) {
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(grant?.expiresOn ?? "") ?
    new Date(`${grant.expiresOn}T23:59:59Z`) : null;
  if (grant?.issuer !== "Airbnb" || grant.scope !== REQUIRED_SCOPE ||
      !/^[a-f0-9]{64}$/.test(grant.documentSha256 ?? "") ||
      !expiry || !Number.isFinite(expiry.getTime()) ||
      expiry.toISOString().slice(0, 10) !== grant.expiresOn ||
      now().getTime() > expiry.getTime() ||
      !isAbsolute(documentPath)) {
    throw new Error("Airbnb-issued automated website access permission is not configured or has expired");
  }
  let info; let bytes;
  try {
    info = await lstat(documentPath);
    if (!info.isFile() || (info.mode & 0o077) !== 0 ||
        process.getuid && info.uid !== process.getuid() ||
        info.size < 1 || info.size > 5 * 1024 * 1024) {
      throw new Error("Invalid private permission document");
    }
    bytes = await readFile(documentPath);
  } catch { throw new Error("Private Airbnb permission document is unavailable"); }
  if (createHash("sha256").update(bytes).digest("hex") !== grant.documentSha256) {
    throw new Error("Private Airbnb permission document does not match reviewed grant");
  }
}

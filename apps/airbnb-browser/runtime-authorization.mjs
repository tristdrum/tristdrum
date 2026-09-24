import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const PERMISSION_PATH = "/data/airbnb-automated-access-grant.pdf";
const REQUIRED_SCOPE = "automated_host_website_read_only_calendar_messages";

// Intentionally unset. A separately reviewed Airbnb-issued grant must be pinned in a later code review.
export const AIRBNB_AUTOMATED_ACCESS_GRANT = null;

export async function assertAirbnbAutomatedAccessAuthorized({ grant = AIRBNB_AUTOMATED_ACCESS_GRANT,
  documentPath = PERMISSION_PATH, now = () => new Date() } = {}) {
  const expiryText = grant?.expiresAt ?? "";
  const expiryParts = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.\d{1,3})?(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.exec(expiryText);
  const expiryMs = expiryParts ? Date.parse(expiryText) : NaN;
  const zone = expiryParts?.[2];
  const offsetMinutes = zone === "Z" ? 0 :
    (zone?.[0] === "-" ? -1 : 1) * (Number(zone?.slice(1, 3)) * 60 + Number(zone?.slice(4, 6)));
  const validInstant = Number.isFinite(expiryMs) &&
    new Date(expiryMs + offsetMinutes * 60_000).toISOString().slice(0, 19) === expiryParts[1];
  if (grant?.issuer !== "Airbnb" || grant.scope !== REQUIRED_SCOPE ||
      !/^[a-f0-9]{64}$/.test(grant.documentSha256 ?? "") ||
      !validInstant || now().getTime() > expiryMs ||
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

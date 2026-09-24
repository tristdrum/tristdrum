import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertAirbnbAutomatedAccessAuthorized } from "./runtime-authorization.mjs";

test("the real server refuses to start without separately reviewed Airbnb permission", () => {
  const result = spawnSync(process.execPath, ["server.mjs"], { cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: { ...process.env, AIRBNB_BROWSER_BOOTSTRAP_ENABLED: "true",
      AIRBNB_BROWSER_AUTOMATED_ACCESS_GRANTED: "true" }, encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Airbnb-issued automated website access permission/);
});

test("permission gate requires an unexpired Airbnb grant pinned to a private document", async () => {
  const dir = await mkdtemp(join(tmpdir(), "airbnb-permission-test-"));
  const documentPath = join(dir, "synthetic-permission.pdf");
  const document = Buffer.from("SYNTHETIC_AIRBNB_PERMISSION_FIXTURE");
  const documentSha256 = createHash("sha256").update(document).digest("hex");
  const grant = { issuer: "Airbnb", scope: "automated_host_website_read_only_calendar_messages",
    documentSha256, expiresOn: "2026-12-31" };
  try {
    await writeFile(documentPath, document, { mode: 0o600 });
    const options = { grant, documentPath, now: () => new Date("2026-09-24T10:00:00Z") };
    await assert.rejects(assertAirbnbAutomatedAccessAuthorized(), /not configured/);
    await assertAirbnbAutomatedAccessAuthorized(options);
    await assert.rejects(assertAirbnbAutomatedAccessAuthorized({ ...options,
      grant: { ...grant, issuer: "Owner" } }), /not configured/);
    await assert.rejects(assertAirbnbAutomatedAccessAuthorized({ ...options,
      grant: { ...grant, expiresOn: "2026-01-01" } }), /expired/);
    await assert.rejects(assertAirbnbAutomatedAccessAuthorized({ ...options,
      grant: { ...grant, documentSha256: "0".repeat(64) } }), /does not match/);
    await writeFile(documentPath, "SYNTHETIC_CHANGED_DOCUMENT");
    await assert.rejects(assertAirbnbAutomatedAccessAuthorized(options), /does not match/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

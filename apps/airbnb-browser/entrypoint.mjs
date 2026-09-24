import { execFileSync } from "node:child_process";
import { chown } from "node:fs/promises";

if (process.getuid?.() === 0) {
  const uid = Number(execFileSync("id", ["-u", "pwuser"], { encoding: "utf8" }).trim());
  const gid = Number(execFileSync("id", ["-g", "pwuser"], { encoding: "utf8" }).trim());
  await chown("/data", uid, gid);
  process.setgid(gid);
  process.setuid(uid);
}
await import("./server.mjs");

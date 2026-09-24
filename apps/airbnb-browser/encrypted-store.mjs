import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { renameSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const AAD = Buffer.from("airbnb-browser-pilot:v1");

export function encryptJson(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}

export function decryptJson(payload, key) {
  const parsed = JSON.parse(payload);
  if (parsed.version !== 1) throw new Error("Unsupported encrypted store version");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}

export class EncryptedStore {
  constructor(path, key) { this.path = path; this.key = key; }

  async read() {
    try { return decryptJson(await readFile(this.path, "utf8"), this.key); }
    catch (error) {
      if (error.code === "ENOENT") return {};
      throw new Error("Encrypted browser state cannot be read", { cause: error });
    }
  }

  async write(value, { signal } = {}) {
    if (signal?.aborted) throw new Error("Browser auth capture cancelled");
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    let committed = false;
    try {
      await writeFile(temporaryPath, encryptJson(value, this.key), { mode: 0o600, flag: "wx", signal });
      if (signal?.aborted) throw new Error("Browser auth capture cancelled");
      if (signal) renameSync(temporaryPath, this.path);
      else await rename(temporaryPath, this.path);
      committed = true;
    } finally { if (!committed) await rm(temporaryPath, { force: true }); }
  }
}

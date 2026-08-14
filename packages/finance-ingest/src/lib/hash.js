import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

export function stableStringify(value, indentation = 2) {
  return JSON.stringify(canonicalize(value), null, indentation);
}

export function contentKey(namespace, value, length = 32) {
  return `${namespace}:${sha256(value).slice(0, length)}`;
}

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { contentKey, sha256, sha256File } from "./hash.js";
import { normalizeRelativePath } from "./paths.js";
import { analyzePdf } from "./pdf.js";
import { inferDocumentRole } from "./roles.js";
import { normalizeText } from "./text.js";

const TEXT_EXTENSIONS = new Set([".csv", ".eml", ".html", ".json", ".md", ".txt", ".xml"]);

const MEDIA_TYPES = {
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".eml": "message/rfc822",
  ".heic": "image/heic",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function normalizedTextFileHash(filePath) {
  const raw = await readFile(filePath, "utf8");
  const normalized = normalizeText(raw);
  return normalized ? sha256(Buffer.from(`normalized-text-file-v1\0${normalized}`, "utf8")) : null;
}

export async function inspectEvidenceFile({
  adapterId,
  sourceId,
  sourceRoot,
  filePath,
  pdfMode = "normalized",
}) {
  const metadata = await stat(filePath);
  const relativePath = normalizeRelativePath(path.relative(sourceRoot, filePath));
  const fileName = path.basename(filePath);
  const extension = path.extname(fileName).toLowerCase();
  const exactSha256 = await sha256File(filePath);
  const sourceKey = contentKey(
    `${adapterId}:${sourceId}:file`,
    `${adapterId}\0${sourceId}\0${relativePath}`,
  );
  const revisionKey = contentKey(
    `${adapterId}:${sourceId}:revision`,
    `${sourceKey}\0${exactSha256}`,
  );

  let normalizedDocumentHash = null;
  let documentTextHash = null;
  let pageCount = null;
  let pages = [];
  let classificationText = "";
  const warnings = [];

  if (metadata.size === 0) {
    warnings.push("empty_file");
  } else if (extension === ".pdf") {
    const pdf = await analyzePdf(filePath, { mode: pdfMode });
    ({
      normalizedDocumentHash,
      documentTextHash,
      pageCount,
      pages,
      classificationText,
    } = pdf);
    warnings.push(...pdf.warnings);
  } else if (TEXT_EXTENSIONS.has(extension)) {
    try {
      documentTextHash = await normalizedTextFileHash(filePath);
      normalizedDocumentHash = documentTextHash;
    } catch {
      warnings.push("normalized_text_hash_failed");
    }
  }

  const role = inferDocumentRole(fileName, classificationText);

  return {
    sourceKey,
    revisionKey,
    sourceId,
    relativePath,
    localPath: path.resolve(filePath),
    fileName,
    extension: extension.slice(1),
    mediaType: MEDIA_TYPES[extension] ?? "application/octet-stream",
    sizeBytes: metadata.size,
    modifiedAt: metadata.mtime.toISOString(),
    exactSha256,
    normalizedDocumentHash,
    documentTextHash,
    pageCount,
    pages,
    role: role.role,
    financialFactRole: role.financialFactRole,
    countingPolicy: role.countingPolicy,
    purchaseEvidenceCandidate: role.purchaseEvidenceCandidate,
    ingestionStatus: warnings.length ? "preserved_with_warnings" : "preserved",
    retentionStatus: "retain_forever",
    sourceMutationPolicy: "read_only",
    warnings,
    duplicateOf: null,
  };
}

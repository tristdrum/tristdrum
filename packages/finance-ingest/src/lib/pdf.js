import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sha256 } from "./hash.js";
import { normalizeText } from "./text.js";

const execFileAsync = promisify(execFile);
const MAX_TOOL_OUTPUT_BYTES = 128 * 1024 * 1024;

async function runTextTool(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_TOOL_OUTPUT_BYTES,
  });
  return stdout;
}

async function renderPageToPortableGraymap(filePath, pageNumber) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "finance-ingest-pdf-"));
  const outputPrefix = path.join(temporaryDirectory, "page");
  const outputPath = `${outputPrefix}.pgm`;

  try {
    await execFileAsync(
      "pdftoppm",
      [
        "-f",
        String(pageNumber),
        "-l",
        String(pageNumber),
        "-r",
        "96",
        "-gray",
        "-singlefile",
        filePath,
        outputPrefix,
      ],
      { encoding: "utf8", maxBuffer: MAX_TOOL_OUTPUT_BYTES },
    );
    return await readFile(outputPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function parsePageCount(pdfInfoOutput) {
  const match = pdfInfoOutput.match(/^Pages:\s+(\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}

export async function analyzePdf(filePath, { mode = "normalized" } = {}) {
  if (mode === "exact") {
    return {
      normalizedDocumentHash: null,
      documentTextHash: null,
      pageCount: null,
      pages: [],
      classificationText: "",
      warnings: ["normalized_pdf_hash_skipped"],
    };
  }

  if (mode !== "normalized") {
    throw new Error(`Unsupported PDF hash mode: ${mode}`);
  }

  let pageCount;
  try {
    const info = await runTextTool("pdfinfo", [filePath]);
    pageCount = parsePageCount(info);
  } catch {
    return {
      normalizedDocumentHash: null,
      documentTextHash: null,
      pageCount: null,
      pages: [],
      classificationText: "",
      warnings: ["pdfinfo_failed"],
    };
  }

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return {
      normalizedDocumentHash: null,
      documentTextHash: null,
      pageCount,
      pages: [],
      classificationText: "",
      warnings: ["pdf_page_count_unavailable"],
    };
  }

  const pages = [];
  const extractedText = [];
  const warnings = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    let normalizedPageText = "";
    try {
      const rawText = await runTextTool("pdftotext", [
        "-f",
        String(pageNumber),
        "-l",
        String(pageNumber),
        "-layout",
        "-enc",
        "UTF-8",
        filePath,
        "-",
      ]);
      normalizedPageText = normalizeText(rawText);
    } catch {
      warnings.push(`page_${pageNumber}_text_extraction_failed`);
    }

    const pageTextHash = normalizedPageText
      ? sha256(Buffer.from(`pdf-page-text-v1\0${normalizedPageText}`, "utf8"))
      : null;

    let normalizedPageHash = pageTextHash;
    let normalizationBasis = pageTextHash ? "text" : null;
    let visualHash = null;

    if (!normalizedPageHash) {
      try {
        const raster = await renderPageToPortableGraymap(filePath, pageNumber);
        visualHash = sha256(Buffer.concat([Buffer.from("pdf-page-visual-v1\0"), raster]));
        normalizedPageHash = visualHash;
        normalizationBasis = "visual";
      } catch {
        warnings.push(`page_${pageNumber}_visual_normalization_failed`);
      }
    }

    if (normalizedPageText) {
      extractedText.push(normalizedPageText);
    }

    pages.push({
      pageNumber,
      pageTextHash,
      visualHash,
      normalizedPageHash,
      normalizationBasis,
    });
  }

  const allPagesNormalized = pages.every((page) => page.normalizedPageHash);
  const normalizedDocumentHash = allPagesNormalized
    ? sha256(
        Buffer.from(
          `pdf-document-pages-v1\0${pages.map((page) => page.normalizedPageHash).join("\n")}`,
          "utf8",
        ),
      )
    : null;
  const classificationText = extractedText.join("\n");
  const documentTextHash = classificationText
    ? sha256(Buffer.from(`pdf-document-text-v1\0${classificationText}`, "utf8"))
    : null;

  return {
    normalizedDocumentHash,
    documentTextHash,
    pageCount,
    pages,
    classificationText,
    warnings,
  };
}

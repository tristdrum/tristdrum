#!/usr/bin/env node

import { adapters, runAdapter } from "./adapters/index.js";
import { persistManifest } from "./lib/manifest.js";
import { defaultOutputPath } from "./lib/paths.js";

const HELP = `Finance evidence ingest (local-only)

Usage:
  finance-ingest adapters
  finance-ingest scan --adapter <id> --source <absolute-path> [options]

Options:
  --source-id <stable-id>       Stable namespace for source keys
  --pdf-mode <normalized|exact> Normalized page/text hashing (default) or fast exact-only
  --output <path>               Ignored local output directory (used only with --write)
  --write                       Persist one content-addressed manifest; otherwise dry run
  --dry-run                     Explicitly retain the default no-write behavior
  --help                        Show this help

Source files are never moved, renamed, rewritten, or deleted.`;

function parseOptions(args) {
  const options = { write: false, pdfMode: "normalized" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--write") {
      options.write = true;
    } else if (argument === "--dry-run") {
      options.write = false;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (["--adapter", "--source", "--source-id", "--pdf-mode", "--output"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      index += 1;
      const key = {
        "--adapter": "adapter",
        "--source": "source",
        "--source-id": "sourceId",
        "--pdf-mode": "pdfMode",
        "--output": "output",
      }[argument];
      options[key] = value;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function manifestSummary(manifest, writeResult = null) {
  return {
    adapter: manifest.adapter.id,
    manifestId: manifest.manifestId,
    sourceId: manifest.source.sourceId,
    mode: writeResult ? "write" : "dry_run",
    sourceFiles: manifest.stats.sourceFileCount,
    canonicalDocuments: manifest.stats.canonicalDocumentCount,
    duplicateSourceFiles: manifest.stats.duplicateSourceFileCount,
    normalizedDuplicateGroups: manifest.stats.normalizedDuplicateGroupCount,
    emptyFiles: manifest.stats.emptyFileCount,
    reviewRequiredFiles: manifest.stats.reviewRequiredFileCount,
    historicalRegisterRows: manifest.historicalSeeds?.invoiceRegister?.rowCount ?? null,
    historicalWorkbookSheets: manifest.historicalSeeds?.workbook?.sheetCount ?? null,
    output: writeResult,
    nextAction: writeResult
      ? "Review before any database import; historical values are not current tax truth."
      : "No files were written. Re-run with --write only after reviewing this summary.",
  };
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (command === "adapters") {
    process.stdout.write(`${JSON.stringify(adapters, null, 2)}\n`);
    return;
  }

  if (command !== "scan") {
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }

  const options = parseOptions(args);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!options.adapter) {
    throw new Error("--adapter is required");
  }
  if (!options.source) {
    throw new Error("--source is required");
  }
  if (!["normalized", "exact"].includes(options.pdfMode)) {
    throw new Error("--pdf-mode must be normalized or exact");
  }

  const manifest = await runAdapter(options.adapter, {
    source: options.source,
    sourceId: options.sourceId,
    pdfMode: options.pdfMode,
  });

  let writeResult = null;
  if (options.write) {
    writeResult = await persistManifest(manifest, options.output ?? defaultOutputPath());
  }

  process.stdout.write(`${JSON.stringify(manifestSummary(manifest, writeResult), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`finance-ingest: ${error.message}\n`);
  process.exitCode = 1;
});

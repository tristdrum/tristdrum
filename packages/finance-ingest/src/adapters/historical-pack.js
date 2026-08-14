import { access, stat } from "node:fs/promises";
import path from "node:path";
import { readCsvObjects } from "../lib/csv.js";
import { inspectEvidenceFile } from "../lib/files.js";
import { contentKey, stableStringify } from "../lib/hash.js";
import { finalizeManifest } from "../lib/manifest.js";
import { assertReadableDirectory, normalizeRelativePath } from "../lib/paths.js";
import { readXlsxWorkbook } from "../lib/xlsx.js";

export const historicalPackAdapter = {
  id: "historical-pack",
  version: 1,
  status: "implemented",
  description: "Historical, unverified seed from the February invoice register and workbook.",
  defaultSourceId: "harewood-2026-02-pack",
};

async function firstExisting(root, candidates) {
  for (const candidate of candidates) {
    const filePath = path.join(root, candidate);
    try {
      await access(filePath);
      return filePath;
    } catch {
      // Try the next known layout without changing the source tree.
    }
  }
  throw new Error(`Historical pack source is missing expected file: ${candidates.at(-1)}`);
}

function buildRegisterSeeds({ rows, columns, sourceId, evidenceSourceKey }) {
  const identityOccurrences = new Map();
  const seeds = rows.map((values, index) => {
    const rawIdentity = normalizeRelativePath(values.rel_path || `row-${index + 2}`);
    const occurrence = (identityOccurrences.get(rawIdentity) ?? 0) + 1;
    identityOccurrences.set(rawIdentity, occurrence);
    const identity = occurrence === 1 ? rawIdentity : `${rawIdentity}#${occurrence}`;
    const sourceKey = contentKey(
      `${historicalPackAdapter.id}:${sourceId}:register-row`,
      identity,
    );

    return {
      sourceKey,
      revisionKey: contentKey(
        `${historicalPackAdapter.id}:${sourceId}:register-row-revision`,
        `${sourceKey}\0${stableStringify(values, 0)}`,
      ),
      rowNumber: index + 2,
      values,
      interpretationStatus: "historical_unverified",
      countingPolicy: "do_not_count_directly",
      sourceEvidenceKey: evidenceSourceKey,
    };
  });

  return { columns, rowCount: seeds.length, rows: seeds };
}

function buildWorkbookSeeds({ workbook, sourceId, evidenceSourceKey }) {
  return {
    sourceEvidenceKey: evidenceSourceKey,
    interpretationStatus: "historical_unverified",
    countingPolicy: "do_not_count_directly",
    sheetCount: workbook.sheets.length,
    sheets: workbook.sheets.map((sheet) => ({
      sourceKey: contentKey(
        `${historicalPackAdapter.id}:${sourceId}:workbook-sheet`,
        sheet.name,
      ),
      name: sheet.name,
      sheetId: sheet.sheetId,
      state: sheet.state,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      headerCandidate: sheet.rows[0]?.values ?? [],
      rows: sheet.rows.map((row) => {
        const sourceKey = contentKey(
          `${historicalPackAdapter.id}:${sourceId}:workbook-row`,
          `${sheet.name}\0${row.rowNumber}`,
        );
        return {
          sourceKey,
          revisionKey: contentKey(
            `${historicalPackAdapter.id}:${sourceId}:workbook-row-revision`,
            `${sourceKey}\0${stableStringify({ values: row.values, formulas: row.formulas }, 0)}`,
          ),
          rowNumber: row.rowNumber,
          values: row.values,
          formulas: row.formulas,
          interpretationStatus: "historical_unverified",
          countingPolicy: "do_not_count_directly",
        };
      }),
    })),
  };
}

export async function scanHistoricalPack({ source, sourceId, pdfMode = "normalized" }) {
  const sourceRoot = await assertReadableDirectory(source);
  const resolvedSourceId = sourceId ?? historicalPackAdapter.defaultSourceId;
  const registerPath = await firstExisting(sourceRoot, [
    "03 Outputs/invoice_register_enriched.csv",
    "invoice_register_enriched.csv",
  ]);
  const workbookPath = await firstExisting(sourceRoot, [
    "03 Outputs/202602_prov_tax_pack.xlsx",
    "202602_prov_tax_pack.xlsx",
  ]);

  const evidenceObjects = [];
  for (const filePath of [registerPath, workbookPath]) {
    evidenceObjects.push(
      await inspectEvidenceFile({
        adapterId: historicalPackAdapter.id,
        sourceId: resolvedSourceId,
        sourceRoot,
        filePath,
        pdfMode,
      }),
    );
  }

  const registerEvidence = evidenceObjects.find((evidence) => evidence.localPath === registerPath);
  const workbookEvidence = evidenceObjects.find((evidence) => evidence.localPath === workbookPath);
  const [register, workbook, sourceMetadata] = await Promise.all([
    readCsvObjects(registerPath),
    readXlsxWorkbook(workbookPath),
    stat(sourceRoot),
  ]);

  const historicalSeeds = {
    invoiceRegister: buildRegisterSeeds({
      ...register,
      sourceId: resolvedSourceId,
      evidenceSourceKey: registerEvidence.sourceKey,
    }),
    workbook: buildWorkbookSeeds({
      workbook,
      sourceId: resolvedSourceId,
      evidenceSourceKey: workbookEvidence.sourceKey,
    }),
  };

  return finalizeManifest({
    adapter: historicalPackAdapter,
    source: {
      sourceId: resolvedSourceId,
      root: sourceRoot,
      kind: "historical_tax_pack",
      sourceDirectoryModifiedAt: sourceMetadata.mtime.toISOString(),
      mutationPolicy: "read_only_never_move_rename_or_delete",
    },
    evidenceObjects,
    historicalSeeds,
    warnings: ["historical_classifications_require_current_period_reconfirmation"],
  });
}

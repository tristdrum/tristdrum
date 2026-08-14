import { stat } from "node:fs/promises";
import path from "node:path";
import { inspectEvidenceFile } from "../lib/files.js";
import { finalizeManifest } from "../lib/manifest.js";
import { assertReadableDirectory, listFilesRecursively } from "../lib/paths.js";

export const harewoodFolderAdapter = {
  id: "harewood-folder",
  version: 1,
  status: "implemented",
  description: "Read-only recursive evidence scan for the Harewood invoice folder.",
  defaultSourceId: "harewood-invoices",
};

export async function scanHarewoodFolder({ source, sourceId, pdfMode = "normalized" }) {
  const sourceRoot = await assertReadableDirectory(source);
  const sourceMetadata = await stat(sourceRoot);
  const allFiles = await listFilesRecursively(sourceRoot);
  const files = allFiles.filter((filePath) => path.basename(filePath) !== ".DS_Store");
  const evidenceObjects = [];

  for (const filePath of files) {
    evidenceObjects.push(
      await inspectEvidenceFile({
        adapterId: harewoodFolderAdapter.id,
        sourceId: sourceId ?? harewoodFolderAdapter.defaultSourceId,
        sourceRoot,
        filePath,
        pdfMode,
      }),
    );
  }

  const latestModifiedAt = evidenceObjects
    .map((evidence) => evidence.modifiedAt)
    .sort()
    .at(-1);

  return finalizeManifest({
    adapter: harewoodFolderAdapter,
    source: {
      sourceId: sourceId ?? harewoodFolderAdapter.defaultSourceId,
      root: sourceRoot,
      kind: "local_original_evidence_vault",
      sourceDirectoryModifiedAt: sourceMetadata.mtime.toISOString(),
      latestEvidenceModifiedAt: latestModifiedAt ?? null,
      mutationPolicy: "read_only_never_move_rename_or_delete",
    },
    evidenceObjects,
    ignoredFileCount: allFiles.length - files.length,
  });
}

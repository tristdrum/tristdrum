import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { contentKey, sha256, stableStringify } from "./hash.js";
import { assertLocalOutputPath } from "./paths.js";

function canonicalGroupKey(evidence) {
  if (evidence.normalizedDocumentHash) {
    return `normalized:${evidence.normalizedDocumentHash}`;
  }
  return `exact:${evidence.exactSha256}`;
}

function buildCanonicalDocuments(evidenceObjects) {
  const groups = new Map();
  for (const evidence of evidenceObjects) {
    const groupKey = canonicalGroupKey(evidence);
    const members = groups.get(groupKey) ?? [];
    members.push(evidence);
    groups.set(groupKey, members);
  }

  const canonicalDocuments = [];
  for (const [groupKey, unsortedMembers] of groups) {
    const members = [...unsortedMembers].sort((left, right) =>
      left.sourceKey.localeCompare(right.sourceKey, "en"),
    );
    const representative = members[0];
    const canonicalDocumentKey = contentKey("canonical-document", groupKey);
    const exactVariantCount = new Set(members.map((member) => member.exactSha256)).size;
    const hasPurchaseEvidence = members.some((member) => member.purchaseEvidenceCandidate);

    for (const member of members.slice(1)) {
      member.duplicateOf = representative.sourceKey;
    }

    canonicalDocuments.push({
      canonicalDocumentKey,
      dedupeBasis: groupKey.startsWith("normalized:") ? "normalized_document" : "exact_file",
      representativeSourceKey: representative.sourceKey,
      memberSourceKeys: members.map((member) => member.sourceKey),
      occurrenceCount: members.length,
      exactVariantCount,
      duplicateMultiplicityCap: 1,
      potentialPurchaseEvidenceEvents: hasPurchaseEvidence ? 1 : 0,
      countingPolicy: "one_reconciled_event_maximum_per_canonical_document",
      roles: [...new Set(members.map((member) => member.role))].sort(),
      financialFactRoles: [...new Set(members.map((member) => member.financialFactRole))].sort(),
    });
  }

  return canonicalDocuments.sort((left, right) =>
    left.canonicalDocumentKey.localeCompare(right.canonicalDocumentKey, "en"),
  );
}

function buildCanonicalPages(evidenceObjects) {
  const groups = new Map();
  for (const evidence of evidenceObjects) {
    for (const page of evidence.pages ?? []) {
      if (!page.normalizedPageHash) {
        continue;
      }
      const members = groups.get(page.normalizedPageHash) ?? [];
      members.push({
        sourceKey: evidence.sourceKey,
        pageNumber: page.pageNumber,
        pageTextHash: page.pageTextHash,
        visualHash: page.visualHash,
        normalizationBasis: page.normalizationBasis,
      });
      groups.set(page.normalizedPageHash, members);
    }
  }

  return [...groups.entries()]
    .map(([normalizedPageHash, members]) => ({
      canonicalPageKey: contentKey("canonical-page", normalizedPageHash),
      normalizedPageHash,
      occurrenceCount: members.length,
      members: members.sort((left, right) =>
        `${left.sourceKey}:${left.pageNumber}`.localeCompare(
          `${right.sourceKey}:${right.pageNumber}`,
          "en",
        ),
      ),
    }))
    .sort((left, right) => left.canonicalPageKey.localeCompare(right.canonicalPageKey, "en"));
}

function calculateStats(evidenceObjects, canonicalDocuments, ignoredFileCount = 0) {
  const exactGroups = new Map();
  for (const evidence of evidenceObjects) {
    exactGroups.set(evidence.exactSha256, (exactGroups.get(evidence.exactSha256) ?? 0) + 1);
  }

  return {
    sourceFileCount: evidenceObjects.length,
    ignoredFileCount,
    totalBytes: evidenceObjects.reduce((sum, evidence) => sum + evidence.sizeBytes, 0),
    emptyFileCount: evidenceObjects.filter((evidence) => evidence.sizeBytes === 0).length,
    canonicalDocumentCount: canonicalDocuments.length,
    duplicateSourceFileCount: canonicalDocuments.reduce(
      (sum, document) => sum + Math.max(0, document.occurrenceCount - 1),
      0,
    ),
    exactDuplicateGroupCount: [...exactGroups.values()].filter((count) => count > 1).length,
    normalizedDuplicateGroupCount: canonicalDocuments.filter(
      (document) => document.dedupeBasis === "normalized_document" && document.exactVariantCount > 1,
    ).length,
    purchaseEvidenceCandidateCanonicalCount: canonicalDocuments.filter(
      (document) => document.potentialPurchaseEvidenceEvents === 1,
    ).length,
    settlementEvidenceFileCount: evidenceObjects.filter(
      (evidence) => evidence.financialFactRole === "settlement_evidence",
    ).length,
    reviewRequiredFileCount: evidenceObjects.filter(
      (evidence) => evidence.countingPolicy === "requires_review" || evidence.warnings.length > 0,
    ).length,
  };
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`Manifest invariant failed: duplicate ${label}`);
  }
}

export function assertManifestInvariants(manifest) {
  const sourceKeys = manifest.evidenceObjects.map((evidence) => evidence.sourceKey);
  const revisionKeys = manifest.evidenceObjects.map((evidence) => evidence.revisionKey);
  assertUnique(sourceKeys, "sourceKey");
  assertUnique(revisionKeys, "revisionKey");

  const sourceKeySet = new Set(sourceKeys);
  for (const evidence of manifest.evidenceObjects) {
    if (!/^[0-9a-f]{64}$/.test(evidence.exactSha256)) {
      throw new Error(`Manifest invariant failed: invalid exact hash for ${evidence.sourceKey}`);
    }
    if (evidence.duplicateOf && !sourceKeySet.has(evidence.duplicateOf)) {
      throw new Error(`Manifest invariant failed: missing duplicate target for ${evidence.sourceKey}`);
    }
  }

  const canonicalMembership = manifest.canonicalDocuments.flatMap(
    (document) => document.memberSourceKeys,
  );
  assertUnique(canonicalMembership, "canonical document membership");
  if (
    canonicalMembership.length !== sourceKeys.length ||
    canonicalMembership.some((sourceKey) => !sourceKeySet.has(sourceKey))
  ) {
    throw new Error("Manifest invariant failed: canonical documents do not cover every source file once");
  }
  if (manifest.canonicalDocuments.some((document) => document.duplicateMultiplicityCap !== 1)) {
    throw new Error("Manifest invariant failed: duplicate multiplicity cap must remain one");
  }

  const expectedSnapshotKey = contentKey(
    `${manifest.adapter.id}:source-snapshot`,
    [...manifest.evidenceObjects]
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey, "en"))
      .map((evidence) => evidence.revisionKey)
      .join("\n"),
  );
  if (manifest.source.sourceSnapshotKey !== expectedSnapshotKey) {
    throw new Error("Manifest invariant failed: source snapshot key does not match revisions");
  }
  return manifest;
}

export function finalizeManifest({
  adapter,
  source,
  evidenceObjects,
  ignoredFileCount = 0,
  historicalSeeds = null,
  warnings = [],
}) {
  const sortedEvidence = [...evidenceObjects].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey, "en"),
  );
  const canonicalDocuments = buildCanonicalDocuments(sortedEvidence);
  const canonicalPages = buildCanonicalPages(sortedEvidence);
  const sourceSnapshotKey = contentKey(
    `${adapter.id}:source-snapshot`,
    sortedEvidence.map((evidence) => evidence.revisionKey).join("\n"),
  );

  const body = {
    schemaVersion: "finance-evidence-manifest/v1",
    retentionPolicy: "retain_forever",
    correctionPolicy: "supersede_interpretations_never_erase_sources",
    adapter,
    source: { ...source, sourceSnapshotKey },
    evidenceObjects: sortedEvidence,
    canonicalDocuments,
    canonicalPages,
    stats: calculateStats(sortedEvidence, canonicalDocuments, ignoredFileCount),
    warnings: [...warnings].sort(),
    adapterInterfaces: [
      "absa-statements",
      "discovery-exports",
      "airbnb-evidence",
      "sixty60-himalaya",
      "himalaya-mail",
      "domestic-worker-payroll",
    ],
  };

  if (historicalSeeds) {
    body.historicalSeeds = historicalSeeds;
  }

  const manifest = {
    manifestId: contentKey("finance-manifest", sha256(stableStringify(body, 0))),
    ...body,
  };
  return assertManifestInvariants(manifest);
}

export async function persistManifest(manifest, outputRoot) {
  assertManifestInvariants(manifest);
  const safeOutputRoot = assertLocalOutputPath(outputRoot);
  await mkdir(safeOutputRoot, { recursive: true, mode: 0o700 });
  const adapterDirectory = path.join(safeOutputRoot, manifest.adapter.id);
  await mkdir(adapterDirectory, { recursive: true, mode: 0o700 });
  const fileName = `${manifest.adapter.id}-${manifest.manifestId.split(":").at(-1)}.json`;
  const manifestPath = path.join(adapterDirectory, fileName);
  const serialized = `${stableStringify(manifest)}\n`;

  try {
    await writeFile(manifestPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { status: "created", manifestPath };
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    const existing = await readFile(manifestPath, "utf8");
    if (existing !== serialized) {
      throw new Error(`Manifest collision without overwrite: ${manifestPath}`);
    }
    return { status: "reused", manifestPath };
  }
}

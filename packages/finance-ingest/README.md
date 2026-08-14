# Finance evidence ingest

This package scans local finance evidence without changing source files. It is
deliberately separate from the browser application and from Supabase: its first
job is to produce deterministic, reviewable manifests that later ingestion can
consume.

Safety properties:

- every scan is a dry run unless `--write` is passed;
- source files are only opened for reading and are never moved, renamed,
  rewritten, or deleted;
- writes inside this repository are accepted only under a Git-ignored path;
- reruns reuse stable source and revision keys instead of inventing new events;
- exact file hashes and normalized PDF document/page/text hashes are kept
  separately;
- quote, order, settlement, statement, and purchase evidence roles have
  distinct counting policies;
- generated manifests contain local paths and potentially sensitive historical
  values, so they must never be committed.

## Commands

List implemented and planned adapters:

```sh
npm run finance:adapters
```

Dry-run the Harewood evidence folder (default PDF mode is normalized):

```sh
npm run finance:ingest -- scan \
  --adapter harewood-folder \
  --source "/absolute/path/to/invoice-folder"
```

Persist a content-addressed manifest under the ignored local vault:

```sh
npm run finance:ingest -- scan \
  --adapter harewood-folder \
  --source "/absolute/path/to/invoice-folder" \
  --write
```

Seed the old invoice register and workbook as historical, unverified evidence:

```sh
npm run finance:ingest -- scan \
  --adapter historical-pack \
  --source "/absolute/path/to/historical-pack" \
  --write
```

Use `--pdf-mode exact` for a fast inventory that skips normalized page hashing.
It cannot detect visually identical PDFs whose only byte differences are PDF
metadata, so it is not suitable for final reconciliation.

The default output is `<git-root>/.finance-local/finance-ingest`. A custom
`--output` path may be outside the repository, or inside it only when Git
confirms that the path is ignored.

## What a manifest means

`sourceKey` identifies one source location. `revisionKey` combines that stable
identity with the exact content hash, so a changed file becomes a new revision
without erasing the old one. `canonicalDocumentKey` groups exact or normalized
duplicates. Downstream accounting must reference the canonical document key and
must never multiply an expense by the number of duplicate file variants.

Historical register and workbook rows are tagged `historical_unverified` and
`do_not_count_directly`. They are useful prior interpretations, not current tax
truth.

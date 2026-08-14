import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanHarewoodFolder } from "../src/adapters/harewood-folder.js";
import { scanHistoricalPack } from "../src/adapters/historical-pack.js";
import { persistManifest } from "../src/lib/manifest.js";
import { assertLocalOutputPath } from "../src/lib/paths.js";
import { inferDocumentRole } from "../src/lib/roles.js";
import { parseWorkbookMetadata, parseWorksheetXml } from "../src/lib/xlsx.js";
import { buildMinimalXlsx, buildPdf } from "./helpers.js";

function commandExists(command) {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const pdfToolsAvailable = ["pdfinfo", "pdftotext", "pdftoppm"].every(commandExists);

test("reruns preserve stable source/revision keys and reuse one manifest", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "finance-ingest-idempotent-"));
  const source = path.join(tempRoot, "source");
  const output = path.join(tempRoot, "output");
  await mkdir(source);
  const invoicePath = path.join(source, "Vendor Invoice.txt");
  await writeFile(invoicePath, "Tax Invoice\nTotal: 125.50\n");
  const before = await stat(invoicePath);

  const first = await scanHarewoodFolder({ source, sourceId: "test-source", pdfMode: "exact" });
  const second = await scanHarewoodFolder({ source, sourceId: "test-source", pdfMode: "exact" });
  assert.deepEqual(second, first);
  assert.equal(first.evidenceObjects[0].sourceKey, second.evidenceObjects[0].sourceKey);
  assert.equal(first.evidenceObjects[0].revisionKey, second.evidenceObjects[0].revisionKey);

  const firstWrite = await persistManifest(first, output);
  const secondWrite = await persistManifest(second, output);
  assert.equal(firstWrite.status, "created");
  assert.equal(secondWrite.status, "reused");
  assert.equal((await readdir(path.dirname(firstWrite.manifestPath))).length, 1);

  const after = await stat(invoicePath);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test(
  "eight byte-distinct PDF variants collapse to one canonical document",
  { skip: !pdfToolsAvailable },
  async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "finance-ingest-pdf-dedupe-"));
    for (let index = 1; index <= 8; index += 1) {
      await writeFile(
        path.join(tempRoot, `receipt-bundle-copy-${index}.pdf`),
        buildPdf({
          pages: ["Receipt bundle page one total 100.00", "Receipt bundle page two total 50.00"],
          title: `Metadata variant ${index}`,
        }),
      );
    }

    const manifest = await scanHarewoodFolder({
      source: tempRoot,
      sourceId: "duplicate-bundle-test",
      pdfMode: "normalized",
    });

    assert.equal(new Set(manifest.evidenceObjects.map((item) => item.exactSha256)).size, 8);
    assert.equal(new Set(manifest.evidenceObjects.map((item) => item.normalizedDocumentHash)).size, 1);
    assert.equal(manifest.stats.sourceFileCount, 8);
    assert.equal(manifest.stats.canonicalDocumentCount, 1);
    assert.equal(manifest.stats.duplicateSourceFileCount, 7);
    assert.equal(manifest.stats.normalizedDuplicateGroupCount, 1);
    assert.equal(manifest.canonicalDocuments[0].occurrenceCount, 8);
    assert.equal(manifest.canonicalDocuments[0].duplicateMultiplicityCap, 1);
  },
);

test(
  "image-only PDF normalization hashes isolated raster output without cwd scratch files",
  { skip: !pdfToolsAvailable },
  async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "finance-ingest-image-pdf-"));
    await writeFile(path.join(tempRoot, "scan-a.pdf"), buildPdf({ pages: [""], title: "A" }));
    await writeFile(path.join(tempRoot, "scan-b.pdf"), buildPdf({ pages: [""], title: "B" }));

    const manifest = await scanHarewoodFolder({
      source: tempRoot,
      sourceId: "image-only-test",
      pdfMode: "normalized",
    });

    assert.equal(manifest.stats.canonicalDocumentCount, 1);
    assert.ok(manifest.evidenceObjects.every((item) => item.pages[0].visualHash));
    assert.ok(manifest.evidenceObjects.every((item) => item.pages[0].normalizationBasis === "visual"));
    await assert.rejects(access(path.join(process.cwd(), "-.pgm")), { code: "ENOENT" });
  },
);

test("quotes and settlement evidence cannot masquerade as purchase evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "finance-ingest-roles-"));
  await writeFile(path.join(tempRoot, "Vendor Invoice.txt"), "Tax invoice for equipment");
  await writeFile(path.join(tempRoot, "Vendor Quote.txt"), "Quotation only");
  await writeFile(path.join(tempRoot, "noticeOfPaymentSingle.txt"), "Payment confirmation");
  await writeFile(path.join(tempRoot, "Statement for account.txt"), "Account statement");

  const manifest = await scanHarewoodFolder({
    source: tempRoot,
    sourceId: "role-test",
    pdfMode: "exact",
  });
  const byName = Object.fromEntries(manifest.evidenceObjects.map((item) => [item.fileName, item]));

  assert.equal(byName["Vendor Invoice.txt"].role, "invoice");
  assert.equal(byName["Vendor Invoice.txt"].purchaseEvidenceCandidate, true);
  assert.equal(byName["Vendor Quote.txt"].role, "quote");
  assert.equal(byName["Vendor Quote.txt"].countingPolicy, "do_not_count_as_cost");
  assert.equal(byName["noticeOfPaymentSingle.txt"].role, "proof_of_payment");
  assert.equal(byName["noticeOfPaymentSingle.txt"].financialFactRole, "settlement_evidence");
  assert.equal(byName["Statement for account.txt"].role, "statement");
  assert.equal(manifest.stats.purchaseEvidenceCandidateCanonicalCount, 1);
});

test("historical register and workbook rows remain unverified, non-counting seeds", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "finance-ingest-history-"));
  const outputs = path.join(tempRoot, "03 Outputs");
  await mkdir(outputs, { recursive: true });
  await writeFile(
    path.join(outputs, "invoice_register_enriched.csv"),
    'rel_path,ext,amount_guess,notes\n"Invoices/one.pdf",pdf,125.50,"prior guess"\n"Invoices/two.pdf",pdf,,"needs review"\n',
  );
  await buildMinimalXlsx(path.join(outputs, "202602_prov_tax_pack.xlsx"));

  const first = await scanHistoricalPack({ source: tempRoot, sourceId: "history-test" });
  const second = await scanHistoricalPack({ source: tempRoot, sourceId: "history-test" });

  assert.equal(first.historicalSeeds.invoiceRegister.rowCount, 2);
  assert.equal(first.historicalSeeds.workbook.sheetCount, 1);
  assert.deepEqual(first, second);
  assert.ok(
    first.historicalSeeds.invoiceRegister.rows.every(
      (row) =>
        row.interpretationStatus === "historical_unverified" &&
        row.countingPolicy === "do_not_count_directly",
    ),
  );
  assert.ok(
    first.historicalSeeds.workbook.sheets[0].rows.every(
      (row) =>
        row.interpretationStatus === "historical_unverified" &&
        row.countingPolicy === "do_not_count_directly",
    ),
  );
});

test("XLSX XML parsing preserves sheet identity, row values, and formulas", () => {
  const metadata = parseWorkbookMetadata(
    '<workbook><sheets><sheet name="Checks &amp; Audit" sheetId="7" r:id="rId7"/></sheets></workbook>',
    '<Relationships><Relationship Id="rId7" Target="worksheets/sheet7.xml"/></Relationships>',
  );
  assert.deepEqual(metadata, [
    {
      name: "Checks & Audit",
      sheetId: "7",
      state: "visible",
      entryPath: "xl/worksheets/sheet7.xml",
    },
  ]);

  const worksheet = parseWorksheetXml(
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>SUM(A2:B2)</f><v>3</v></c></row></sheetData></worksheet>',
    ["Header"],
  );
  assert.deepEqual(worksheet.rows[0].values, ["Header", "", "3"]);
  assert.equal(worksheet.rows[0].formulas.C1, "SUM(A2:B2)");
});

test("role inference distinguishes reimbursement evidence", () => {
  const role = inferDocumentRole("Kettle payment to helper.png");
  assert.equal(role.role, "reimbursement_evidence");
  assert.equal(role.countingPolicy, "do_not_count_as_cost");
});

test("sensitive output inside the repository must be gitignored", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  assert.throws(
    () => assertLocalOutputPath(path.join(repoRoot, "finance-output-that-must-not-exist"), repoRoot),
    /Refusing to write sensitive finance output/,
  );
  assert.equal(
    assertLocalOutputPath(path.join(repoRoot, ".finance-local", "finance-ingest"), repoRoot),
    path.join(repoRoot, ".finance-local", "finance-ingest"),
  );
});

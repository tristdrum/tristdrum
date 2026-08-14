import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function escapePdfText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function buildPdf({ pages, title }) {
  const objectBodies = new Map();
  const pageObjectNumbers = [];
  const fontObjectNumber = 3 + pages.length * 2;
  const infoObjectNumber = fontObjectNumber + 1;

  objectBodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");

  pages.forEach((text, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    objectBodies.set(
      pageObjectNumber,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
    );
    objectBodies.set(
      contentObjectNumber,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });

  objectBodies.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objectBodies.set(fontObjectNumber, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objectBodies.set(
    infoObjectNumber,
    `<< /Title (${escapePdfText(title)}) /CreationDate (D:20260814${String(title.length).padStart(2, "0")}0000) >>`,
  );

  const chunks = ["%PDF-1.4\n%finance-ingest-test\n"];
  const offsets = [0];
  for (let objectNumber = 1; objectNumber <= infoObjectNumber; objectNumber += 1) {
    offsets[objectNumber] = Buffer.byteLength(chunks.join(""));
    chunks.push(`${objectNumber} 0 obj\n${objectBodies.get(objectNumber)}\nendobj\n`);
  }

  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${infoObjectNumber + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let objectNumber = 1; objectNumber <= infoObjectNumber; objectNumber += 1) {
    chunks.push(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${infoObjectNumber + 1} /Root 1 0 R /Info ${infoObjectNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  return Buffer.from(chunks.join(""), "binary");
}

export async function buildMinimalXlsx(workbookPath) {
  const buildRoot = path.join(path.dirname(workbookPath), "xlsx-build");
  await mkdir(path.join(buildRoot, "xl", "_rels"), { recursive: true });
  await mkdir(path.join(buildRoot, "xl", "worksheets"), { recursive: true });

  await writeFile(
    path.join(buildRoot, "xl", "workbook.xml"),
    '<?xml version="1.0"?><workbook xmlns:r="relationships"><sheets><sheet name="Invoices Register" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  await writeFile(
    path.join(buildRoot, "xl", "_rels", "workbook.xml.rels"),
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  await writeFile(
    path.join(buildRoot, "xl", "sharedStrings.xml"),
    '<?xml version="1.0"?><sst><si><t>Item</t></si><si><t>Amount</t></si><si><t>Example invoice</t></si></sst>',
  );
  await writeFile(
    path.join(buildRoot, "xl", "worksheets", "sheet1.xml"),
    '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>125.50</v></c></row></sheetData></worksheet>',
  );

  execFileSync("zip", ["-q", "-r", workbookPath, "xl"], { cwd: buildRoot });
}

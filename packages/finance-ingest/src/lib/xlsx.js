import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { decodeXml, parseXmlAttributes } from "./text.js";

const execFileAsync = promisify(execFile);
const MAX_WORKBOOK_BYTES = 128 * 1024 * 1024;

async function readZipEntry(workbookPath, entryPath, { optional = false } = {}) {
  try {
    const { stdout } = await execFileAsync("unzip", ["-p", workbookPath, entryPath], {
      encoding: "utf8",
      maxBuffer: MAX_WORKBOOK_BYTES,
    });
    return stdout;
  } catch (error) {
    if (optional) {
      return null;
    }
    throw new Error(`Cannot read XLSX entry ${entryPath}`, { cause: error });
  }
}

export function parseSharedStrings(xml = "") {
  const values = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => decodeXml(part[1]))
      .join("");
    values.push(text);
  }
  return values;
}

export function parseWorkbookMetadata(workbookXml, relationshipXml) {
  const relationships = new Map();
  for (const match of relationshipXml.matchAll(/<Relationship\b([^>]*?)(?:\/>|>)/g)) {
    const attributes = parseXmlAttributes(match[1]);
    if (attributes.Id && attributes.Target) {
      relationships.set(attributes.Id, attributes.Target);
    }
  }

  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)(?:\/>|>)/g)) {
    const attributes = parseXmlAttributes(match[1]);
    const target = relationships.get(attributes["r:id"]);
    if (!attributes.name || !target) {
      continue;
    }

    const entryPath = target.startsWith("/")
      ? target.replace(/^\//, "")
      : path.posix.normalize(path.posix.join("xl", target));
    sheets.push({
      name: attributes.name,
      sheetId: attributes.sheetId ?? null,
      state: attributes.state ?? "visible",
      entryPath,
    });
  }
  return sheets;
}

function columnIndexFromCellReference(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) {
    return null;
  }

  let result = 0;
  for (const letter of letters) {
    result = result * 26 + (letter.charCodeAt(0) - 64);
  }
  return result - 1;
}

function parseCellValue(cellBody, type, sharedStrings) {
  if (type === "inlineStr") {
    return [...cellBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) => decodeXml(match[1]))
      .join("");
  }

  const rawValue = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (rawValue === undefined) {
    return "";
  }
  const decoded = decodeXml(rawValue);

  if (type === "s") {
    return sharedStrings[Number(decoded)] ?? "";
  }
  if (type === "b") {
    return decoded === "1";
  }
  return decoded;
}

export function parseWorksheetXml(xml, sharedStrings = []) {
  const rows = [];
  let maximumColumnCount = 0;

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttributes = parseXmlAttributes(rowMatch[1]);
    const values = [];
    const formulas = {};
    let fallbackColumn = 0;

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = parseXmlAttributes(cellMatch[1]);
      const body = cellMatch[2] ?? "";
      const columnIndex = attributes.r
        ? columnIndexFromCellReference(attributes.r)
        : fallbackColumn;
      if (columnIndex === null) {
        continue;
      }

      values[columnIndex] = parseCellValue(body, attributes.t, sharedStrings);
      const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
      if (formula !== undefined) {
        formulas[attributes.r ?? String(columnIndex + 1)] = decodeXml(formula);
      }
      fallbackColumn = columnIndex + 1;
    }

    for (let index = 0; index < values.length; index += 1) {
      if (values[index] === undefined) {
        values[index] = "";
      }
    }

    maximumColumnCount = Math.max(maximumColumnCount, values.length);
    rows.push({
      rowNumber: Number(rowAttributes.r) || rows.length + 1,
      values,
      formulas,
    });
  }

  return { rows, rowCount: rows.length, columnCount: maximumColumnCount };
}

export async function readXlsxWorkbook(workbookPath) {
  const [workbookXml, relationshipXml, sharedStringsXml] = await Promise.all([
    readZipEntry(workbookPath, "xl/workbook.xml"),
    readZipEntry(workbookPath, "xl/_rels/workbook.xml.rels"),
    readZipEntry(workbookPath, "xl/sharedStrings.xml", { optional: true }),
  ]);
  const sharedStrings = parseSharedStrings(sharedStringsXml ?? "");
  const metadata = parseWorkbookMetadata(workbookXml, relationshipXml);
  const sheets = [];

  for (const sheet of metadata) {
    const worksheetXml = await readZipEntry(workbookPath, sheet.entryPath);
    const parsed = parseWorksheetXml(worksheetXml, sharedStrings);
    sheets.push({ ...sheet, ...parsed });
  }

  return { sheets };
}

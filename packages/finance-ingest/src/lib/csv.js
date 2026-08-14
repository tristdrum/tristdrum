import { readFile } from "node:fs/promises";

export function parseCsv(rawValue) {
  const value = rawValue.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((cell) => cell !== ""));
}

function uniqueHeaders(rawHeaders) {
  const occurrences = new Map();
  return rawHeaders.map((rawHeader, index) => {
    const base = rawHeader.trim() || `column_${index + 1}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return occurrence === 1 ? base : `${base}__${occurrence}`;
  });
}

export function rowsToObjects(rows) {
  if (rows.length === 0) {
    return { columns: [], rows: [] };
  }

  const columns = uniqueHeaders(rows[0]);
  return {
    columns,
    rows: rows.slice(1).map((cells) =>
      Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""])),
    ),
  };
}

export async function readCsvObjects(filePath) {
  const raw = await readFile(filePath, "utf8");
  return rowsToObjects(parseCsv(raw));
}

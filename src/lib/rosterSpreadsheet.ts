import type { RosterExportFormat } from "@/types";

const textEncoder = new TextEncoder();
const XLSX_MAX_ROWS = 1_048_576;
const XLSX_MAX_COLUMNS = 16_384;
const XLSX_MAX_CELL_LENGTH = 32_767;

/**
 * Serialize a payer roster as a deterministic UTF-8 CSV or single-sheet XLSX.
 * CSV records use RFC 4180 quoting and CRLF line endings. CSV cells beginning
 * with a formula marker after whitespace/control prefixes get a leading
 * apostrophe; XLSX cells are written as explicit inline strings.
 */
export function serializeRosterFile(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  format: RosterExportFormat,
): Uint8Array {
  if (headers.length === 0) throw new Error("Roster export needs at least one column.");
  for (const [index, row] of rows.entries()) {
    if (row.length !== headers.length) {
      throw new Error(
        `Roster row ${index + 1} has ${row.length} cells; expected ${headers.length}.`,
      );
    }
  }
  if (format === "csv") return serializeCsv(headers, rows);
  if (format === "xlsx") return serializeXlsx(headers, rows);
  throw new Error("Roster export format must be CSV or XLSX.");
}

function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): Uint8Array {
  const records = [headers, ...rows].map((record) => record.map(quoteCsvCell).join(","));
  return textEncoder.encode(`${records.join("\r\n")}\r\n`);
}

function quoteCsvCell(value: string): string {
  const safeValue = formulaSafeCsvText(value);
  if (/[",\r\n]/.test(safeValue)) return `"${safeValue.replace(/"/g, '""')}"`;
  return safeValue;
}

function formulaSafeCsvText(value: string): string {
  let firstVisible = 0;
  while (firstVisible < value.length) {
    const codePoint = value.codePointAt(firstVisible);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    if (!(codePoint <= 0x20 || /\s/u.test(char))) break;
    firstVisible += char.length;
  }
  const first = value[firstVisible];
  if (first === "=" || first === "+" || first === "-" || first === "@") return `'${value}`;
  return value;
}

function serializeXlsx(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): Uint8Array {
  const matrix = [headers, ...rows];
  if (matrix.length > XLSX_MAX_ROWS) {
    throw new Error(
      `XLSX supports at most ${XLSX_MAX_ROWS.toLocaleString()} rows including the header.`,
    );
  }
  if (headers.length > XLSX_MAX_COLUMNS) {
    throw new Error(`XLSX supports at most ${XLSX_MAX_COLUMNS.toLocaleString()} columns.`);
  }

  const sheetRows = matrix.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((value, columnIndex) => {
      const cell = String(value ?? "");
      validateXlsxCell(cell, rowNumber, columnIndex + 1);
      return `<c r="${cellReference(columnIndex + 1, rowNumber)}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
    });
    return `<row r="${rowNumber}">${cells.join("")}</row>`;
  });
  const lastColumn = cellColumnName(headers.length);
  const lastRow = matrix.length;
  const worksheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetData>${sheetRows.join("")}</sheetData>` +
    `</worksheet>`;

  const files: ReadonlyArray<readonly [string, string]> = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Roster" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `</Relationships>`,
    ],
    ["xl/worksheets/sheet1.xml", worksheet],
  ];
  return makeStoredZip(
    files.map(([path, contents]) => [path, textEncoder.encode(contents)] as const),
  );
}

function validateXlsxCell(value: string, row: number, column: number) {
  if (value.length > XLSX_MAX_CELL_LENGTH) {
    throw new Error(
      `XLSX cell ${cellColumnName(column)}${row} exceeds Excel's ${XLSX_MAX_CELL_LENGTH.toLocaleString()} character limit.`,
    );
  }
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    const valid =
      point === 0x09 ||
      point === 0x0a ||
      point === 0x0d ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
    if (!valid) {
      throw new Error(
        `XLSX cell ${cellColumnName(column)}${row} contains a character Excel cannot store.`,
      );
    }
  }
}

function escapeXml(value: string): string {
  // XML normalizes literal carriage returns in text nodes to line feeds. A
  // character reference preserves the original CR and CRLF values on readback.
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r/g, "&#13;");
}

function cellColumnName(columnNumber: number): string {
  let current = columnNumber;
  let output = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    current = Math.floor((current - 1) / 26);
  }
  return output;
}

function cellReference(columnNumber: number, rowNumber: number): string {
  return `${cellColumnName(columnNumber)}${rowNumber}`;
}

function makeStoredZip(files: ReadonlyArray<readonly [string, Uint8Array]>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  let centralSize = 0;

  for (const [path, body] of files) {
    const name = textEncoder.encode(path);
    const checksum = crc32(body);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, body.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, body);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, body.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + body.length;
    centralSize += centralHeader.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

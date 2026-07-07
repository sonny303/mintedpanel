// CSV helpers. `toCsv` is the pure serializer (a 2D array of cells → CSV text);
// `downloadCsvText` / `downloadCsv` add the browser download I/O on top.

export type CsvCell = string | number | null | undefined;

function escapeCell(v: CsvCell): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialize a 2D array of cells into CSV text (LF line breaks, RFC4180 quoting). */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\n");
}

/** Trigger a browser download of already-serialized CSV text. */
export function downloadCsvText(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Serialize a 2D array of cells and trigger a browser download. */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  downloadCsvText(filename, toCsv(rows));
}

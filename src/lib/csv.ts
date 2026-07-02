// CSV export helper. Serializes a 2D array of cells into a CSV file and
// triggers a browser download with the given filename.

export type CsvCell = string | number | null | undefined;

export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const escape = (v: CsvCell): string => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Client-facing and staff-facing CSV export engine for Transparent Enrollment Explorer.
// Formula injection protection: prepends a leading single quote (') to cells starting with =, +, -, @.
// Identifier protection: preserves leading zeros on NPIs, TINs, and tracking numbers.
// Role-scoped: callers must provide pre-authorized records matching caller context.

export interface EnrollmentExportRecord {
  providerName: string;
  npi: string;
  discipline: string;
  groupName: string;
  payerName: string;
  productName: string;
  state: string;
  facilityName: string;
  status: string;
  publicationState: string;
  effectiveDate?: string | null;
  actionOwner?: string | null;
  blockerReason?: string | null;
  payerReference?: string | null;
  retroWindow?: string | null;
  proofCount?: number;
}

export const CSV_COLUMNS = [
  "Provider Name",
  "NPI",
  "Discipline",
  "Provider Group",
  "Payer",
  "Product",
  "State",
  "Facility",
  "Status",
  "Publication State",
  "Effective Date",
  "Action Owner",
  "Blocker Reason",
  "Payer Reference #",
  "Retro Window",
  "Proof Count",
] as const;

/**
 * Escapes formula characters (=, +, -, @) to prevent CSV formula injection
 * and safely wraps fields containing commas, double quotes, or newlines according to RFC 4180.
 */
export function sanitizeCsvValue(value: unknown): string {
  if (value == null) return "";
  let str = String(value);

  // If the cell starts with a formula trigger (=, +, -, @), prefix with a single quote (')
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180: wrap in double quotes if it contains quotes, commas, or line breaks
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Formats numeric business identifiers (NPI, TIN, tracking numbers) so that spreadsheet
 * applications (Excel, Google Sheets) preserve leading zeros without formula execution.
 */
export function formatTextIdentifier(id: string | null | undefined): string {
  if (!id) return "";
  const trimmed = id.trim();
  if (!trimmed) return "";
  return sanitizeCsvValue(`'${trimmed}`);
}

/**
 * Builds standard RFC 4180 CSV string with UTF-8 BOM for Excel compatibility.
 */
export function generateEnrollmentExplorerCsv(records: readonly EnrollmentExportRecord[]): string {
  const headerRow = CSV_COLUMNS.map(sanitizeCsvValue).join(",");

  const rows = records.map((rec) => {
    return [
      sanitizeCsvValue(rec.providerName),
      formatTextIdentifier(rec.npi),
      sanitizeCsvValue(rec.discipline),
      sanitizeCsvValue(rec.groupName),
      sanitizeCsvValue(rec.payerName),
      sanitizeCsvValue(rec.productName),
      sanitizeCsvValue(rec.state),
      sanitizeCsvValue(rec.facilityName),
      sanitizeCsvValue(rec.status),
      sanitizeCsvValue(rec.publicationState),
      sanitizeCsvValue(rec.effectiveDate ?? ""),
      sanitizeCsvValue(rec.actionOwner ?? ""),
      sanitizeCsvValue(rec.blockerReason ?? ""),
      sanitizeCsvValue(rec.payerReference ?? ""),
      sanitizeCsvValue(rec.retroWindow ?? ""),
      sanitizeCsvValue(rec.proofCount != null ? String(rec.proofCount) : "0"),
    ].join(",");
  });

  // Prefix with UTF-8 BOM so Excel opens special characters cleanly
  return "\uFEFF" + [headerRow, ...rows].join("\r\n");
}

/**
 * Triggers a browser download of the generated CSV file.
 */
export function downloadCsvFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

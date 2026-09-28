import type { EnrollmentReportCsvRecord } from "@/types";

export const ENROLLMENT_REPORT_CSV_MAX_ROWS = 100_000;
export const ENROLLMENT_REPORT_CSV_MAX_BYTES = 25 * 1024 * 1024;

export const ENROLLMENT_REPORT_CSV_HEADERS = [
  "Provider Name",
  "NPI",
  "Discipline",
  "Group",
  "Payer",
  "Product",
  "State",
  "Facility",
  "Status",
  "Publication State",
  "Intake Date",
  "Complete to Submit Date",
  "Submitted Date",
  "Payer Acknowledged Date",
  "Approved Date",
  "Effective Date",
  "Termination Date",
  "Current Application Cycle",
  "Payer Reference",
  "Retro Type",
  "Retro Value",
  "Retro Basis",
  "Client-safe Blocker",
  "Owner",
  "Reviewed As Of",
  "Proof Label",
  "Proof Type",
  "Authenticated Report URL",
] as const;

type CsvField = keyof EnrollmentReportCsvRecord;

const CSV_FIELDS: readonly CsvField[] = [
  "providerName",
  "npi",
  "discipline",
  "groupLabel",
  "payerLabel",
  "productLabel",
  "state",
  "facilityLabel",
  "status",
  "publicationState",
  "intakeDate",
  "completeToSubmitDate",
  "submittedDate",
  "payerAcknowledgedDate",
  "approvedDate",
  "effectiveDate",
  "terminationDate",
  "cycleNo",
  "payerReference",
  "retroType",
  "retroValue",
  "retroBasis",
  "clientSafeBlocker",
  "owner",
  "reviewedAsOf",
  "proofLabel",
  "proofType",
  "authenticatedReportUrl",
];

const utf8 = new TextEncoder();
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SPREADSHEET_FORMULA = /^\s*[=+\-@]/;

export type EnrollmentReportCsvResult =
  | { ok: true; csv: string; rowCount: number; byteLength: number }
  | { ok: false; reason: "row_limit" | "byte_limit"; rowCount: number; byteLength: number };

function csvValue(value: string | number | null): string {
  if (value == null) return "";
  let safe = String(value).replace(CONTROL_CHARACTERS, " ");
  if (SPREADSHEET_FORMULA.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
}

function recordLine(record: EnrollmentReportCsvRecord): string {
  return CSV_FIELDS.map((field) => csvValue(record[field])).join(",");
}

function headerLine(): string {
  return ENROLLMENT_REPORT_CSV_HEADERS.map((header) => csvValue(header)).join(",");
}

/** Build the whole allowlisted artifact or return a cap result without partial CSV. */
export function serializeEnrollmentReportCsv(
  records: readonly EnrollmentReportCsvRecord[],
): EnrollmentReportCsvResult {
  if (records.length > ENROLLMENT_REPORT_CSV_MAX_ROWS) {
    return {
      ok: false,
      reason: "row_limit",
      rowCount: records.length,
      byteLength: 0,
    };
  }

  const chunks = [headerLine()];
  let byteLength = utf8.encode(chunks[0]).byteLength;
  if (byteLength > ENROLLMENT_REPORT_CSV_MAX_BYTES) {
    return { ok: false, reason: "byte_limit", rowCount: records.length, byteLength };
  }

  for (const record of records) {
    const line = `\r\n${recordLine(record)}`;
    byteLength += utf8.encode(line).byteLength;
    if (byteLength > ENROLLMENT_REPORT_CSV_MAX_BYTES) {
      return { ok: false, reason: "byte_limit", rowCount: records.length, byteLength };
    }
    chunks.push(line);
  }

  return { ok: true, csv: chunks.join(""), rowCount: records.length, byteLength };
}

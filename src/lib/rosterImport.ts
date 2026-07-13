// Bulk roster import — the pure core (redesign E3.0). Everything deterministic
// lives here with NO I/O: the canonical template header list (the SINGLE source
// shared by the downloadable template and the front gate, F3.0.2), the
// exact-match header gate (TE-4), the client-side file checks (.csv + the 10 MB
// ceiling), the per-row scan (required fields, format checks, the TE-6 full-SSN
// guard), the ~500-row chunk boundaries the batched staging RPC consumes (TE-3),
// and the error-report assembly (row, column, reason — [r5] decision 6).
//
// The RFC4180 record parser + date coercion are REUSED from the Epic 2c core
// (src/lib/csvImport.ts, TE-1) — but not its forgiving by-name column mapper:
// the E3.0 gate is exact (missing / extra / renamed columns reject the file
// before any row work), the opposite posture.
//
// SSN safety (TE-6): a 9-digit or NNN-NN-NNNN value is a blocked-row error —
// NEVER truncated into a last-4, never echoed in an error message, and the
// offending cell is REDACTED from `raw` before the row can be persisted. Only a
// validated 4-digit value from the dedicated ssn_last4 column ever reaches
// `mapped`.
import { coerceDate, parseCsv, type CsvRecord, type ParsedCsv } from "@/lib/csvImport";
import { toCsv, type CsvCell } from "@/lib/csv";

/* ------------------------- Template + file gate ------------------------- */

// The definitive F3.0.2 header list (PM sign-off 2026-07-13). Order is the
// template's column order; the gate itself is order-insensitive.
export const ROSTER_TEMPLATE_HEADERS = [
  "group_name",
  "group_tin",
  "provider_first_name",
  "provider_middle_initial",
  "provider_last_name",
  "npi",
  "caqh_id",
  "specialty",
  "taxonomy_code",
  "license_number",
  "license_state",
  "license_issue_date",
  "license_expiration_date",
  "ssn_last4",
  "date_of_birth",
  "facility_name",
  "facility_street",
  "facility_city",
  "facility_state",
  "facility_zip",
] as const;

export type RosterHeader = (typeof ROSTER_TEMPLATE_HEADERS)[number];

export const ROSTER_TEMPLATE_FILENAME = "roster-import-template.csv";

// PM-confirmed ceiling (2026-07-13): a 10k-row roster is a few MB, so 10 MB
// clears any legitimate file. The reject message states the limit.
export const MAX_ROSTER_FILE_BYTES = 10 * 1024 * 1024;

/** The downloadable template: the canonical header row, nothing else (an
 * example row would fail the scan if uploaded back verbatim). */
export function rosterTemplateCsv(): string {
  return toCsv([[...ROSTER_TEMPLATE_HEADERS]]);
}

/** Client-side pre-checks at file pick: extension + size. Returns the reject
 * message, or null when the file may proceed to parsing. */
export function checkRosterFile(name: string, sizeBytes: number): string | null {
  if (!/\.csv$/i.test(name.trim())) {
    return "Only .csv files are accepted — download the template and save your roster as CSV.";
  }
  if (sizeBytes > MAX_ROSTER_FILE_BYTES) {
    const mb = Math.round(MAX_ROSTER_FILE_BYTES / (1024 * 1024));
    return `File is too large — the limit is ${mb} MB.`;
  }
  return null;
}

export interface HeaderGateResult {
  ok: boolean;
  /** canonical template headers absent from the file */
  missing: string[];
  /** file headers that are not template headers (renames, typos, duplicates) */
  extra: string[];
}

// F3.0.2/TE-4 — the exact-match front gate, run on parseCsv(text).headers
// (already BOM-stripped, trimmed, case-folded, space→underscore by the shared
// normalizeHeader). Defensive posture per the epic's risk note: trailing blank
// headers (Excel's trailing-comma artifact) are ignored; a blank header among
// real ones is reported as an unnamed extra column; a duplicated template
// header is an extra occurrence, not a match.
export function checkRosterHeaders(headers: string[]): HeaderGateResult {
  const trimmed = [...headers];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();

  const wanted = new Set<string>(ROSTER_TEMPLATE_HEADERS);
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const h of trimmed) {
    if (h === "") {
      extra.push("(unnamed column)");
    } else if (!wanted.has(h)) {
      extra.push(h);
    } else if (seen.has(h)) {
      extra.push(`${h} (duplicate)`);
    } else {
      seen.add(h);
    }
  }
  const missing = ROSTER_TEMPLATE_HEADERS.filter((h) => !seen.has(h));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/** The gate's user-facing reject message, naming the offending headers. */
export function headerGateMessage(result: HeaderGateResult): string | null {
  if (result.ok) return null;
  const parts: string[] = [];
  if (result.missing.length > 0) parts.push(`missing: ${result.missing.join(", ")}`);
  if (result.extra.length > 0) parts.push(`not in the template: ${result.extra.join(", ")}`);
  return `The column headers don't match the template — ${parts.join("; ")}. Download the template and re-upload.`;
}

/* ------------------------------ Row scan -------------------------------- */

const SSN_DASHED_RE = /^\d{3}-\d{2}-\d{4}$/;
const BARE_NINE_RE = /^\d{9}$/;
const NPI_RE = /^\d{10}$/;
const SSN4_RE = /^\d{4}$/;
const STATE_RE = /^[A-Za-z]{2}$/;
const TIN_RE = /^\d{2}-?\d{7}$/;
const MIDDLE_INITIAL_RE = /^[A-Za-z]\.?$/;

// Non-echoing by design (TE-6 / [r5-review] decision 3): these two messages
// must never carry the offending value.
export const SSN_REJECT_REASON =
  "A full SSN was detected and removed — provide only the last 4 digits in ssn_last4";
export const SSN_LAST4_FORMAT_REASON = "ssn_last4 must be exactly 4 digits";

export const REQUIRED_ROSTER_HEADERS: readonly RosterHeader[] = [
  "group_name",
  "group_tin",
  "provider_first_name",
  "provider_last_name",
  "npi",
  "facility_name",
];

export interface ScannedRow {
  /** 1-based physical source line (header row is line 1) */
  line: number;
  /** header → cell, SSN-redacted (TE-6) — safe to persist as import_rows.raw */
  raw: Record<string, string>;
  /** normalized values for staged rows (bare TIN, uppercased states, ISO dates), null for error rows */
  mapped: Record<string, string | null> | null;
  rowState: "staged" | "error";
  errorColumn: string | null;
  errorReason: string | null;
}

function cellOf(record: CsvRecord, index: number): string {
  return (record.fields[index] ?? "").trim();
}

// Scan ONE record against the (gate-passed, so exactly canonical) header row.
// One error per row — the first in a deterministic order: the SSN sweep, then
// row shape, then required fields, then format checks in template order. The
// SSN sweep ALWAYS redacts every offending cell from `raw`, even when an
// earlier column already decided the row's error.
export function scanRosterRecord(record: CsvRecord, headers: string[]): ScannedRow {
  const raw: Record<string, string> = {};
  let errorColumn: string | null = null;
  let errorReason: string | null = null;

  const fail = (column: string | null, reason: string) => {
    if (errorReason === null) {
      errorColumn = column;
      errorReason = reason;
    }
  };

  // TE-6 sweep — every column; the TIN column legitimately holds a bare
  // 9-digit value, but a dashed NNN-NN-NNNN rejects even there.
  headers.forEach((h, i) => {
    if (h === "") return;
    const v = cellOf(record, i);
    const ssnLike = SSN_DASHED_RE.test(v) || (BARE_NINE_RE.test(v) && h !== "group_tin");
    if (ssnLike) {
      raw[h] = "";
      fail(h, SSN_REJECT_REASON);
    } else {
      raw[h] = v;
    }
  });

  if (record.fields.length > headers.length) {
    fail(
      null,
      `Row has ${record.fields.length} values but the header row has ${headers.length} columns`,
    );
  }

  for (const h of REQUIRED_ROSTER_HEADERS) {
    if (!raw[h]) fail(h, `${h} is required`);
  }

  const tin = raw.group_tin ?? "";
  if (tin && !TIN_RE.test(tin)) {
    fail("group_tin", `group_tin must be 9 digits (or XX-XXXXXXX), got "${tin}"`);
  }
  const middle = raw.provider_middle_initial ?? "";
  if (middle && !MIDDLE_INITIAL_RE.test(middle)) {
    fail(
      "provider_middle_initial",
      `provider_middle_initial must be a single letter, got "${middle}"`,
    );
  }
  const npi = raw.npi ?? "";
  if (npi && !NPI_RE.test(npi)) {
    fail("npi", `NPI must be exactly 10 digits, got "${npi}"`);
  }
  for (const h of ["license_state", "facility_state"] as const) {
    const v = raw[h] ?? "";
    if (v && !STATE_RE.test(v)) {
      fail(h, `${h} must be a 2-letter code, got "${v}"`);
    }
  }
  const dates: Partial<Record<RosterHeader, string | null>> = {};
  for (const h of ["license_issue_date", "license_expiration_date", "date_of_birth"] as const) {
    const v = raw[h] ?? "";
    const { value, ok } = coerceDate(v);
    if (!ok) fail(h, `Invalid date "${v}" in ${h} — use YYYY-MM-DD or M/D/YYYY`);
    dates[h] = value;
  }
  const last4 = raw.ssn_last4 ?? "";
  if (last4 && !SSN4_RE.test(last4)) {
    // Non-echoing: a near-miss here may still be sensitive.
    fail("ssn_last4", SSN_LAST4_FORMAT_REASON);
  }

  if (errorReason !== null) {
    return { line: record.line, raw, mapped: null, rowState: "error", errorColumn, errorReason };
  }

  const nullable = (v: string): string | null => (v ? v : null);
  const mapped: Record<string, string | null> = {
    group_name: nullable(raw.group_name),
    group_tin: tin.replace("-", ""),
    provider_first_name: nullable(raw.provider_first_name),
    provider_middle_initial: nullable(middle ? middle.replace(".", "").toUpperCase() : ""),
    provider_last_name: nullable(raw.provider_last_name),
    npi: nullable(npi),
    caqh_id: nullable(raw.caqh_id),
    specialty: nullable(raw.specialty),
    taxonomy_code: nullable(raw.taxonomy_code),
    license_number: nullable(raw.license_number),
    license_state: nullable((raw.license_state ?? "").toUpperCase()),
    license_issue_date: dates.license_issue_date ?? null,
    license_expiration_date: dates.license_expiration_date ?? null,
    ssn_last4: nullable(last4),
    date_of_birth: dates.date_of_birth ?? null,
    facility_name: nullable(raw.facility_name),
    facility_street: nullable(raw.facility_street),
    facility_city: nullable(raw.facility_city),
    facility_state: nullable((raw.facility_state ?? "").toUpperCase()),
    facility_zip: nullable(raw.facility_zip),
  };
  return {
    line: record.line,
    raw,
    mapped,
    rowState: "staged",
    errorColumn: null,
    errorReason: null,
  };
}

/** Scan every data record of a gate-passed parse. Pure and synchronous — the
 * ASYNC part of F3.0.4 is the chunked RPC staging, not this. */
export function scanRoster(parsed: ParsedCsv): ScannedRow[] {
  return parsed.records.map((r) => scanRosterRecord(r, parsed.headers));
}

/* ------------------------- Chunking + reporting ------------------------- */

// TE-3 batch size for the stage_import_rows RPC.
export const STAGE_CHUNK_SIZE = 500;

/** Split rows into insertion batches. Boundary-exact: no empty chunks, the
 * last chunk carries the remainder. */
export function chunkRows<T>(rows: readonly T[], size: number = STAGE_CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error("Chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

export interface RowErrorRecord {
  line: number;
  column: string | null;
  reason: string;
}

/** The compact (row, column, reason) list — persisted on the run row as
 * `error_report` so the download survives the TE-7 purge of import_rows. */
export function collectRowErrors(rows: readonly ScannedRow[]): RowErrorRecord[] {
  return rows
    .filter((r) => r.rowState === "error")
    .map((r) => ({ line: r.line, column: r.errorColumn, reason: r.errorReason ?? "" }));
}

/** The downloadable error report (F3.0.4): one header row + one row per error. */
export function errorReportCsvRows(errors: readonly RowErrorRecord[]): CsvCell[][] {
  return [["row", "column", "reason"], ...errors.map((e) => [e.line, e.column ?? "", e.reason])];
}

/** The file's real (non-blank) header order — the gate is order-insensitive,
 * so the preview renders the columns as the FILE laid them out. */
export function presentHeaders(parsed: ParsedCsv): string[] {
  return parsed.headers.filter((h) => h !== "");
}

/** First data rows aligned to presentHeaders(), for the pre-processing
 * columns-and-sample-rows preview (F3.0.3). */
export function previewRows(parsed: ParsedCsv, count = 5): string[][] {
  const columns = parsed.headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h !== "")
    .map(({ i }) => i);
  return parsed.records.slice(0, count).map((r) => columns.map((i) => (r.fields[i] ?? "").trim()));
}

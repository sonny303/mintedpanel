// CSV onboarding-package import: the pure, deterministic core (Epic 2c, P6).
//
// A three-file package — facilities.csv, providers.csv,
// provider_facility_assignments.csv — is parsed, header-mapped, coerced, and
// row-validated here with NO I/O. The wizard previews the structured result and
// the commit step (src/services/importCommit.ts) feeds the mapped rows through
// the existing create services, so org-scoping + audit hold. There is no
// LLM/AI ingestion anywhere in this path.
//
// A hand-rolled RFC4180-ish parser is used (no CSV lib is a dependency and a
// heavy one is not warranted): quoted fields, embedded commas/newlines, "" as
// an escaped quote, CRLF/LF, a header row. Records carry the 1-based physical
// line where they start so every validation error can point at a source line.
import type { FacilityInput } from "@/services/orgSettings";
import type { LicenseInput, ProviderInput } from "@/services/providers";

export type ImportFile = "facilities" | "providers" | "provider_facility_assignments";

export interface CsvImportError {
  file: ImportFile;
  /** 1-based physical line in the source file; the header row is line 1. */
  line: number;
  /** the offending column (normalized header), or null for whole-row/file errors */
  column: string | null;
  message: string;
}

// A facility parsed from facilities.csv. `keys` are every identifier an
// assignment row may reference it by (the explicit `ref` column and/or the
// name); `input` is ready for createFacility once a groupId is resolved.
export interface ParsedFacility {
  keys: string[];
  input: FacilityInput;
  groupName: string | null;
  line: number;
}

export interface ParsedProvider {
  keys: string[];
  input: ProviderInput;
  groupName: string | null;
  licenses: LicenseInput[];
  line: number;
}

export interface ParsedAssignment {
  providerRef: string;
  facilityRef: string;
  isPrimary: boolean;
  line: number;
}

export interface CsvImportResult {
  facilities: ParsedFacility[];
  providers: ParsedProvider[];
  assignments: ParsedAssignment[];
  errors: CsvImportError[];
}

export interface CsvImportPackage {
  facilitiesCsv?: string | null;
  providersCsv?: string | null;
  assignmentsCsv?: string | null;
}

/* ----------------------------- CSV parser ------------------------------ */

export interface CsvRecord {
  fields: string[];
  /** 1-based physical line where this record begins */
  line: number;
}

export interface ParsedCsv {
  headers: string[];
  records: CsvRecord[];
}

// Split raw CSV text into records. Faithful to the bytes — no trimming — so the
// caller decides how forgiving to be (the mapper trims at cell read).
export function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  // Whether the current record has seen any content (char, comma, or quote).
  // Guards against emitting a record for a blank line.
  let started = false;

  const beginRecordIfNeeded = () => {
    if (!started) {
      started = true;
      recordStartLine = line;
    }
  };
  const endRecord = () => {
    fields.push(field);
    field = "";
    records.push({ fields, line: recordStartLine });
    fields = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      beginRecordIfNeeded();
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      beginRecordIfNeeded();
      fields.push(field);
      field = "";
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (started) endRecord();
      line++;
      continue;
    }
    beginRecordIfNeeded();
    field += c;
  }
  if (started) endRecord();
  return records;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// Parse into normalized headers + data records (header row removed).
export function parseCsv(text: string): ParsedCsv {
  const records = parseCsvRecords(text ?? "");
  if (records.length === 0) return { headers: [], records: [] };
  const [headerRecord, ...rest] = records;
  const headers = headerRecord.fields.map(normalizeHeader);
  return { headers, records: rest };
}

/* --------------------------- Type coercion ----------------------------- */

export interface Coerced<T> {
  value: T;
  ok: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const SLASH_ISO = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number): string => String(n).padStart(2, "0");

// Empty → null (ok). ISO, M/D/YYYY, and YYYY/M/D accepted and normalized to
// YYYY-MM-DD. Anything else → ok:false.
export function coerceDate(raw: string): Coerced<string | null> {
  const v = raw.trim();
  if (!v) return { value: null, ok: true };
  if (ISO_DATE.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return isRealDate(y, m, d) ? { value: v, ok: true } : { value: null, ok: false };
  }
  const us = US_DATE.exec(v);
  if (us) {
    const m = Number(us[1]);
    const d = Number(us[2]);
    const y = Number(us[3]);
    return isRealDate(y, m, d)
      ? { value: `${y}-${pad(m)}-${pad(d)}`, ok: true }
      : { value: null, ok: false };
  }
  const si = SLASH_ISO.exec(v);
  if (si) {
    const y = Number(si[1]);
    const m = Number(si[2]);
    const d = Number(si[3]);
    return isRealDate(y, m, d)
      ? { value: `${y}-${pad(m)}-${pad(d)}`, ok: true }
      : { value: null, ok: false };
  }
  return { value: null, ok: false };
}

const TRUE_TOKENS = new Set(["true", "yes", "y", "1", "t"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "0", "f", ""]);

// Empty → false (ok). Recognized truthy/falsey tokens coerce; anything else
// → ok:false.
export function coerceBool(raw: string): Coerced<boolean> {
  const v = raw.trim().toLowerCase();
  if (TRUE_TOKENS.has(v)) return { value: true, ok: true };
  if (FALSE_TOKENS.has(v)) return { value: false, ok: true };
  return { value: false, ok: false };
}

// Split a single cell into a trimmed, de-duplicated, non-empty string array.
// `;` and `,` (inside a quoted cell) both separate. Deterministic order.
export function coerceStringArray(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[;,\n]/)) {
    const t = part.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/* --------------------------- Cell reading ------------------------------ */

class RowReader {
  private index: Map<string, number>;
  constructor(headers: string[]) {
    this.index = new Map();
    headers.forEach((h, i) => {
      if (h && !this.index.has(h)) this.index.set(h, i);
    });
  }
  has(column: string): boolean {
    return this.index.has(column);
  }
  hasAny(...columns: string[]): boolean {
    return columns.some((c) => this.index.has(c));
  }
  // Trimmed cell value, or "" when the column is absent/blank.
  cell(record: CsvRecord, column: string): string {
    const i = this.index.get(column);
    if (i === undefined) return "";
    return (record.fields[i] ?? "").trim();
  }
}

/* --------------------------- Validation -------------------------------- */

const STATE_RE = /^[A-Za-z]{2}$/;
const NPI_RE = /^\d{10}$/;
const SSN4_RE = /^\d{4}$/;

function nullable(v: string): string | null {
  return v ? v : null;
}

// Reads a date cell, pushing a line-numbered error on a bad value.
function readDate(
  reader: RowReader,
  record: CsvRecord,
  column: string,
  file: ImportFile,
  errors: CsvImportError[],
): string | null {
  const raw = reader.cell(record, column);
  const { value, ok } = coerceDate(raw);
  if (!ok) {
    errors.push({ file, line: record.line, column, message: `Invalid date "${raw}"` });
  }
  return value;
}

function parseFacilities(csv: string, errors: CsvImportError[]): ParsedFacility[] {
  const { headers, records } = parseCsv(csv);
  const reader = new RowReader(headers);
  const out: ParsedFacility[] = [];
  if (records.length > 0 && !reader.has("name")) {
    errors.push({
      file: "facilities",
      line: 1,
      column: "name",
      message: 'facilities.csv is missing the required "name" column',
    });
    return out;
  }
  const claimed = new Map<string, number>();
  for (const record of records) {
    const name = reader.cell(record, "name");
    if (!name) {
      errors.push({
        file: "facilities",
        line: record.line,
        column: "name",
        message: "Facility name is required",
      });
      continue;
    }
    const state = reader.cell(record, "state");
    if (state && !STATE_RE.test(state)) {
      errors.push({
        file: "facilities",
        line: record.line,
        column: "state",
        message: `State must be a 2-letter code, got "${state}"`,
      });
    }
    const ref = reader.cell(record, "ref");
    const keys = Array.from(new Set([ref, name].filter(Boolean)));
    let duplicate = false;
    for (const k of keys) {
      const prev = claimed.get(k.toLowerCase());
      if (prev !== undefined) {
        errors.push({
          file: "facilities",
          line: record.line,
          column: ref && k === ref ? "ref" : "name",
          message: `Duplicate facility identifier "${k}" (also on line ${prev})`,
        });
        duplicate = true;
      }
    }
    if (duplicate) continue;
    for (const k of keys) claimed.set(k.toLowerCase(), record.line);
    out.push({
      keys,
      groupName: nullable(reader.cell(record, "group_name")),
      line: record.line,
      input: {
        name,
        street: nullable(reader.cell(record, "street")),
        city: nullable(reader.cell(record, "city")),
        state: state ? state.toUpperCase() : null,
        zip: nullable(reader.cell(record, "zip")),
      },
    });
  }
  return out;
}

function parseProviders(csv: string, errors: CsvImportError[]): ParsedProvider[] {
  const { headers, records } = parseCsv(csv);
  const reader = new RowReader(headers);
  const out: ParsedProvider[] = [];
  if (records.length > 0 && !(reader.has("first_name") && reader.has("last_name"))) {
    errors.push({
      file: "providers",
      line: 1,
      column: "first_name",
      message: 'providers.csv is missing the required "first_name"/"last_name" columns',
    });
    return out;
  }
  const claimed = new Map<string, number>();
  for (const record of records) {
    const firstName = reader.cell(record, "first_name");
    const lastName = reader.cell(record, "last_name");
    if (!firstName || !lastName) {
      errors.push({
        file: "providers",
        line: record.line,
        column: !firstName ? "first_name" : "last_name",
        message: "Provider first and last name are required",
      });
      continue;
    }
    const npi = reader.cell(record, "npi");
    if (npi && !NPI_RE.test(npi)) {
      errors.push({
        file: "providers",
        line: record.line,
        column: "npi",
        message: `NPI must be 10 digits, got "${npi}"`,
      });
    }
    const ssn = reader.cell(record, "ssn_last4");
    if (ssn && !SSN4_RE.test(ssn)) {
      errors.push({
        file: "providers",
        line: record.line,
        column: "ssn_last4",
        message: "SSN last-4 must be exactly 4 digits",
      });
    }
    const homeState = reader.cell(record, "home_state");
    if (homeState && !STATE_RE.test(homeState)) {
      errors.push({
        file: "providers",
        line: record.line,
        column: "home_state",
        message: `Home state must be a 2-letter code, got "${homeState}"`,
      });
    }
    const isNewGradRaw = reader.cell(record, "is_new_grad");
    const isNewGrad = coerceBool(isNewGradRaw);
    if (!isNewGrad.ok) {
      errors.push({
        file: "providers",
        line: record.line,
        column: "is_new_grad",
        message: `Not a boolean: "${isNewGradRaw}"`,
      });
    }

    const dateOfBirth = readDate(reader, record, "date_of_birth", "providers", errors);
    const startDate = readDate(reader, record, "start_date", "providers", errors);
    const caqhLastAttestedDate = readDate(
      reader,
      record,
      "caqh_last_attested_date",
      "providers",
      errors,
    );
    const graduationDate = readDate(reader, record, "graduation_date", "providers", errors);

    // Licenses: one detailed license from license_* columns, plus any extra
    // state-only licenses from a semicolon/comma list in license_states.
    const licenses: LicenseInput[] = [];
    const seenStates = new Set<string>();
    const licState = reader.cell(record, "license_state");
    if (reader.hasAny("license_state", "license_number", "license_type")) {
      if (licState && !STATE_RE.test(licState)) {
        errors.push({
          file: "providers",
          line: record.line,
          column: "license_state",
          message: `License state must be a 2-letter code, got "${licState}"`,
        });
      } else if (licState) {
        licenses.push({
          state: licState.toUpperCase(),
          licenseNumber: nullable(reader.cell(record, "license_number")),
          licenseType: nullable(reader.cell(record, "license_type")),
          issueDate: readDate(reader, record, "license_issue_date", "providers", errors),
          expirationDate: readDate(reader, record, "license_expiration_date", "providers", errors),
        });
        seenStates.add(licState.toUpperCase());
      }
    }
    for (const s of coerceStringArray(reader.cell(record, "license_states"))) {
      if (!STATE_RE.test(s)) {
        errors.push({
          file: "providers",
          line: record.line,
          column: "license_states",
          message: `License state must be a 2-letter code, got "${s}"`,
        });
        continue;
      }
      const up = s.toUpperCase();
      if (seenStates.has(up)) continue;
      seenStates.add(up);
      licenses.push({
        state: up,
        licenseNumber: null,
        licenseType: null,
        issueDate: null,
        expirationDate: null,
      });
    }

    const ref = reader.cell(record, "ref");
    const email = reader.cell(record, "email");
    const keys = Array.from(new Set([ref, npi, email].filter(Boolean)));
    let duplicate = false;
    for (const k of keys) {
      const prev = claimed.get(k.toLowerCase());
      if (prev !== undefined) {
        errors.push({
          file: "providers",
          line: record.line,
          column: k === ref ? "ref" : k === npi ? "npi" : "email",
          message: `Duplicate provider identifier "${k}" (also on line ${prev})`,
        });
        duplicate = true;
      }
    }
    if (duplicate) continue;
    for (const k of keys) claimed.set(k.toLowerCase(), record.line);

    out.push({
      keys,
      groupName: nullable(reader.cell(record, "group_name")),
      licenses,
      line: record.line,
      input: {
        firstName,
        lastName,
        credentials: nullable(reader.cell(record, "credentials")),
        email: nullable(email),
        phone: nullable(reader.cell(record, "phone")),
        npi: nullable(npi),
        caqhId: nullable(reader.cell(record, "caqh_id")),
        caqhLastAttestedDate,
        specialty: nullable(reader.cell(record, "specialty")),
        taxonomyCode: nullable(reader.cell(record, "taxonomy_code")),
        deaNumber: nullable(reader.cell(record, "dea_number")),
        dateOfBirth,
        ssnLast4: nullable(ssn),
        startDate,
        homeStreet: nullable(reader.cell(record, "home_street")),
        homeCity: nullable(reader.cell(record, "home_city")),
        homeState: homeState ? homeState.toUpperCase() : null,
        homeZip: nullable(reader.cell(record, "home_zip")),
        graduationDate,
        isNewGrad: isNewGrad.value,
        status: "active",
      },
    });
  }
  return out;
}

function parseAssignments(
  csv: string,
  facilities: ParsedFacility[],
  providers: ParsedProvider[],
  errors: CsvImportError[],
): ParsedAssignment[] {
  const { headers, records } = parseCsv(csv);
  const reader = new RowReader(headers);
  const out: ParsedAssignment[] = [];
  if (records.length > 0 && !(reader.has("provider_ref") && reader.has("facility_ref"))) {
    errors.push({
      file: "provider_facility_assignments",
      line: 1,
      column: "provider_ref",
      message:
        'provider_facility_assignments.csv is missing the required "provider_ref"/"facility_ref" columns',
    });
    return out;
  }
  const facilityKeys = new Set<string>();
  for (const f of facilities) for (const k of f.keys) facilityKeys.add(k.toLowerCase());
  const providerKeys = new Set<string>();
  for (const p of providers) for (const k of p.keys) providerKeys.add(k.toLowerCase());

  for (const record of records) {
    const providerRef = reader.cell(record, "provider_ref");
    const facilityRef = reader.cell(record, "facility_ref");
    if (!providerRef || !facilityRef) {
      errors.push({
        file: "provider_facility_assignments",
        line: record.line,
        column: !providerRef ? "provider_ref" : "facility_ref",
        message: "Both provider_ref and facility_ref are required",
      });
      continue;
    }
    let bad = false;
    if (!providerKeys.has(providerRef.toLowerCase())) {
      errors.push({
        file: "provider_facility_assignments",
        line: record.line,
        column: "provider_ref",
        message: `Unknown provider "${providerRef}" — no matching row in providers.csv`,
      });
      bad = true;
    }
    if (!facilityKeys.has(facilityRef.toLowerCase())) {
      errors.push({
        file: "provider_facility_assignments",
        line: record.line,
        column: "facility_ref",
        message: `Unknown facility "${facilityRef}" — no matching row in facilities.csv`,
      });
      bad = true;
    }
    if (bad) continue;
    const isPrimaryRaw = reader.cell(record, "is_primary");
    const isPrimary = coerceBool(isPrimaryRaw);
    if (!isPrimary.ok) {
      errors.push({
        file: "provider_facility_assignments",
        line: record.line,
        column: "is_primary",
        message: `Not a boolean: "${isPrimaryRaw}"`,
      });
    }
    out.push({ providerRef, facilityRef, isPrimary: isPrimary.value, line: record.line });
  }
  return out;
}

// Parse + map + validate a whole package. Pure: same input → same output.
export function parseImportPackage(pkg: CsvImportPackage): CsvImportResult {
  const errors: CsvImportError[] = [];
  const facilities = pkg.facilitiesCsv?.trim() ? parseFacilities(pkg.facilitiesCsv, errors) : [];
  const providers = pkg.providersCsv?.trim() ? parseProviders(pkg.providersCsv, errors) : [];
  const assignments = pkg.assignmentsCsv?.trim()
    ? parseAssignments(pkg.assignmentsCsv, facilities, providers, errors)
    : [];
  return { facilities, providers, assignments, errors };
}

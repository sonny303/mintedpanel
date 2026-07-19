// E3.3 TE-2/TE-3 — the three per-section import descriptors. One staging
// machine (E3.0) now serves the Provider Group, Facilities, and Providers
// sections; the only thing that differs per section is the template header
// list, the required set, and the row scan. Everything else — the exact-match
// header gate (checkHeaders), the .csv/10 MB file checks, STAGE_CHUNK_SIZE
// chunking, collectRowErrors/errorReportCsvRows, previewRows, and the TE-6 SSN
// sweep — is reused VERBATIM from src/lib/rosterImport (the E3.0 core), so
// "upload UX identical across sections" (F3.3.1) is structural.
//
// Each section's header list is DERIVED from that section's manual form so
// F3.3.1's "no more, no fewer" is literally testable:
//   - provider_group ← ProviderGroupForm / GroupFormValue
//   - facility       ← FacilityForm / FacilityInput
//   - provider       ← ProviderRosterForm / ProviderInput (the E3.0 provider
//                      subset minus the facility-creation columns)
//
// TE-3 — non-scalar form fields ride a documented FLAT encoding (a CSV cannot
// mirror a nested form verbatim):
//   - multi-value scalars (operating_states, languages_offered,
//     interpreter_languages) → one `;`-delimited column (encodeDelimited /
//     decodeDelimited below, with a documented `\;` escape for an embedded `;`);
//   - the group's billing / correspondence / credentialing blocks → prefixed
//     columns (billing_*, corr_*, cred_*); a blank corr/cred block INHERITS
//     billing at scan time (the form's "Same as billing" quick-fill);
//   - facility HOURS are omitted from the CSV (a jsonb weekly schedule, set in
//     the facility form after import — TECH-DEBT, PM Open Q1 default);
//   - provider LICENSES ride one row per license, folded into one provider on
//     commit (the E3.1 grain).
import type { CsvRecord } from "@/lib/csvImport";
import { coerceBool, coerceDate } from "@/lib/csvImport";
import { toCsv } from "@/lib/csv";
import { validatePayerAttachRow, type PayerAttachScanContext } from "@/lib/groupPayerAttach";
import type { ImportEntityKind } from "@/types";
import {
  DEFAULT_TIN_COLUMNS,
  SSN_LAST4_FORMAT_REASON,
  type ScannedRow,
  isMiddleInitial,
  isNpi,
  isSsn4,
  isStateCode,
  isTin,
  sweepSsn,
} from "@/lib/rosterImport";

export type SectionEntityKind = Exclude<ImportEntityKind, "combined">;

/* --------------------- TE-3 multi-value encode / decode -------------------- */

// Values are joined by `;`. A literal `;` inside a value is escaped `\;` and a
// literal backslash is `\\`; decode is the inverse. Items are trimmed and blank
// items dropped, so `NC;SC;CO` ⇄ ["NC","SC","CO"].
export function encodeDelimited(values: readonly string[]): string {
  return values.map((v) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;")).join(";");
}

export function decodeDelimited(cell: string): string[] {
  const out: string[] = [];
  let cur = "";
  let esc = false;
  for (const ch of cell) {
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === ";") {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (esc) cur += "\\";
  const last = cur.trim();
  if (last) out.push(last);
  return out;
}

/* ------------------------------- Descriptors ------------------------------ */

// The scan spec drives the shared kernel; buildMapped is section-specific.
interface SectionScanSpec {
  /** required non-empty headers (before the group-key rule) */
  required: readonly string[];
  /** requires group_name OR group_tin (facility / provider parent key) */
  requireGroupKey: boolean;
  /** bare-9-digit-exempt columns, also validated as a TIN */
  tinColumns: readonly string[];
  npiColumns: readonly string[];
  /** 2-letter state columns, validated only when present */
  stateColumns: readonly string[];
  dateColumns: readonly string[];
  ssn4Columns: readonly string[];
  middleInitialColumns: readonly string[];
  boolColumns: readonly string[];
  /** `;`-delimited columns: decoded + validated */
  multiValueColumns: readonly string[];
  /** multi-value columns whose items must each be a 2-letter state */
  multiValueStateColumns: readonly string[];
  /** multi-value columns that must decode to ≥1 value */
  requiredMultiValue: readonly string[];
}

// E6.2 F6.2.4 — org-context inputs some descriptors need at scan time (the
// payer-attach eligibility check resolves groups + catalog payers per row).
// The caller driving the scan supplies it; kinds that don't need it ignore it.
export interface SectionScanContext {
  payerAttach?: PayerAttachScanContext;
  /** E6.4 F6.4.6 — reference lists for the provider template's relationship
   * columns: facility/payer NAMES resolve to ids at scan time (unknown names
   * are row errors naming the column — never type-and-hope matching). */
  provider?: ProviderRelationshipScanContext;
}

export interface ProviderRelationshipScanContext {
  facilities: { id: string; name: string }[];
  payers: { id: string; name: string }[];
}

export interface SectionDescriptor {
  entityKind: SectionEntityKind;
  /** business label used in UI (Sidebar IA vocabulary) */
  label: string;
  /** ordered template columns — the SINGLE source for the download AND the gate */
  headers: readonly string[];
  templateFilename: string;
  /** helper line under the drop zone */
  helperText: string;
  spec: SectionScanSpec;
  buildMapped(ctx: MapCtx): Record<string, string | null>;
  /** E6.2 — optional org-context validation AFTER the format scan: return an
   * error to block the row, or a patch of resolved columns merged into
   * `mapped` (e.g. resolved group_id/payer_id ready for commit). */
  contextScan?(
    mapped: Record<string, string | null>,
    context: SectionScanContext | undefined,
  ):
    { error: { column: string | null; reason: string } } | { patch: Record<string, string | null> };
}

/* ------------------------------ Header lists ------------------------------ */

// provider_group ← ProviderGroupForm / GroupFormValue (E1.1). The three blocks
// flatten to prefixed columns (TE-3); operating_states is one `;`-delimited
// column.
export const GROUP_TEMPLATE_HEADERS = [
  "group_name",
  "group_tin",
  "npi_type2",
  "operating_states",
  "billing_street",
  "billing_suite",
  "billing_city",
  "billing_state",
  "billing_zip",
  "billing_contact_name",
  "billing_phone",
  "billing_fax",
  "billing_email",
  "corr_street",
  "corr_suite",
  "corr_city",
  "corr_state",
  "corr_zip",
  "corr_contact_name",
  "corr_phone",
  "corr_fax",
  "corr_email",
  "cred_street",
  "cred_suite",
  "cred_city",
  "cred_state",
  "cred_zip",
  "cred_contact_name",
  "cred_phone",
  "cred_fax",
  "cred_email",
] as const;

// facility ← FacilityForm / FacilityInput (E1.2). Hours are omitted (TE-3);
// languages/interpreters are `;`-delimited; the parent group is keyed by
// group_name or group_tin (TE-5).
export const FACILITY_TEMPLATE_HEADERS = [
  "facility_name",
  "group_name",
  "group_tin",
  "street",
  "suite",
  "city",
  "state",
  "zip",
  "county",
  "phone",
  "fax",
  "email",
  "appointment_phone",
  "contact_name",
  "accepting_new_patients",
  "languages_offered",
  "interpreter_languages",
  "ada_accessible",
  "ada_notes",
] as const;

// provider ← ProviderRosterForm / ProviderInput (E1.3). The E3.0 provider
// subset minus the facility-creation columns the combined template bundled; one
// row per license (folded on commit).
export const PROVIDER_TEMPLATE_HEADERS = [
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
  // E6.4 F6.4.6 — one row per RELATIONSHIP: repeat identity columns and vary
  // these (multi-facility / multi-enrollment; groups vary via group_name/tin).
  "facility_name",
  "enrollment_payer",
  "enrollment_state",
  "enrollment_effective_date",
] as const;

/* ------------------------------- Scan kernel ------------------------------ */

interface MapCtx {
  /** SSN-redacted cell (trimmed), "" when absent */
  cell(h: string): string;
  /** cell or null when blank */
  nullable(h: string): string | null;
  /** uppercased cell or null when blank */
  upper(h: string): string | null;
  /** ISO-normalized date or null */
  date(h: string): string | null;
  /** decoded multi-value items (uppercased for state columns) */
  multi(h: string): string[];
  /** "true" | "false" | null */
  bool(h: string): string | null;
}

const NULLABLE = (v: string): string | null => (v ? v : null);

// The section scan (E3.3 TE-3): the shared SSN sweep + shape + required checks,
// then the section's format checks in template order, then the section mapper.
// ONE error per row, deterministic order (SSN sweep first). Pure + fully
// unit-testable per section.
function scanWith(descriptor: SectionDescriptor, record: CsvRecord, headers: string[]): ScannedRow {
  const spec = descriptor.spec;
  const swept = sweepSsn(record, headers, spec.tinColumns);
  const raw = swept.raw;
  let errorColumn: string | null = swept.error?.column ?? null;
  let errorReason: string | null = swept.error?.reason ?? null;
  const fail = (column: string | null, reason: string) => {
    if (errorReason === null) {
      errorColumn = column;
      errorReason = reason;
    }
  };

  if (record.fields.length > headers.length) {
    fail(
      null,
      `Row has ${record.fields.length} values but the header row has ${headers.length} columns`,
    );
  }

  for (const h of spec.required) {
    if (!raw[h]) fail(h, `${h} is required`);
  }
  if (spec.requireGroupKey && !(raw.group_name ?? "").trim() && !(raw.group_tin ?? "").trim()) {
    fail("group_name", "A parent group is required — provide group_name or group_tin");
  }

  // Section format checks, walked in template order (deterministic).
  const dates: Record<string, string | null> = {};
  const multis: Record<string, string[]> = {};
  for (const h of headers) {
    if (h === "") continue;
    const v = raw[h] ?? "";
    if (spec.tinColumns.includes(h) && v && !isTin(v)) {
      fail(h, `${h} must be 9 digits (or XX-XXXXXXX), got "${v}"`);
    }
    if (spec.middleInitialColumns.includes(h) && v && !isMiddleInitial(v)) {
      fail(h, `${h} must be a single letter, got "${v}"`);
    }
    if (spec.npiColumns.includes(h) && v && !isNpi(v)) {
      fail(h, `${h} must be exactly 10 digits, got "${v}"`);
    }
    if (spec.stateColumns.includes(h) && v && !isStateCode(v)) {
      fail(h, `${h} must be a 2-letter code, got "${v}"`);
    }
    if (spec.dateColumns.includes(h)) {
      const { value, ok } = coerceDate(v);
      if (!ok) fail(h, `Invalid date "${v}" in ${h} — use YYYY-MM-DD or M/D/YYYY`);
      dates[h] = value;
    }
    if (spec.ssn4Columns.includes(h) && v && !isSsn4(v)) {
      // Non-echoing: a near-miss may still be sensitive.
      fail(h, SSN_LAST4_FORMAT_REASON);
    }
    if (spec.boolColumns.includes(h) && v && !coerceBool(v).ok) {
      fail(h, `${h} must be yes or no, got "${v}"`);
    }
    if (spec.multiValueColumns.includes(h)) {
      const items = decodeDelimited(v);
      multis[h] = items;
      if (spec.requiredMultiValue.includes(h) && items.length === 0) {
        fail(h, `${h} is required — provide at least one value separated by ";"`);
      }
      if (spec.multiValueStateColumns.includes(h)) {
        const bad = items.find((it) => !isStateCode(it));
        if (bad) fail(h, `${h} must be 2-letter state codes separated by ";", got "${bad}"`);
      }
    }
  }

  if (errorReason !== null) {
    return { line: record.line, raw, mapped: null, rowState: "error", errorColumn, errorReason };
  }

  const ctx: MapCtx = {
    cell: (h) => raw[h] ?? "",
    nullable: (h) => NULLABLE(raw[h] ?? ""),
    upper: (h) => NULLABLE((raw[h] ?? "").toUpperCase()),
    date: (h) => dates[h] ?? null,
    multi: (h) => {
      const items = multis[h] ?? decodeDelimited(raw[h] ?? "");
      return spec.multiValueStateColumns.includes(h) ? items.map((it) => it.toUpperCase()) : items;
    },
    bool: (h) => {
      const v = raw[h] ?? "";
      if (!v) return null;
      return coerceBool(v).value ? "true" : "false";
    },
  };
  return {
    line: record.line,
    raw,
    mapped: descriptor.buildMapped(ctx),
    rowState: "staged",
    errorColumn: null,
    errorReason: null,
  };
}

/* ------------------------- Block-inheritance helper ------------------------ */

const GROUP_BLOCK_FIELDS = [
  "street",
  "suite",
  "city",
  "state",
  "zip",
  "contact_name",
  "phone",
  "fax",
  "email",
] as const;

// TE-3 "blank corr/cred ⇒ inherit billing": if every column of a block is
// blank, the block inherits the billing block (the form's Same-as-billing
// live-mirror). State columns are uppercased.
function groupBlock(
  ctx: MapCtx,
  prefix: "billing" | "corr" | "cred",
  billing: Record<string, string | null>,
): Record<string, string | null> {
  const anyPresent = GROUP_BLOCK_FIELDS.some((f) => ctx.cell(`${prefix}_${f}`).trim() !== "");
  const out: Record<string, string | null> = {};
  for (const f of GROUP_BLOCK_FIELDS) {
    const col = `${prefix}_${f}`;
    if (prefix !== "billing" && !anyPresent) {
      out[col] = billing[`billing_${f}`] ?? null;
    } else {
      out[col] = f === "state" ? ctx.upper(col) : ctx.nullable(col);
    }
  }
  return out;
}

/* --------------------------- The three descriptors ------------------------- */

export const GROUP_DESCRIPTOR: SectionDescriptor = {
  entityKind: "provider_group",
  label: "Provider group",
  headers: GROUP_TEMPLATE_HEADERS,
  templateFilename: "provider-group-import-template.csv",
  helperText:
    "One row per provider group. Operating states use ';' (e.g. NC;SC). Leave the correspondence/credentialing columns blank to reuse the billing address.",
  spec: {
    required: [
      "group_name",
      "group_tin",
      "billing_street",
      "billing_city",
      "billing_state",
      "billing_zip",
    ],
    requireGroupKey: false,
    tinColumns: ["group_tin"],
    npiColumns: ["npi_type2"],
    stateColumns: ["billing_state", "corr_state", "cred_state"],
    dateColumns: [],
    ssn4Columns: [],
    middleInitialColumns: [],
    boolColumns: [],
    multiValueColumns: ["operating_states"],
    multiValueStateColumns: ["operating_states"],
    requiredMultiValue: ["operating_states"],
  },
  buildMapped(ctx) {
    const billing = groupBlock(ctx, "billing", {});
    return {
      name: ctx.nullable("group_name"),
      tin: ctx.cell("group_tin") ? ctx.cell("group_tin").replace("-", "") : null,
      npi_type2: ctx.nullable("npi_type2"),
      operating_states: encodeDelimited(ctx.multi("operating_states")),
      ...billing,
      ...groupBlock(ctx, "corr", billing),
      ...groupBlock(ctx, "cred", billing),
    };
  },
};

export const FACILITY_DESCRIPTOR: SectionDescriptor = {
  entityKind: "facility",
  label: "Facility",
  headers: FACILITY_TEMPLATE_HEADERS,
  templateFilename: "facility-import-template.csv",
  helperText:
    "One row per location. The parent group is matched by group_tin then group_name — each facility belongs to exactly ONE group, so a street address shared by two groups is entered once per group (payers see per-TIN service locations). Languages use ';'. Hours are set in the facility form after import.",
  spec: {
    required: ["facility_name", "street", "city", "state", "zip"],
    requireGroupKey: true,
    tinColumns: ["group_tin"],
    npiColumns: [],
    stateColumns: ["state"],
    dateColumns: [],
    ssn4Columns: [],
    middleInitialColumns: [],
    boolColumns: ["accepting_new_patients", "ada_accessible"],
    multiValueColumns: ["languages_offered", "interpreter_languages"],
    multiValueStateColumns: [],
    requiredMultiValue: [],
  },
  buildMapped(ctx) {
    return {
      facility_name: ctx.nullable("facility_name"),
      group_name: ctx.nullable("group_name"),
      group_tin: ctx.cell("group_tin") ? ctx.cell("group_tin").replace("-", "") : null,
      street: ctx.nullable("street"),
      suite: ctx.nullable("suite"),
      city: ctx.nullable("city"),
      state: ctx.upper("state"),
      zip: ctx.nullable("zip"),
      county: ctx.nullable("county"),
      phone: ctx.nullable("phone"),
      fax: ctx.nullable("fax"),
      email: ctx.nullable("email"),
      appointment_phone: ctx.nullable("appointment_phone"),
      contact_name: ctx.nullable("contact_name"),
      accepting_new_patients: ctx.bool("accepting_new_patients"),
      languages_offered: encodeDelimited(ctx.multi("languages_offered")),
      interpreter_languages: encodeDelimited(ctx.multi("interpreter_languages")),
      ada_accessible: ctx.bool("ada_accessible"),
      ada_notes: ctx.nullable("ada_notes"),
    };
  },
};

export const PROVIDER_DESCRIPTOR: SectionDescriptor = {
  entityKind: "provider",
  label: "Provider",
  headers: PROVIDER_TEMPLATE_HEADERS,
  templateFilename: "provider-import-template.csv",
  helperText:
    "One row per provider × license (repeat rows per license — they fold into one provider). Only the last 4 SSN digits in ssn_last4. The parent group is matched by group_tin then group_name.",
  spec: {
    required: ["provider_first_name", "provider_last_name", "npi"],
    requireGroupKey: true,
    tinColumns: ["group_tin"],
    npiColumns: ["npi"],
    stateColumns: ["license_state", "enrollment_state"],
    dateColumns: [
      "license_issue_date",
      "license_expiration_date",
      "date_of_birth",
      "enrollment_effective_date",
    ],
    ssn4Columns: ["ssn_last4"],
    middleInitialColumns: ["provider_middle_initial"],
    boolColumns: [],
    multiValueColumns: [],
    multiValueStateColumns: [],
    requiredMultiValue: [],
  },
  buildMapped(ctx) {
    const middle = ctx.cell("provider_middle_initial");
    return {
      group_name: ctx.nullable("group_name"),
      group_tin: ctx.cell("group_tin") ? ctx.cell("group_tin").replace("-", "") : null,
      provider_first_name: ctx.nullable("provider_first_name"),
      provider_middle_initial: NULLABLE(middle ? middle.replace(".", "").toUpperCase() : ""),
      provider_last_name: ctx.nullable("provider_last_name"),
      npi: ctx.nullable("npi"),
      caqh_id: ctx.nullable("caqh_id"),
      specialty: ctx.nullable("specialty"),
      taxonomy_code: ctx.nullable("taxonomy_code"),
      license_number: ctx.nullable("license_number"),
      license_state: ctx.upper("license_state"),
      license_issue_date: ctx.date("license_issue_date"),
      license_expiration_date: ctx.date("license_expiration_date"),
      ssn_last4: ctx.nullable("ssn_last4"),
      date_of_birth: ctx.date("date_of_birth"),
      facility_name: ctx.nullable("facility_name"),
      enrollment_payer: ctx.nullable("enrollment_payer"),
      enrollment_state: ctx.upper("enrollment_state"),
      enrollment_effective_date: ctx.date("enrollment_effective_date"),
    };
  },
  // E6.4 F6.4.6 — resolve relationship NAMES to ids at scan time (the E6.2
  // payer-attach seam): unknown facility/payer names are row errors naming
  // the column, and the resolved ids are stamped so commit never re-resolves.
  // Rows that use no relationship column pass without context.
  contextScan(mapped, context) {
    const patch: Record<string, string | null> = {};
    const wantsFacility = Boolean(mapped.facility_name);
    const wantsEnrollment = Boolean(mapped.enrollment_payer || mapped.enrollment_state);
    if (!wantsFacility && !wantsEnrollment) return { patch };
    const ctx = context?.provider;
    if (!ctx) {
      return { error: { column: null, reason: "Reference data unavailable — retry the upload" } };
    }
    if (wantsFacility) {
      const name = (mapped.facility_name ?? "").trim().toLowerCase();
      const hit = ctx.facilities.find((f) => f.name.trim().toLowerCase() === name);
      if (!hit) {
        return {
          error: {
            column: "facility_name",
            reason: "Unknown facility — copy the exact name from the reference sheet",
          },
        };
      }
      patch.facility_id = hit.id;
    }
    if (wantsEnrollment) {
      if (!mapped.enrollment_payer || !mapped.enrollment_state) {
        return {
          error: {
            column: mapped.enrollment_payer ? "enrollment_state" : "enrollment_payer",
            reason: "An enrollment needs both enrollment_payer and enrollment_state",
          },
        };
      }
      const name = mapped.enrollment_payer.trim().toLowerCase();
      const hit = ctx.payers.find((py) => py.name.trim().toLowerCase() === name);
      if (!hit) {
        return {
          error: {
            column: "enrollment_payer",
            reason: "Unknown payer — copy the exact name from the reference sheet",
          },
        };
      }
      patch.enrollment_payer_id = hit.id;
    }
    return { patch };
  },
};

// E6.2 F6.2.4 — the group×payer attach CSV: one row per group × payer with
// ';'-delimited states, riding the SAME staging machine. The payer column
// accepts the catalog slug, name, or an alias (case-insensitive); eligibility
// (states ⊆ payer states ∩ group operating states) is enforced at scan time by
// the context scan, which delegates to the SAME validatePayerAttachRow rule
// the attach dialog derives from — the two paths cannot drift.
export const PAYER_ATTACH_TEMPLATE_HEADERS = [
  "group_name",
  "group_tin",
  "payer",
  "states",
] as const;

export const PAYER_ATTACH_DESCRIPTOR: SectionDescriptor = {
  entityKind: "payer_attach",
  label: "Payer attach",
  headers: PAYER_ATTACH_TEMPLATE_HEADERS,
  templateFilename: "payer-attach-import-template.csv",
  helperText:
    "One row per group × payer. States use ';' (e.g. NC;SC) and must sit inside both the payer's coverage and the group's operating states. The payer column takes the catalog name, slug, or an alias. The group is matched by group_tin then group_name.",
  spec: {
    required: ["payer"],
    requireGroupKey: true,
    tinColumns: ["group_tin"],
    npiColumns: [],
    stateColumns: [],
    dateColumns: [],
    ssn4Columns: [],
    middleInitialColumns: [],
    boolColumns: [],
    multiValueColumns: ["states"],
    multiValueStateColumns: ["states"],
    requiredMultiValue: ["states"],
  },
  buildMapped(ctx) {
    return {
      group_name: ctx.nullable("group_name"),
      group_tin: ctx.cell("group_tin") ? ctx.cell("group_tin").replace("-", "") : null,
      payer: ctx.nullable("payer"),
      states: encodeDelimited(ctx.multi("states")),
    };
  },
  contextScan(mapped, context) {
    const ctx = context?.payerAttach;
    if (!ctx) {
      return { error: { column: null, reason: "Payer catalog unavailable — retry the upload" } };
    }
    const result = validatePayerAttachRow(
      {
        groupName: mapped.group_name,
        groupTin: mapped.group_tin,
        payer: mapped.payer ?? "",
        states: decodeDelimited(mapped.states ?? ""),
      },
      ctx,
    );
    if ("error" in result) return result;
    // Stamp the resolved ids so the commit path never re-resolves.
    return {
      patch: { group_id: result.ok.groupId, payer_id: result.ok.payerId },
    };
  },
};

export const SECTION_DESCRIPTORS: Record<SectionEntityKind, SectionDescriptor> = {
  provider_group: GROUP_DESCRIPTOR,
  facility: FACILITY_DESCRIPTOR,
  provider: PROVIDER_DESCRIPTOR,
  payer_attach: PAYER_ATTACH_DESCRIPTOR,
};

/** E6.4 F6.4.6 — the prefilled real-names reference sheet offered beside the
 * provider template: the org's ACTUAL group names/TINs, facility names, and
 * payer names, so relationship columns are copied, never guessed. Pure. */
export function providerImportReference(
  groups: { name: string; tin?: string | null }[],
  facilities: { name: string }[],
  payers: { name: string }[],
): { filename: string; text: string } {
  const rows: string[][] = [["kind", "name", "tin"]];
  for (const g of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push(["group", g.name, g.tin ?? ""]);
  }
  for (const f of [...facilities].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push(["facility", f.name, ""]);
  }
  for (const py of [...payers].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push(["payer", py.name, ""]);
  }
  return { filename: "provider-import-reference.csv", text: toCsv(rows) };
}

export function sectionDescriptor(kind: SectionEntityKind): SectionDescriptor {
  return SECTION_DESCRIPTORS[kind];
}

/* --------------------------- Public per-section API ------------------------ */

/** The downloadable template: the section's header row only. */
export function sectionTemplateCsv(descriptor: SectionDescriptor): string {
  return toCsv([[...descriptor.headers]]);
}

/** Scan one gate-passed record against a section descriptor. */
export function scanSectionRecord(
  descriptor: SectionDescriptor,
  record: CsvRecord,
  headers: string[],
  context?: SectionScanContext,
): ScannedRow {
  const scanned = scanWith(descriptor, record, headers);
  if (scanned.rowState !== "staged" || !descriptor.contextScan || scanned.mapped === null) {
    return scanned;
  }
  const result = descriptor.contextScan(scanned.mapped, context);
  if ("error" in result) {
    return {
      ...scanned,
      mapped: null,
      rowState: "error",
      errorColumn: result.error.column,
      errorReason: result.error.reason,
    };
  }
  return { ...scanned, mapped: { ...scanned.mapped, ...result.patch } };
}

/* --------------------- TE-7 combined-template detection -------------------- */

// The retired E3.0 combined template mixed provider identity AND facility
// columns in one file — no per-section template does. Detecting that signature
// lets the gate reject a legacy combined upload with an ACTIONABLE message
// naming the three replacements (F3.3.3), instead of a generic missing/extra
// list.
export function looksLikeCombinedTemplate(headers: string[]): boolean {
  const set = new Set(headers.filter((h) => h !== ""));
  // The retired E3.0 combined template bundled provider identity with
  // facility CREATION columns (street/city). E6.4's provider template carries
  // facility_name as a pure RELATIONSHIP column, so the signature keys on the
  // address columns only the combined template ever had.
  return set.has("provider_first_name") && set.has("facility_street");
}

export const COMBINED_TEMPLATE_RETIRED_MESSAGE =
  "This looks like the retired combined roster template. Uploads are now per-section — download this section's template above (Provider Group, Facilities, or Providers) and re-upload just that section's rows.";

/* --------------------------- TE-5 ladder gate ------------------------------ */

export interface UploadGate {
  allowed: boolean;
  /** the section whose data must exist first, when blocked */
  prerequisite: SectionEntityKind | null;
}

// The org → group → facilities → providers ladder holds for uploads exactly as
// it does for the manual forms (F3.3.2): the Facilities and Providers uploads
// require ≥1 provider group; the Provider Group upload has no prerequisite. Pure
// over the same active-group scope read the wizard already derives.
export function uploadLadderGate(
  kind: SectionEntityKind,
  scope: { activeGroupCount: number },
): UploadGate {
  if ((kind === "facility" || kind === "provider") && scope.activeGroupCount < 1) {
    return { allowed: false, prerequisite: "provider_group" };
  }
  return { allowed: true, prerequisite: null };
}

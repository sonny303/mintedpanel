// The catalog of fields a user may put on an extension quick card, and the
// validator PUT /api/me/view-prefs enforces.
//
// SCHEMA-DERIVED (supersedes the E4.3 TE-16 hand-written allowlist). The list
// is now built from get_sop_field_tokens() — the SAME call the provider profile
// endpoint makes to resolve values — so the picker and the resolver can never
// disagree. The old allowlist carried 75 keys against a 151-token catalog: the
// provider group's entire correspondence block, the provider's home street/
// city/zip, and facility email/hours/effective date were all unreachable on a
// card even though the profile endpoint resolved them. Deriving fixes that
// class of bug permanently instead of one key at a time.
//
// What is EXCLUDED, and why the exclusions are the safe half:
//
//   1. Case-scoped tables (payers / msos / contracts). They never resolve on a
//      provider profile — the profile endpoint already returns them null with
//      an "resolve at fill time from the case context" reason. Offering them
//      would put permanently-blank fields on the card.
//   2. Named internal/audit columns (below). Workflow bookkeeping and PSV
//      trail — never something a coordinator types into a payer form.
//
// Everything else the token catalog exposes is offered. `provider.ssnLast4` is
// OFFERED as of 2026-07-28 (product decision): the profile endpoint already
// returns it, and it is the value payer forms actually ask for. The full SSN
// is NOT reachable here and never can be — it lives in provider_ssn_vault
// (E4.4), which get_sop_field_tokens() does not sweep, so no card field can
// ever name it. Only the two E4.4 RPCs decrypt, both audited.
//
// DRIFT IS THE RISK THIS FILE MANAGES. get_sop_field_tokens() is not a curated
// list — it reads information_schema.columns over nine named tables and drops
// only keys/FKs/status columns. Any column added to `providers`,
// `provider_groups`, `facilities`, `state_licenses`,
// `provider_facility_assignments`, or `group_insurance_policies` therefore
// becomes a token, and under a derive-then-exclude rule it would become a card
// field with no human in the loop. quickCardCatalog.test.ts closes that hole:
// it reads the checked-in src/integrations/supabase/types.ts (regenerated from
// live after every DDL, per the CLAUDE.md ritual), reconstructs the token set
// the RPC would emit, and fails when a token is in neither the offered nor the
// excluded set. A new column cannot reach a card without someone classifying
// it. Keep that test green rather than deleting it — it is the reason this file
// may safely be a deny-list.
//
// Keys are BARE catalog token keys in the camelCase `family.field` form the
// profile endpoint emits (e.g. `license.licenseNumber`); the extension's
// field-key -> profile-token join is a literal string match.

import { normalizeTokenKey } from "@/lib/tokenFormat";

/** The user_table_prefs page_key the extension quick-card layout is stored
 * under. Stable across machines/browsers (server-side, user-scoped). */
export const EXTENSION_QUICK_CARDS_PAGE_KEY = "extension.quickCards";

/** Source tables whose tokens are case-scoped: which payer? which contract?
 * The profile endpoint returns them null by design, so they are never card
 * fields. Mirrors CASE_SCOPED_TABLES in services/providerProfile.ts. */
export const CASE_SCOPED_TOKEN_TABLES: readonly string[] = ["payers", "msos", "contracts"];

/** Table -> token prefix, mirroring get_sop_field_tokens(). Only the
 * non-case-scoped tables appear: these are the six a quick card can draw from.
 * The drift test uses this as the set of tables to reconstruct. */
export const QUICK_CARD_TABLE_PREFIXES: Readonly<Record<string, string>> = {
  providers: "provider",
  provider_groups: "group",
  facilities: "facility",
  state_licenses: "license",
  provider_facility_assignments: "assignment",
  group_insurance_policies: "groupInsurance",
};

/** Columns get_sop_field_tokens() itself drops before emitting tokens (keys,
 * FKs, and row-status columns). Mirrored here ONLY so the drift test can
 * reconstruct the RPC's output from types.ts — this is not a policy list, it
 * is a copy of the RPC's behaviour. Keep in lockstep with the function body. */
export const TOKEN_CATALOG_SKIPPED_COLUMNS: readonly string[] = [
  "id",
  "org_id",
  "created_at",
  "updated_at",
  "group_id",
  "facility_id",
  "provider_id",
  "payer_id",
  "mso_id",
  "status",
  "is_active",
  "is_new_grad",
  "contracting_status_id",
];

/** Tokens excluded as internal/audit data — real columns that resolve to real
 * values, but never something a human types into a payer form. Each is a
 * deliberate product call, not an oversight; adding a column to this list is
 * how you keep it off the picker. */
export const QUICK_CARD_EXCLUDED_FIELDS: readonly string[] = [
  // providers — workflow + import/test bookkeeping
  "provider.launchId", // legacy dead FK (launch pivot); nothing reads it
  "provider.terminatedDate", // internal lifecycle, not a form field
  "provider.verificationState", // E3.1 import staging fence
  "provider.isTestProvider", // E4.2 dry-run flag
  "provider.referenceOnly", // work-surface visibility flag
  // facilities
  "facility.referenceOnly",
  "facility.statusId", // FK to status_configs; a UUID, useless on a card
  // state_licenses — the E1.3 PSV trail
  "license.verifiedBy", // actor UUID
  "license.verifiedAt",
  "license.verificationSourceUrl",
  // free-text internal notes
  "groupInsurance.notes",
];

/** The two {{user.*}} tokens the profile route appends after the catalog (R2
 * locked decision 5). They have no schema backing, so the RPC never emits
 * them — they are added here so the picker offers exactly what the profile
 * resolves. */
export const USER_TOKEN_FIELDS: readonly string[] = ["user.name", "user.email"];

/** A selectable quick-card field, ready for the picker: the join key, a human
 * label, and the group it renders under (design doc 02 §2.7 groups by
 * section). */
export interface QuickCardField {
  key: string;
  label: string;
  group: string;
  groupLabel: string;
}

/** Token-family -> section heading for the picker. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  provider: "Provider",
  group: "Provider group",
  facility: "Practice location",
  license: "State license",
  assignment: "Facility assignment",
  groupInsurance: "Malpractice / insurance",
  user: "You",
};

/** Words that read wrong in sentence case. */
const ACRONYMS: Readonly<Record<string, string>> = {
  npi: "NPI",
  tin: "TIN",
  caqh: "CAQH",
  dea: "DEA",
  ssn: "SSN",
  ada: "ADA",
  zip: "ZIP",
  url: "URL",
  id: "ID",
};

/** Labels where the derived form is accurate but unhelpful. Small on purpose —
 * the generic path should handle almost everything. */
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  "provider.npi": "NPI (Type 1)",
  "provider.ssnLast4": "SSN (last 4)",
  "group.npiType2": "Group NPI (Type 2)",
  "group.tin": "Tax ID (TIN)",
  "assignment.isPrimary": "Primary location",
};

/** camelCase token field -> human label: split on case and digit boundaries,
 * uppercase known acronyms, sentence-case the rest. `caqhLastAttestedDate` ->
 * "CAQH last attested date". */
export function humanizeTokenField(field: string): string {
  const words = field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w] ?? w);
  if (words.length === 0) return field;
  const [first, ...rest] = words;
  const head = ACRONYMS[first.toLowerCase()] ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return [head, ...rest].join(" ");
}

/** Is this token offered on a quick card? Pure policy — the two exclusion
 * rules and nothing else. Exported for the drift test. */
export function isOfferedToken(table: string, token: string): boolean {
  if (CASE_SCOPED_TOKEN_TABLES.includes(table)) return false;
  if (QUICK_CARD_EXCLUDED_FIELDS.includes(token)) return false;
  return true;
}

/** A raw get_sop_field_tokens() entry. */
export interface TokenCatalogEntry {
  table: string;
  token: string;
  column: string;
}

/** Build the quick-card catalog from the raw token catalog. Pure: the caller
 * fetches, this decides. Order is the RPC's order (providers first, then group,
 * facility, ...), with the user.* fields appended last. */
export function buildQuickCardCatalog(entries: readonly TokenCatalogEntry[]): QuickCardField[] {
  const fields: QuickCardField[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    // The catalog emits bare tokens today; normalizing pins this side to the
    // canonical form regardless (the server owns token normalization).
    const key = normalizeTokenKey(entry.token);
    if (!isOfferedToken(entry.table, key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const [group, ...fieldParts] = key.split(".");
    const field = fieldParts.join(".");
    fields.push({
      key,
      label: LABEL_OVERRIDES[key] ?? humanizeTokenField(field),
      group,
      groupLabel: GROUP_LABELS[group] ?? group,
    });
  }
  for (const key of USER_TOKEN_FIELDS) {
    if (seen.has(key)) continue;
    seen.add(key);
    const field = key.split(".").slice(1).join(".");
    fields.push({
      key,
      label: LABEL_OVERRIDES[key] ?? humanizeTokenField(field),
      group: "user",
      groupLabel: GROUP_LABELS.user,
    });
  }
  return fields;
}

export type QuickCardFieldsValidation =
  | { ok: true; fields: string[] }
  | { ok: false; message: string };

/** Validate a PUT body's `fields` into a deduplicated, ORDERED array of keys
 * drawn from the live catalog. Order is preserved as given (it IS the user's
 * layout order); a duplicate, an unknown/excluded key, or a non-string element
 * is a hard reject -> 422 at the route.
 *
 * `allowed` is the derived catalog key set, passed in by the route — this
 * function stays pure and the catalog stays single-sourced from the schema.
 * There is deliberately no length cap: the picker groups by section (design
 * doc 02 §2.7), so a long layout is a user choice, not a payload risk — the
 * closed key set already bounds the body. */
export function validateQuickCardFields(
  raw: unknown,
  allowed: ReadonlySet<string>,
): QuickCardFieldsValidation {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "fields must be an array of catalog field keys" };
  }
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { ok: false, message: "every field must be a string catalog key" };
    }
    if (!allowed.has(item)) {
      return { ok: false, message: `unknown or excluded field key: ${item}` };
    }
    if (seen.has(item)) {
      return { ok: false, message: `duplicate field key: ${item}` };
    }
    seen.add(item);
    fields.push(item);
  }
  return { ok: true, fields };
}

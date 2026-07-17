// Provider profile for the extension fill engine: one provider's token values,
// resolved server-side.
//
// get_sop_field_tokens() (SECURITY DEFINER, no args) returns the token CATALOG
// — [{ table, token, column }] — which fields exist and where they live, not
// values. This module resolves each token's VALUE for one provider by querying
// the catalog's source tables (org-scoped, explicit columns only) and picking
// one source row per table under deterministic rules:
//
//   providers                      the requested provider row
//   provider_groups               the provider's group (via group_id)
//   state_licenses                the ?state match (newest by issue_date), else
//                                 the sole license, else unresolved
//   facilities                    the ?facilityId match (validated against the
//                                 provider's org-scoped facility set — outside
//                                 it is facility_not_found, a 404), else the
//                                 provider's sole facility, else unresolved
//                                 with needsFacility flagged: with several
//                                 facilities the server never guesses (the old
//                                 primary-assignment heuristic is deliberately
//                                 gone — the client asks the user instead)
//   provider_facility_assignments the assignment row of the selected facility
//                                 (the assignment IS the provider↔facility
//                                 link, so it follows the same selection)
//   group_insurance_policies      the group's sole policy, else unresolved
//   payers / msos / contracts     never resolved here — those are case-scoped
//                                 (which payer? which contract?) and belong to
//                                 a fill-time case context, not a provider
//                                 profile
//
// Every catalog token appears in `tokens` (value null when unresolved); every
// null-by-ambiguity token also appears in `unresolved` with the reason, so the
// fill engine can tell "empty field" from "couldn't pick a source row". The
// profile also carries the provider's resolvable facility set (`facilities`)
// and which one was used (`selected_facility_id`) so the extension can render
// a facility picker.
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import { normalizeTokenKey } from "@/lib/tokenFormat";
import type { Provider } from "@/types";

export interface ProviderProfileServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

export interface ProfileToken {
  token: string;
  value: Json | null;
}

export interface UnresolvedToken {
  token: string;
  reason: string;
}

export interface ProviderProfileFacility {
  id: string;
  name: string;
}

export interface ProviderProfile {
  provider: Provider;
  tokens: ProfileToken[];
  unresolved: UnresolvedToken[];
  // The provider's resolvable facility set (org-scoped, via
  // provider_facility_assignments) and the facility the facility.*/
  // assignment.* tokens were resolved from (null when none was selectable).
  // snake_case keys are the wire contract, pinned by the route tests and the
  // isolation gate — like the R2 touches body, not the camelCase row payloads.
  facilities: ProviderProfileFacility[];
  selected_facility_id: string | null;
}

export interface ProviderProfileOptions {
  // Two-letter state filter: selects the state license (the portal being
  // filled is state-specific, mirroring sopResolver's stateLicenseNumber).
  state?: string;
  // Explicit facility selection for the facility.*/assignment.* tokens. Must
  // be in the caller's org AND the provider's facility set, else the result
  // is facility_not_found (the route's 404) — cross-org ids resolve nothing.
  facilityId?: string;
}

// getProviderProfile result: both not-found kinds map to a 404 at the route,
// with messages that tell the extension WHICH reference was bad.
export type ProviderProfileResult =
  | { kind: "ok"; profile: ProviderProfile; needsFacility: boolean }
  | { kind: "provider_not_found" }
  | { kind: "facility_not_found" };

// Explicit projections: every column the token catalog references for the
// table, plus the keys resolution needs. Never select('*') here.
const PROFILE_PROVIDER_COLUMNS =
  "id, group_id, status, first_name, last_name, credentials, date_of_birth, ssn_last4, email, phone, " +
  "home_street, home_city, home_state, home_zip, npi, caqh_id, caqh_last_attested_date, dea_number, " +
  "taxonomy_code, specialty, start_date, terminated_date, degree, school_name, graduation_date, " +
  "malpractice_carrier, malpractice_policy_number, malpractice_coverage_start, malpractice_coverage_end, " +
  "license_number, license_state, license_issue_date, license_expiration_date, middle_initial, suffix, " +
  "gender, ethnicity, dea_expiration_date, board_certified, sub_specialty, languages, medicaid_attested, " +
  "cultural_competency_training, additional_certifications, age_groups_served, launch_id";

const PROFILE_GROUP_COLUMNS =
  "id, name, tin, npi_type2, states, billing_street, billing_city, billing_state, billing_zip, " +
  "billing_suite, billing_contact_name, billing_phone, billing_fax, billing_email, " +
  "correspondence_street, correspondence_city, correspondence_state, correspondence_zip, " +
  "correspondence_suite, correspondence_contact_name, correspondence_phone, correspondence_fax, " +
  "correspondence_email, credentialing_street, credentialing_suite, credentialing_city, " +
  "credentialing_state, credentialing_zip, credentialing_contact_name, credentialing_phone, " +
  "credentialing_fax, credentialing_email, contracting_contact_name, contracting_contact_title, " +
  "contracting_contact_email, website_url, tax_id_type, preferred_contact_method, " +
  "contract_signer_name, contract_signer_email";

const PROFILE_LICENSE_COLUMNS =
  "id, state, license_number, license_type, issue_date, expiration_date";

const PROFILE_ASSIGNMENT_COLUMNS = "id, facility_id, is_primary, start_date, practice_frequency";

const PROFILE_FACILITY_COLUMNS =
  "id, name, street, city, state, zip, suite, county, phone, fax, email, appointment_phone, " +
  "contact_name, accepting_new_patients, language_line, languages_offered, interpreter_languages, " +
  "hours, ada_compliance, service_types, treating_categories, status_id, effective_date";

const PROFILE_POLICY_COLUMNS =
  "id, insurance_type, insurer_name, policy_number, policy_start_date, policy_end_date, notes";

const CASE_SCOPED_TABLES = new Set(["payers", "msos", "contracts"]);

interface CatalogEntry {
  table: string;
  token: string;
  column: string;
}

type Row = Record<string, unknown>;

// One picked source row per table, or the reason none could be picked.
interface SourcePick {
  row: Row | null;
  reason?: string;
}

function parseCatalog(raw: Json): CatalogEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error("get_sop_field_tokens() returned a non-array token catalog");
  }
  const entries: CatalogEntry[] = [];
  for (const item of raw) {
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Row).table === "string" &&
      typeof (item as Row).token === "string" &&
      typeof (item as Row).column === "string"
    ) {
      const entry = item as unknown as CatalogEntry;
      // The catalog emits bare tokens today; normalizing pins this side of
      // the extension's field-map join to the canonical form regardless
      // (see lib/tokenFormat.ts — the server owns token normalization).
      entries.push({ ...entry, token: normalizeTokenKey(entry.token) });
    }
  }
  if (entries.length === 0) {
    throw new Error("get_sop_field_tokens() returned an empty token catalog");
  }
  return entries;
}

function pickLicense(licenses: Row[], state: string | undefined): SourcePick {
  if (licenses.length === 0) return { row: null, reason: "provider has no state licenses" };
  if (state) {
    const match = licenses.find((l) => String(l.state ?? "").toUpperCase() === state);
    if (!match) return { row: null, reason: `provider has no ${state} license` };
    return { row: match };
  }
  if (licenses.length === 1) return { row: licenses[0] };
  return {
    row: null,
    reason: `provider has ${licenses.length} state licenses; pass ?state=XX to select one`,
  };
}

// Which facility (if any) the facility.*/assignment.* tokens resolve from.
// `facilities` is the provider's org-scoped facility set; an explicit
// facilityId outside it is invalid (the caller either crossed orgs or named a
// facility this provider isn't assigned to). With several facilities and no
// explicit choice the tokens stay empty and needsFacility is flagged — the
// server never guesses, not even at a primary assignment.
interface FacilitySelection {
  facility: ProviderProfileFacility | null;
  invalid: boolean;
  needsFacility: boolean;
  reason?: string;
}

function selectFacility(
  facilities: ProviderProfileFacility[],
  hasAssignments: boolean,
  facilityId: string | undefined,
): FacilitySelection {
  if (facilityId) {
    const match = facilities.find((f) => f.id === facilityId) ?? null;
    if (!match) return { facility: null, invalid: true, needsFacility: false };
    return { facility: match, invalid: false, needsFacility: false };
  }
  if (facilities.length === 1) {
    return { facility: facilities[0], invalid: false, needsFacility: false };
  }
  if (facilities.length === 0) {
    return {
      facility: null,
      invalid: false,
      needsFacility: false,
      reason: hasAssignments
        ? "assigned facility not found"
        : "provider has no facility assignments",
    };
  }
  return {
    facility: null,
    invalid: false,
    needsFacility: true,
    reason: `provider has ${facilities.length} facilities; pass ?facilityId= to select one`,
  };
}

// E4.3 F4.3.5 Q4 (PM decision 2026-07-17): a group holding SEVERAL policies
// resolves deterministically — filter to the malpractice policy
// (insurance_type 'professional_liability'), newest policy_end_date wins.
// Additive refinement: a sole policy still resolves as before (whatever its
// type), and zero-malpractice multi-policy groups stay honestly unresolved.
const MALPRACTICE_INSURANCE_TYPE = "professional_liability";

function pickPolicy(policies: Row[], hasGroup: boolean): SourcePick {
  if (!hasGroup) return { row: null, reason: "provider has no group" };
  if (policies.length === 0) return { row: null, reason: "group has no insurance policies" };
  if (policies.length === 1) return { row: policies[0] };
  const malpractice = policies.filter(
    (p) => String(p.insurance_type ?? "") === MALPRACTICE_INSURANCE_TYPE,
  );
  if (malpractice.length === 0) {
    return {
      row: null,
      reason: `group has ${policies.length} insurance policies and none is malpractice (${MALPRACTICE_INSURANCE_TYPE}); not resolvable to a single row`,
    };
  }
  // Newest policy_end_date wins; a date-less policy never beats a dated one.
  // Ties (and all-null dates) break by id so the pick is stable across reads.
  const sorted = [...malpractice].sort((a, b) => {
    const aEnd = typeof a.policy_end_date === "string" ? a.policy_end_date : "";
    const bEnd = typeof b.policy_end_date === "string" ? b.policy_end_date : "";
    if (aEnd !== bEnd) return bEnd.localeCompare(aEnd);
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  return { row: sorted[0] };
}

export async function getProviderProfile(
  ctx: ProviderProfileServiceCtx,
  providerId: string,
  options: ProviderProfileOptions = {},
): Promise<ProviderProfileResult> {
  const { db, orgId } = ctx;

  // Org membership check first: a provider in another org is a 404, the same
  // contract the isolation gate proves for the provider routes.
  const { data: providerRow, error: providerErr } = await db
    .from("providers")
    .select(PROFILE_PROVIDER_COLUMNS)
    .eq("id", providerId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (providerErr) throw providerErr;
  if (!providerRow) return { kind: "provider_not_found" };
  const provider = providerRow as unknown as Row;
  const groupId = (provider.group_id as string | null) ?? null;

  const { data: catalogRaw, error: catalogErr } = await db.rpc("get_sop_field_tokens");
  if (catalogErr) throw catalogErr;
  const catalog = parseCatalog(catalogRaw as Json);

  const [groupRes, licenseRes, assignmentRes, policyRes] = await Promise.all([
    groupId
      ? db
          .from("provider_groups")
          .select(PROFILE_GROUP_COLUMNS)
          .eq("id", groupId)
          .eq("org_id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("state_licenses")
      .select(PROFILE_LICENSE_COLUMNS)
      .eq("provider_id", providerId)
      .eq("org_id", orgId)
      .order("issue_date", { ascending: false, nullsFirst: false }),
    db
      .from("provider_facility_assignments")
      .select(PROFILE_ASSIGNMENT_COLUMNS)
      .eq("provider_id", providerId)
      .eq("org_id", orgId),
    groupId
      ? db
          .from("group_insurance_policies")
          .select(PROFILE_POLICY_COLUMNS)
          .eq("group_id", groupId)
          .eq("org_id", orgId)
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const res of [groupRes, licenseRes, assignmentRes, policyRes]) {
    if (res.error) throw res.error;
  }

  const group = (groupRes.data as Row | null) ?? null;
  const licenses = (licenseRes.data ?? []) as unknown as Row[];
  const assignments = (assignmentRes.data ?? []) as unknown as Row[];
  const policies = (policyRes.data ?? []) as unknown as Row[];

  const licensePick = pickLicense(licenses, options.state);
  const policyPick = pickPolicy(policies, group != null);

  // The provider→facility linkage is provider_facility_assignments (unique
  // (provider_id, facility_id)); the resolvable facility set is every assigned
  // facility that still exists in the caller's org. Fetched id+name only —
  // this list is part of the response payload, not a token source.
  const assignmentFacilityIds = [
    ...new Set(assignments.map((a) => a.facility_id as string).filter(Boolean)),
  ];
  let facilities: ProviderProfileFacility[] = [];
  if (assignmentFacilityIds.length > 0) {
    const { data: facilityRows, error: facilityListErr } = await db
      .from("facilities")
      .select("id, name")
      .in("id", assignmentFacilityIds)
      .eq("org_id", orgId)
      .order("name")
      .order("id");
    if (facilityListErr) throw facilityListErr;
    facilities = ((facilityRows ?? []) as Array<{ id: string; name: string | null }>).map((f) => ({
      id: f.id,
      name: f.name ?? "",
    }));
  }

  const selection = selectFacility(facilities, assignments.length > 0, options.facilityId);
  if (selection.invalid) return { kind: "facility_not_found" };
  const selectedFacilityId = selection.facility?.id ?? null;

  // The assignment row follows the facility selection — it IS the link row of
  // the selected facility, so assignment.* and facility.* always agree.
  let facilityPick: SourcePick;
  let assignmentPick: SourcePick;
  if (selectedFacilityId) {
    const { data: facilityRow, error: facilityErr } = await db
      .from("facilities")
      .select(PROFILE_FACILITY_COLUMNS)
      .eq("id", selectedFacilityId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (facilityErr) throw facilityErr;
    facilityPick = facilityRow
      ? { row: facilityRow as unknown as Row }
      : { row: null, reason: "assigned facility not found" };
    const assignmentRow = assignments.find((a) => a.facility_id === selectedFacilityId) ?? null;
    assignmentPick = assignmentRow
      ? { row: assignmentRow }
      : { row: null, reason: "assigned facility not found" };
  } else {
    const reason = selection.reason ?? "facility not resolved";
    facilityPick = { row: null, reason };
    assignmentPick = { row: null, reason };
  }

  const picks: Record<string, SourcePick> = {
    providers: { row: provider },
    provider_groups: group ? { row: group } : { row: null, reason: "provider has no group" },
    state_licenses: licensePick,
    provider_facility_assignments: assignmentPick,
    facilities: facilityPick,
    group_insurance_policies: policyPick,
  };

  const tokens: ProfileToken[] = [];
  const unresolved: UnresolvedToken[] = [];
  for (const entry of catalog) {
    if (CASE_SCOPED_TABLES.has(entry.table)) {
      tokens.push({ token: entry.token, value: null });
      unresolved.push({
        token: entry.token,
        reason: `case-scoped source (${entry.table}); resolve at fill time from the case context`,
      });
      continue;
    }
    const pick = picks[entry.table];
    if (!pick) {
      tokens.push({ token: entry.token, value: null });
      unresolved.push({ token: entry.token, reason: `unsupported source table (${entry.table})` });
      continue;
    }
    if (!pick.row) {
      tokens.push({ token: entry.token, value: null });
      unresolved.push({ token: entry.token, reason: pick.reason ?? "source row not resolved" });
      continue;
    }
    if (!(entry.column in pick.row)) {
      tokens.push({ token: entry.token, value: null });
      unresolved.push({
        token: entry.token,
        reason: `column ${entry.column} not in the ${entry.table} projection; update providerProfile.ts`,
      });
      continue;
    }
    tokens.push({ token: entry.token, value: (pick.row[entry.column] ?? null) as Json | null });
  }

  return {
    kind: "ok",
    profile: {
      provider: camelizeRow<Provider>(provider),
      tokens,
      unresolved,
      facilities,
      selected_facility_id: selectedFacilityId,
    },
    needsFacility: selection.needsFacility,
  };
}

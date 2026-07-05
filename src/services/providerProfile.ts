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
//   provider_facility_assignments the single primary assignment, else the sole
//                                 assignment, else unresolved
//   facilities                    the picked assignment's facility
//   group_insurance_policies      the group's sole policy, else unresolved
//   payers / msos / contracts     never resolved here — those are case-scoped
//                                 (which payer? which contract?) and belong to
//                                 a fill-time case context, not a provider
//                                 profile
//
// Every catalog token appears in `tokens` (value null when unresolved); every
// null-by-ambiguity token also appears in `unresolved` with the reason, so the
// fill engine can tell "empty field" from "couldn't pick a source row".
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
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

export interface ProviderProfile {
  provider: Provider;
  tokens: ProfileToken[];
  unresolved: UnresolvedToken[];
}

export interface ProviderProfileOptions {
  // Two-letter state filter: selects the state license (the portal being
  // filled is state-specific, mirroring sopResolver's stateLicenseNumber).
  state?: string;
}

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
      entries.push(item as unknown as CatalogEntry);
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

function pickAssignment(assignments: Row[]): SourcePick {
  if (assignments.length === 0) {
    return { row: null, reason: "provider has no facility assignments" };
  }
  const primary = assignments.filter((a) => a.is_primary === true);
  if (primary.length === 1) return { row: primary[0] };
  if (assignments.length === 1) return { row: assignments[0] };
  return {
    row: null,
    reason: `provider has ${assignments.length} facility assignments and no single primary; facility tokens are ambiguous`,
  };
}

function pickPolicy(policies: Row[], hasGroup: boolean): SourcePick {
  if (!hasGroup) return { row: null, reason: "provider has no group" };
  if (policies.length === 0) return { row: null, reason: "group has no insurance policies" };
  if (policies.length === 1) return { row: policies[0] };
  return {
    row: null,
    reason: `group has ${policies.length} insurance policies; not resolvable to a single row`,
  };
}

export async function getProviderProfile(
  ctx: ProviderProfileServiceCtx,
  providerId: string,
  options: ProviderProfileOptions = {},
): Promise<ProviderProfile | null> {
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
  if (!providerRow) return null;
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
  const assignmentPick = pickAssignment(assignments);
  const policyPick = pickPolicy(policies, group != null);

  let facilityPick: SourcePick;
  if (assignmentPick.row) {
    const { data: facilityRow, error: facilityErr } = await db
      .from("facilities")
      .select(PROFILE_FACILITY_COLUMNS)
      .eq("id", assignmentPick.row.facility_id as string)
      .eq("org_id", orgId)
      .maybeSingle();
    if (facilityErr) throw facilityErr;
    facilityPick = facilityRow
      ? { row: facilityRow as unknown as Row }
      : { row: null, reason: "assigned facility not found" };
  } else {
    facilityPick = { row: null, reason: assignmentPick.reason };
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

  return { provider: camelizeRow<Provider>(provider), tokens, unresolved };
}

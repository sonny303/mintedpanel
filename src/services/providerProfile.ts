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
//                                 provider's sole eligible facility, else
//                                 unresolved with needsFacility flagged: with
//                                 several facilities the server never guesses
//                                 (the old primary-assignment heuristic is gone)
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
import { composeFacilityAddressTokens, composeProviderNameTokens } from "@/lib/entityTokens";
import { pickGroupInsurancePolicy } from "@/lib/groupInsurancePick";
import { pickLicenseForState } from "@/lib/licensePick";
import { normalizeTokenKey } from "@/lib/tokenFormat";
import {
  loadContractOwnerContext,
  validateContractOwnerSelection,
  type ExpectedContractSopContext,
  type ContractOwnerContext,
} from "@/services/contractFormContext";
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
  /** Panel record route that owns a missing value; never a guessed contact. */
  recordPath?: string;
}

export interface ProviderProfileFacility {
  id: string;
  name: string;
  state?: string | null;
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
  // Exact case binding for active case fills; null is the legacy provider-only
  // profile shape. Consumers must require an exact echo for case requests.
  case_id: string | null;
  /** Present only for a Contract-owned profile request. */
  contract_context?: {
    contract_id: string;
    assignment_id: string;
    context_version: number;
    sop_template_id: string;
    sop_version: number;
  };
}

export interface ProviderProfileOptions {
  // Two-letter state filter. For ad hoc fills with an explicit facility,
  // the facility's stored state takes precedence over this client hint.
  state?: string;
  // When supplied, case-owned group/state/location context overrides provider
  // primary context. The caller validates UUID syntax at the route boundary.
  caseId?: string;
  // Explicit facility selection for the facility.*/assignment.* tokens. Must
  // be in the caller's org AND the provider's facility set, else the result
  // is facility_not_found (the route's 404) — cross-org ids resolve nothing.
  facilityId?: string;
  // Explicit group selection for group.* / groupInsurance.* tokens.
  groupId?: string;
  /** Exact Contract owner and optional optimistic context selectors. */
  contractContext?: {
    contractId: string;
    expected?: ExpectedContractSopContext;
  };
}

// getProviderProfile result: not-found kinds map to a 404 at the route,
// with messages that tell the extension WHICH reference was bad.
export type ProviderProfileResult =
  | { kind: "ok"; profile: ProviderProfile; needsFacility: boolean }
  | { kind: "provider_not_found" }
  | { kind: "facility_not_found" }
  | { kind: "group_not_found" }
  | { kind: "contract_not_found" }
  | { kind: "contract_context_not_configured"; reason: string }
  | { kind: "contract_context_mismatch"; reason: string }
  | { kind: "contract_context_stale"; reason: string };

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
  "id, insurance_type, coverage_level, insurer_name, policy_number, policy_start_date, policy_end_date, notes";

const CASE_SCOPED_TABLES = new Set(["payers", "msos", "contracts"]);
const CONTRACT_GROUP_CONTACT_TOKENS = new Set([
  "group.contractingContactName",
  "group.contractingContactTitle",
  "group.contractingContactEmail",
]);
const COMPUTED_PROFILE_TOKENS = new Set([
  "provider.fullName",
  "provider.fullNameWithCredentials",
  "provider.lastFirst",
  "facility.address",
  "facility.cityStateZip",
  "facility.streetAddress",
  "facility.fullAddress",
  "group.payerIssuedId",
]);

const COMPUTED_PROFILE_TOKEN_KEYS = [
  "provider.fullName",
  "provider.fullNameWithCredentials",
  "provider.lastFirst",
  "facility.address",
  "facility.cityStateZip",
  "facility.streetAddress",
  "facility.fullAddress",
] as const;

interface CatalogEntry {
  table: string;
  token: string;
  column: string;
}

interface ProfileCaseContext {
  id: string;
  case_type: string | null;
  provider_id: string;
  group_id: string | null;
  payer_id: string | null;
  payer_group_provider_id: string | null;
  state: string;
  facility_id: string | null;
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

// Delegates to the shared rule so the payer-PDF fill cannot pick a DIFFERENT
// license than this route would for the same provider and state. Behavior is
// unchanged; the definition simply moved (src/lib/licensePick.ts).
function pickLicense(licenses: Row[], state: string | undefined): SourcePick {
  const picked = pickLicenseForState(licenses, state);
  return picked.row ? { row: picked.row } : { row: null, reason: picked.reason };
}

function sameId(left: string | null | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function isCurrentFacilityAssignment(startDate: unknown, today: string): boolean {
  return startDate == null || (typeof startDate === "string" && startDate <= today);
}

function sameState(left: unknown, right: string): boolean {
  return typeof left === "string" && left.trim().toUpperCase() === right.trim().toUpperCase();
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
    const match = facilities.find((f) => sameId(f.id, facilityId)) ?? null;
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

/** Case locations are authoritative. Only an explicit choice or the primary
 * mirror when it is represented in case_facilities can select a row. */
function selectCaseFacility(
  facilities: ProviderProfileFacility[],
  primaryFacilityId: string | null,
  facilityId: string | undefined,
): FacilitySelection {
  if (facilityId) {
    const match = facilities.find((facility) => sameId(facility.id, facilityId)) ?? null;
    return match
      ? { facility: match, invalid: false, needsFacility: false }
      : { facility: null, invalid: true, needsFacility: false };
  }
  if (primaryFacilityId) {
    const primary = facilities.find((facility) => sameId(facility.id, primaryFacilityId)) ?? null;
    if (primary) return { facility: primary, invalid: false, needsFacility: false };
  }
  return {
    facility: null,
    invalid: false,
    needsFacility: facilities.length > 0,
    reason:
      facilities.length > 0 ? "choose a facility attached to this case" : "case has no facilities",
  };
}

// Delegates to the shared rule so the payer-PDF fill cannot pick a DIFFERENT
// policy than this route would for the same group. Behavior is unchanged; the
// definition simply moved (src/lib/groupInsurancePick.ts).
function pickPolicy(policies: Row[], hasGroup: boolean): SourcePick {
  const picked = pickGroupInsurancePolicy(policies, hasGroup);
  return picked.row ? { row: picked.row } : { row: null, reason: picked.reason };
}

export async function getProviderProfile(
  ctx: ProviderProfileServiceCtx,
  providerId: string,
  options: ProviderProfileOptions = {},
): Promise<ProviderProfileResult> {
  const { db, orgId } = ctx;
  // Do not turn explicitly empty case intent into a provider-only response if
  // another internal caller bypasses the HTTP query parser.
  if (options.caseId === "") return { kind: "provider_not_found" };
  if (options.caseId && options.contractContext) {
    return {
      kind: "contract_context_mismatch",
      reason: "Choose either a Case or Contract owner context, not both.",
    };
  }

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
  let caseContext: ProfileCaseContext | null = null;
  let contractOwner: ContractOwnerContext | null = null;
  if (options.caseId) {
    const { data: caseRow, error: caseErr } = await db
      .from("credential_cases")
      .select(
        "id, case_type, provider_id, group_id, payer_id, payer_group_provider_id, state, facility_id",
      )
      .eq("id", options.caseId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (caseErr) throw caseErr;
    if (!caseRow || !sameId(caseRow.provider_id as string | null, providerId)) {
      return { kind: "provider_not_found" };
    }
    caseContext = caseRow as unknown as ProfileCaseContext;
    if (
      caseContext.group_id != null &&
      options.groupId != null &&
      options.groupId !== caseContext.group_id
    ) {
      return { kind: "group_not_found" };
    }
  }

  if (options.contractContext) {
    const ownerResult = await loadContractOwnerContext(
      ctx,
      options.contractContext.contractId,
      options.contractContext.expected,
    );
    if (ownerResult.kind === "not_found") return { kind: "contract_not_found" };
    if (ownerResult.kind === "not_configured") {
      return { kind: "contract_context_not_configured", reason: ownerResult.reason };
    }
    if (ownerResult.kind === "stale") {
      return { kind: "contract_context_stale", reason: ownerResult.reason };
    }
    if (ownerResult.kind === "mismatch") {
      return { kind: "contract_context_mismatch", reason: ownerResult.reason };
    }
    const selection = await validateContractOwnerSelection(
      ctx,
      ownerResult.context,
      providerId,
      options.facilityId,
    );
    if (selection.kind !== "ok") {
      return { kind: "contract_context_mismatch", reason: selection.reason };
    }
    if (options.groupId && options.groupId !== ownerResult.context.contract.groupId) {
      return {
        kind: "contract_context_mismatch",
        reason: "Group selection does not match the Contract owner.",
      };
    }
    if (
      options.state &&
      options.state.toUpperCase() !== ownerResult.context.contract.state.toUpperCase()
    ) {
      return {
        kind: "contract_context_mismatch",
        reason: "State selection does not match the Contract owner.",
      };
    }
    contractOwner = ownerResult.context;
  }

  const groupId =
    contractOwner?.contract.groupId ??
    options.groupId ??
    (caseContext ? caseContext.group_id : ((provider.group_id as string | null) ?? null));

  // Group relationship check: if a groupId is resolved, the provider must be
  // affiliated with it (either as primary group, case group, or via provider_group_assignments).
  if (groupId != null) {
    const isDirectlyLinked =
      provider.group_id === groupId ||
      (caseContext?.group_id != null && caseContext.group_id === groupId);
    if (!isDirectlyLinked) {
      const { data: assignmentRow, error: assignErr } = await db
        .from("provider_group_assignments")
        .select("group_id")
        .eq("provider_id", providerId)
        .eq("group_id", groupId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (assignErr) throw assignErr;
      if (!assignmentRow) {
        return { kind: "group_not_found" };
      }
    }
  }

  const { data: catalogRaw, error: catalogErr } = await db.rpc("get_sop_field_tokens");
  if (catalogErr) throw catalogErr;
  const catalog = parseCatalog(catalogRaw as Json);

  // Payer-issued IDs are scoped by the selected case's group, payer, and
  // state. Never resolve a case fallback against an ad hoc group override.
  let payerIssuedGroupId: string | null = null;
  let payerIssuedGroupIdReason = "a selected case with payer, group, and state is required";
  if (
    caseContext &&
    caseContext.group_id != null &&
    caseContext.group_id === groupId &&
    caseContext.payer_id &&
    caseContext.state?.trim()
  ) {
    const { data: target, error: targetErr } = await db
      .from("payer_network_targets")
      .select("payer_issued_id")
      .eq("org_id", orgId)
      .eq("group_id", caseContext.group_id)
      .eq("payer_id", caseContext.payer_id)
      .eq("state", caseContext.state)
      .eq("status", "active")
      .maybeSingle();
    if (targetErr) throw targetErr;
    const targetId = (target as Row | null)?.payer_issued_id;
    const caseFallbackId = caseContext.payer_group_provider_id;
    const targetValue = typeof targetId === "string" ? targetId.trim() : "";
    const caseFallbackValue = typeof caseFallbackId === "string" ? caseFallbackId.trim() : "";
    payerIssuedGroupId = targetValue || caseFallbackValue || null;
    payerIssuedGroupIdReason =
      "no payer-issued group ID is recorded for this case's group, payer, and state";
  }

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
  if (groupId != null && !group) return { kind: "group_not_found" };
  const licenses = (licenseRes.data ?? []) as unknown as Row[];
  const assignments = (assignmentRes.data ?? []) as unknown as Row[];
  const policies = (policyRes.data ?? []) as unknown as Row[];

  const policyPick = pickPolicy(policies, group != null);

  // The provider→facility linkage is provider_facility_assignments (unique
  // (provider_id, facility_id)); the provider-only set is every assigned
  // facility that still exists in the caller's org. Contract profiles further
  // restrict candidates to assignments that have started and facilities in
  // the Contract's exact group and state before any sole-facility selection.
  const assignmentFacilityIds = [
    ...new Set(assignments.map((a) => a.facility_id as string).filter(Boolean)),
  ];
  let facilities: ProviderProfileFacility[] = [];
  let caseFacilityRows: Array<{ is_primary: boolean; facility: Row | null }> = [];
  if (caseContext) {
    const { data: rows, error: caseFacilitiesErr } = await db
      .from("case_facilities")
      .select(`is_primary, facility:facilities!inner(${PROFILE_FACILITY_COLUMNS})`)
      .eq("case_id", caseContext.id)
      .eq("org_id", orgId)
      .eq("facility.org_id", orgId);
    if (caseFacilitiesErr) throw caseFacilitiesErr;
    caseFacilityRows = (
      (rows ?? []) as unknown as Array<{
        is_primary: boolean;
        facility: Row | null;
      }>
    ).filter((row) => row.facility != null);
    caseFacilityRows.sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return String(a.facility?.name ?? "").localeCompare(String(b.facility?.name ?? ""));
    });
    facilities = caseFacilityRows.map(({ facility }) => ({
      id: String(facility?.id ?? ""),
      name: String(facility?.name ?? ""),
    }));
  } else if (assignmentFacilityIds.length > 0) {
    const facilityQuery = contractOwner
      ? db.from("facilities").select("id, name, state, group_id")
      : db.from("facilities").select("id, name, state");
    const { data: facilityRows, error: facilityListErr } = await facilityQuery
      .in("id", assignmentFacilityIds)
      .eq("org_id", orgId)
      .order("name")
      .order("id");
    if (facilityListErr) throw facilityListErr;
    const today = new Date().toISOString().slice(0, 10);
    const currentContractFacilityIds = contractOwner
      ? new Set(
          assignments
            .filter((assignment) => isCurrentFacilityAssignment(assignment.start_date, today))
            .map((assignment) => assignment.facility_id as string),
        )
      : null;
    facilities = (
      (facilityRows ?? []) as Array<{
        id: string;
        name: string | null;
        state: string | null;
        group_id?: string | null;
      }>
    )
      .filter(
        (facility) =>
          !contractOwner ||
          (currentContractFacilityIds?.has(facility.id) === true &&
            facility.group_id === contractOwner.contract.groupId &&
            sameState(facility.state, contractOwner.contract.state)),
      )
      .map((facility) => ({
        id: facility.id,
        name: facility.name ?? "",
        state: facility.state ?? null,
      }));
  }

  const selection = caseContext
    ? selectCaseFacility(facilities, caseContext.facility_id, options.facilityId)
    : selectFacility(facilities, assignments.length > 0, options.facilityId);
  if (selection.invalid) return { kind: "facility_not_found" };
  const selectedFacilityId = selection.facility?.id ?? null;
  const adHocLocation = !options.caseId && !!options.facilityId;
  const caseState = caseContext?.state?.trim() || undefined;
  const ownerState = contractOwner?.contract.state.trim() || undefined;
  const facilityState = selection.facility?.state?.trim() || undefined;
  const licenseState = caseContext
    ? (caseState ?? options.state)
    : adHocLocation
      ? facilityState
      : (ownerState ?? options.state);
  const licensePick =
    adHocLocation && !licenseState
      ? { row: null, reason: "selected facility has no state" }
      : pickLicense(licenses, licenseState);

  // The assignment row follows the facility selection — it IS the link row of
  // the selected facility, so assignment.* and facility.* always agree.
  let facilityPick: SourcePick;
  let assignmentPick: SourcePick;
  let selectedFacilityRow: Row | null = null;
  if (selectedFacilityId) {
    const facilityRow = caseContext
      ? (caseFacilityRows.find((row) => row.facility?.id === selectedFacilityId)?.facility ?? null)
      : await (async () => {
          const { data: facilityRow, error: facilityErr } = await db
            .from("facilities")
            .select(PROFILE_FACILITY_COLUMNS)
            .eq("id", selectedFacilityId)
            .eq("org_id", orgId)
            .maybeSingle();
          if (facilityErr) throw facilityErr;
          return (facilityRow as unknown as Row | null) ?? null;
        })();
    selectedFacilityRow = facilityRow as Row | null;
    facilityPick = facilityRow
      ? { row: facilityRow as Row }
      : {
          row: null,
          reason: caseContext ? "case facility not found" : "assigned facility not found",
        };
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
    provider_groups: group
      ? { row: group }
      : { row: null, reason: caseContext ? "case has no group" : "provider has no group" },
    state_licenses: licensePick,
    provider_facility_assignments: assignmentPick,
    facilities: facilityPick,
    group_insurance_policies: policyPick,
  };

  const tokens: ProfileToken[] = [];
  const unresolved: UnresolvedToken[] = [];
  for (const entry of catalog) {
    if (COMPUTED_PROFILE_TOKENS.has(entry.token)) continue;
    if (CONTRACT_GROUP_CONTACT_TOKENS.has(entry.token) && !contractOwner) {
      tokens.push({ token: entry.token, value: null });
      unresolved.push({
        token: entry.token,
        reason: "Contracting contacts require an authorized Contract owner context.",
      });
      continue;
    }
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
    const value = (pick.row[entry.column] ?? null) as Json | null;
    tokens.push({ token: entry.token, value });
    if (
      CONTRACT_GROUP_CONTACT_TOKENS.has(entry.token) &&
      contractOwner &&
      (value == null || value === "")
    ) {
      unresolved.push({
        token: entry.token,
        reason: "This Contract group's contracting contact value is missing.",
        recordPath: `/groups/${contractOwner.contract.groupId}`,
      });
    }
  }

  const computedValues = {
    ...composeProviderNameTokens(camelizeRow<Provider>(provider)),
    ...composeFacilityAddressTokens(
      selectedFacilityRow as unknown as {
        street?: string | null;
        suite?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
      } | null,
    ),
  };
  for (const token of COMPUTED_PROFILE_TOKEN_KEYS) {
    const value = computedValues[token];
    tokens.push({ token, value: value ?? null });
    if (!value) {
      unresolved.push({ token, reason: "required composite parts are not available" });
    }
  }

  tokens.push({ token: "group.payerIssuedId", value: payerIssuedGroupId });
  if (!payerIssuedGroupId) {
    unresolved.push({ token: "group.payerIssuedId", reason: payerIssuedGroupIdReason });
  }

  return {
    kind: "ok",
    profile: {
      provider: camelizeRow<Provider>(provider),
      tokens,
      unresolved,
      facilities,
      selected_facility_id: selectedFacilityId,
      // Keep the exact validated request spelling as binding proof. PostgreSQL
      // stores UUIDs canonically, which may lowercase a mixed-case request.
      case_id: caseContext ? (options.caseId ?? caseContext.id) : null,
      ...(contractOwner
        ? {
            contract_context: {
              contract_id: contractOwner.contract.id,
              assignment_id: contractOwner.assignment.id,
              context_version: contractOwner.assignment.contextVersion,
              sop_template_id: contractOwner.assignment.sopTemplateId,
              sop_version: contractOwner.assignment.sopVersion,
            },
          }
        : {}),
    },
    needsFacility: selection.needsFacility,
  };
}

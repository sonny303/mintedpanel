// Provider Onboarding read layer (Oct 20 review, RC-06): batched org-scoped
// reads joined in memory by src/lib/onboardingFunnel.ts. Every read pages to
// completion, so a Luna-sized roster is never silently capped.
//
// The intake tables (provider_intake_invites and friends) are service-role
// only (MINT-89), so this browser read cannot see them: intakeReadable is
// false and the funnel hides its Invited stage.
//
// PHI boundary: date of birth and SSN last-4 are read ONLY to reduce them to
// presence booleans right here. The values never leave this module, never
// enter the cache, and never render.
import { supabase } from "@/integrations/supabase/externalClient";
import { requireActiveOrg } from "@/lib/audit";
import { readCompletePages } from "@/lib/completePages";
import type { OnboardingFunnelInput } from "@/lib/onboardingFunnel";

type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : null);

export async function getOnboardingFunnelInput(): Promise<OnboardingFunnelInput> {
  const orgId = requireActiveOrg();
  const providersQuery = supabase
    .from("providers")
    .select(
      "id, first_name, last_name, npi, caqh_id, caqh_last_attested_date, date_of_birth, ssn_last4, verification_state, reference_only",
      { count: "exact" },
    )
    .eq("org_id", orgId)
    .neq("status", "terminated")
    .neq("is_test_provider", true)
    .order("id", { ascending: true });
  const licensesQuery = supabase
    .from("state_licenses")
    .select("id, provider_id, state, status, verified_status, expiration_date", {
      count: "exact",
    })
    .eq("org_id", orgId)
    .order("id", { ascending: true });
  const facilitiesQuery = supabase
    .from("facilities")
    .select("id, state, is_active", { count: "exact" })
    .eq("org_id", orgId)
    .order("id", { ascending: true });
  const assignmentsQuery = supabase
    .from("provider_facility_assignments")
    .select("id, provider_id, facility_id", { count: "exact" })
    .eq("org_id", orgId)
    .order("id", { ascending: true });
  const groupsQuery = supabase
    .from("provider_groups")
    .select("id, is_active", { count: "exact" })
    .eq("org_id", orgId)
    .order("id", { ascending: true });
  const membershipsQuery = supabase
    .from("provider_group_assignments")
    .select("id, provider_id, group_id, end_date", { count: "exact" })
    .eq("org_id", orgId)
    .order("id", { ascending: true });
  const casesQuery = supabase
    .from("credential_cases")
    .select("id, provider_id, state", { count: "exact" })
    .eq("org_id", orgId)
    .order("id", { ascending: true });

  const [providers, licenses, facilities, assignments, groups, memberships, cases] =
    (await Promise.all([
      readCompletePages(async (from, to) => await providersQuery.range(from, to), {
        label: "Onboarding providers",
      }),
      readCompletePages(async (from, to) => await licensesQuery.range(from, to), {
        label: "Onboarding licenses",
      }),
      readCompletePages(async (from, to) => await facilitiesQuery.range(from, to), {
        label: "Onboarding locations",
      }),
      readCompletePages(async (from, to) => await assignmentsQuery.range(from, to), {
        label: "Onboarding location assignments",
      }),
      readCompletePages(async (from, to) => await groupsQuery.range(from, to), {
        label: "Onboarding groups",
      }),
      readCompletePages(async (from, to) => await membershipsQuery.range(from, to), {
        label: "Onboarding group memberships",
      }),
      readCompletePages(async (from, to) => await casesQuery.range(from, to), {
        label: "Onboarding cases",
      }),
    ])) as unknown as Row[][];

  const activeFacilityStates = new Map(
    facilities.filter((row) => row.is_active === true).map((row) => [row.id, text(row.state)]),
  );
  const activeGroups = new Set(groups.filter((row) => row.is_active === true).map((row) => row.id));
  return {
    providers: providers
      .filter((row) => row.reference_only !== true)
      .map((row) => ({
        providerId: String(row.id),
        name: `${text(row.first_name) ?? ""} ${text(row.last_name) ?? ""}`.trim(),
        npi: text(row.npi)?.trim() || null,
        caqhIdPresent: Boolean(text(row.caqh_id)?.trim()),
        caqhLastAttestedDate: text(row.caqh_last_attested_date),
        dobPresent: Boolean(row.date_of_birth),
        ssnLast4Present: Boolean(text(row.ssn_last4)?.trim()),
        pendingVerification: row.verification_state === "pending_verification",
      })),
    licenses: licenses
      .filter((row) => row.status === null || row.status === "active")
      .map((row) => ({
        providerId: text(row.provider_id),
        state: text(row.state) ?? "",
        verifiedStatus: text(row.verified_status) ?? "unverified",
        expirationDate: text(row.expiration_date),
      })),
    workStates: assignments
      .filter((row) => activeFacilityStates.has(row.facility_id))
      .map((row) => ({
        providerId: text(row.provider_id),
        state: activeFacilityStates.get(row.facility_id) ?? null,
      })),
    groupMemberships: memberships
      .filter((row) => activeGroups.has(row.group_id))
      .map((row) => ({ providerId: text(row.provider_id), endDate: text(row.end_date) })),
    // Every case counts, whatever its status: no status column is read.
    cases: cases.map((row) => ({ providerId: text(row.provider_id), state: text(row.state) })),
    intakeReadable: false,
  };
}

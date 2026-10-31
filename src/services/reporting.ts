// Reporting Center data (redesign E0.6, TE-4). CROSS-org, like the Portfolio
// source (no requireActiveOrg; RLS scopes to the caller's orgs).
import { supabase } from "@/integrations/supabase/externalClient";
import { readCompletePages } from "@/lib/completePages";
import type { FootprintInput } from "@/lib/portfolioFootprint";

// Portfolio footprint (Oct 20 review, RC-05): the rows behind Organization →
// Group → State counts. CROSS-org like the rest of this file: no org filter,
// RLS (`org_id IN user_org_ids()`) limits every table to the caller's member
// orgs, so a customer login sees only its own org. Narrow columns only — no
// PHI, no names beyond group names.
export async function listPortfolioFootprint(): Promise<Omit<FootprintInput, "orgs">> {
  const groupsQuery = supabase
    .from("provider_groups")
    .select("id, org_id, name, is_active", { count: "exact" })
    .order("id", { ascending: true });
  const facilitiesQuery = supabase
    .from("facilities")
    .select("id, org_id, group_id, state, is_active, reference_only", { count: "exact" })
    .order("id", { ascending: true });
  const providersQuery = supabase
    .from("providers")
    .select("id, org_id, status, is_test_provider, reference_only", { count: "exact" })
    .order("id", { ascending: true });
  const membershipsQuery = supabase
    .from("provider_group_assignments")
    .select("id, provider_id, group_id, end_date", { count: "exact" })
    .order("id", { ascending: true });
  const assignmentsQuery = supabase
    .from("provider_facility_assignments")
    .select("id, provider_id, facility_id", { count: "exact" })
    .order("id", { ascending: true });
  const [groups, facilities, providers, memberships, assignments] = (await Promise.all([
    readCompletePages(async (from, to) => await groupsQuery.range(from, to), {
      label: "Portfolio groups",
    }),
    readCompletePages(async (from, to) => await facilitiesQuery.range(from, to), {
      label: "Portfolio locations",
    }),
    readCompletePages(async (from, to) => await providersQuery.range(from, to), {
      label: "Portfolio providers",
    }),
    readCompletePages(async (from, to) => await membershipsQuery.range(from, to), {
      label: "Portfolio group memberships",
    }),
    readCompletePages(async (from, to) => await assignmentsQuery.range(from, to), {
      label: "Portfolio location assignments",
    }),
  ])) as unknown as Array<Array<Record<string, unknown>>>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    groups: groups.map((row) => ({
      id: String(row.id),
      orgId: String(row.org_id),
      name: text(row.name) ?? "Unnamed group",
      isActive: row.is_active !== false,
    })),
    facilities: facilities.map((row) => ({
      id: String(row.id),
      orgId: String(row.org_id),
      groupId: text(row.group_id),
      state: text(row.state),
      isActive: row.is_active === true,
      referenceOnly: row.reference_only === true,
    })),
    providers: providers.map((row) => ({
      id: String(row.id),
      orgId: String(row.org_id),
      status: text(row.status) ?? "",
      isTestProvider: row.is_test_provider === true,
      referenceOnly: row.reference_only === true,
    })),
    groupMemberships: memberships.map((row) => ({
      providerId: text(row.provider_id),
      groupId: text(row.group_id),
      endDate: text(row.end_date),
    })),
    facilityAssignments: assignments.map((row) => ({
      providerId: text(row.provider_id),
      facilityId: text(row.facility_id),
    })),
  };
}

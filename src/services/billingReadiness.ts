import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { billingFeedQueryWindowStart, type BillingReadinessSnapshot } from "@/lib/billingReadiness";
import { useAuthStore } from "@/lib/auth-store";
import { requireActiveOrg } from "@/lib/audit";
import type { Database } from "@/integrations/supabase/types";

export interface BillingReadinessServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

interface PageResult<T> {
  data: T[] | null;
  error: unknown;
  count: number | null;
}

const PAGE_SIZE = 500;
const MAX_COMPLETE_ROWS = 100_000;

async function readCompletePages<T>(
  readPage: (from: number, to: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let expectedCount: number | null = null;
  while (true) {
    const { data, error, count } = await readPage(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    if (data === null) throw new Error("Billing readiness source returned no data payload.");
    if (count === null || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("Billing readiness source could not verify completeness.");
    }
    if (expectedCount === null) expectedCount = count;
    else if (count !== expectedCount)
      throw new Error("Billing readiness source changed during pagination.");
    if (expectedCount > MAX_COMPLETE_ROWS) {
      throw new Error("Billing readiness source exceeded the complete-read limit.");
    }
    const page = data;
    if (page.length > PAGE_SIZE)
      throw new Error("Billing readiness source returned an oversized page.");
    rows.push(...page);
    if (rows.length > expectedCount) {
      throw new Error("Billing readiness source returned more rows than its exact count.");
    }
    if (rows.length === expectedCount) return rows;
    if (rows.length >= MAX_COMPLETE_ROWS) {
      throw new Error("Billing readiness source exceeded the complete-read limit.");
    }
    if (page.length < PAGE_SIZE)
      throw new Error("Billing readiness source returned an incomplete page set.");
  }
}

function activeOrgContext(expectedOrgId?: string): BillingReadinessServiceCtx {
  const state = useAuthStore.getState();
  if (!state.session)
    throw new Error("An authenticated session is required for billing readiness.");
  const orgId = requireActiveOrg();
  if (state.activeOrgId !== orgId || (expectedOrgId && orgId !== expectedOrgId)) {
    throw new Error("The active organization changed before billing readiness loaded.");
  }
  return { db: supabase, orgId };
}

function assertOrgStillActive(orgId: string): void {
  const state = useAuthStore.getState();
  if (!state.session || state.activeOrgId !== orgId) {
    throw new Error("The session or active organization changed while billing readiness loaded.");
  }
}

function localTodayIso(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function getBillingReadinessSnapshot(
  ctx?: BillingReadinessServiceCtx,
  today = localTodayIso(),
  expectedOrgId?: string,
): Promise<BillingReadinessSnapshot> {
  const { db, orgId } = ctx ?? activeOrgContext(expectedOrgId);
  const fromDate = billingFeedQueryWindowStart(today);
  if (!fromDate) throw new Error("Billing readiness assessment date is invalid.");

  const read = <T>(builder: {
    range: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>;
  }) => readCompletePages<T>(async (from, to) => await builder.range(from, to));

  const [
    providers,
    groups,
    facilities,
    payers,
    groupMemberships,
    facilityAssignments,
    licenses,
    cases,
    caseFacilities,
    statusTransitions,
    legacyStatusTransitions,
    statusConfigs,
  ] = await Promise.all([
    read(
      db
        .from("providers")
        .select(
          "id, first_name, last_name, npi, taxonomy_code, status, verification_state, is_test_provider",
          { count: "exact" },
        )
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("provider_groups")
        .select("id, name, tin, npi_type2, is_active", { count: "exact" })
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("facilities")
        .select("id, name, group_id, state, is_active", { count: "exact" })
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("payers")
        .select("id, name, status, is_active, avg_decision_days, org_id", { count: "exact" })
        .or(`org_id.eq.${orgId},org_id.is.null`)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("provider_group_assignments")
        .select("provider_id, group_id, start_date, end_date", { count: "exact" })
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("provider_facility_assignments")
        .select("provider_id, facility_id, start_date", { count: "exact" })
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("state_licenses")
        .select(
          "provider_id, state, license_number, license_type, status, verified_status, issue_date, expiration_date",
          { count: "exact" },
        )
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("credential_cases")
        .select(
          "id, provider_id, group_id, payer_id, state, case_status, submitted_date, approved_date, confirmed_effective_date, expected_effective_date, termination_date, created_at",
          { count: "exact" },
        )
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("case_facilities")
        .select("case_id, facility_id, created_at, created_by", { count: "exact" })
        .eq("org_id", orgId)
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("case_status_history")
        .select("id, case_id, from_status, to_status, actor_kind, changed_at", { count: "exact" })
        .eq("org_id", orgId)
        .gte("changed_at", fromDate)
        .order("changed_at", { ascending: true })
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("status_history")
        .select("id, case_id, track, to_status_id, changed_at", { count: "exact" })
        .eq("org_id", orgId)
        .eq("track", "credentialing")
        .not("case_id", "is", null)
        .gte("changed_at", fromDate)
        .order("changed_at", { ascending: true })
        .order("id", { ascending: true }),
    ),
    read(
      db
        .from("status_configs")
        .select("id, track, label", { count: "exact" })
        .eq("org_id", orgId)
        .eq("track", "credentialing")
        .order("id", { ascending: true }),
    ),
  ]);

  if (!ctx) assertOrgStillActive(orgId);
  const configRows = camelizeRow<Array<{ id: string; label: string }>>(statusConfigs);
  const labelByStatusId = new Map(configRows.map((row) => [row.id, row.label]));
  const legacyRows = camelizeRow<
    Array<{
      id: string;
      caseId: string | null;
      track: string;
      toStatusId: string | null;
      changedAt: string | null;
    }>
  >(legacyStatusTransitions);

  return {
    providers: camelizeRow<BillingReadinessSnapshot["providers"]>(providers),
    groups: camelizeRow<BillingReadinessSnapshot["groups"]>(groups),
    facilities: camelizeRow<BillingReadinessSnapshot["facilities"]>(facilities),
    payers: camelizeRow<BillingReadinessSnapshot["payers"]>(payers),
    groupMemberships: camelizeRow<BillingReadinessSnapshot["groupMemberships"]>(groupMemberships),
    facilityAssignments:
      camelizeRow<BillingReadinessSnapshot["facilityAssignments"]>(facilityAssignments),
    licenses: camelizeRow<BillingReadinessSnapshot["licenses"]>(licenses),
    cases: camelizeRow<BillingReadinessSnapshot["cases"]>(cases),
    caseFacilities: camelizeRow<BillingReadinessSnapshot["caseFacilities"]>(caseFacilities),
    statusTransitions:
      camelizeRow<BillingReadinessSnapshot["statusTransitions"]>(statusTransitions),
    legacyStatusTransitions: legacyRows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      track: row.track,
      toStatusLabel: row.toStatusId ? (labelByStatusId.get(row.toStatusId) ?? null) : null,
      changedAt: row.changedAt,
    })),
  };
}

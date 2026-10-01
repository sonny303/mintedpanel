import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import type { ContractSopAssignment, ContractSopVersion } from "@/types";

export interface ContractSopAssignmentServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

export interface ContractSopAssignmentDetails {
  assignment: ContractSopAssignment;
  version: ContractSopVersion;
  hasRecordedActivity: boolean;
}

export interface AssignContractSopInput {
  contractId: string;
  sopTemplateId: string;
  sopVersion: number;
  expectedContextVersion: number | null;
}

/** The picker uses membership IDs filtered by active dates, then excludes terminal providers. */
export function eligibleContractProviderOptions<T extends { id: string; status: string }>(
  providers: readonly T[],
  activeMembershipProviderIds: ReadonlySet<string>,
): T[] {
  return providers.filter(
    (provider) => activeMembershipProviderIds.has(provider.id) && provider.status !== "terminated",
  );
}

function rowObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Contract SOP assignment response was invalid");
  }
  return value as Record<string, unknown>;
}

export async function getContractSopAssignment(
  ctx: ContractSopAssignmentServiceCtx,
  contractId: string,
): Promise<ContractSopAssignmentDetails | null> {
  const { data: assignmentRow, error } = await ctx.db
    .from("contract_sop_assignments")
    .select("*")
    .eq("org_id", ctx.orgId)
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw error;
  if (!assignmentRow) return null;

  const assignment = camelizeRow<ContractSopAssignment>(assignmentRow);
  const [{ data: versionRow, error: versionError }, { count, error: activityError }] =
    await Promise.all([
      ctx.db
        .from("sop_template_versions")
        .select(
          "template_id, version, name, case_type, task_definitions, required_profile_attributes",
        )
        .eq("template_id", assignment.sopTemplateId)
        .eq("version", assignment.sopVersion)
        .maybeSingle(),
      ctx.db
        .from("fill_sessions")
        .select("id", { count: "exact", head: true })
        .eq("org_id", ctx.orgId)
        .eq("contract_sop_assignment_id", assignment.id)
        .eq("is_test", false),
    ]);
  if (versionError) throw versionError;
  if (activityError) throw activityError;
  if (!versionRow) throw new Error("The assigned immutable Contract SOP version is unavailable");

  return {
    assignment,
    version: camelizeRow<ContractSopVersion>(versionRow),
    hasRecordedActivity: (count ?? 0) > 0,
  };
}

/** Returns active group memberships; callers join these IDs to the org roster. */
export async function listContractProviderIds(
  ctx: ContractSopAssignmentServiceCtx,
  groupId: string,
): Promise<string[]> {
  const { data, error } = await ctx.db
    .from("provider_group_assignments")
    .select("provider_id, start_date, end_date")
    .eq("org_id", ctx.orgId)
    .eq("group_id", groupId);
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  const membershipProviderIds = [
    ...new Set(
      (data ?? [])
        .filter(
          (row) =>
            (row.start_date == null || row.start_date <= today) &&
            (row.end_date == null || row.end_date >= today),
        )
        .map((row) => row.provider_id),
    ),
  ];
  if (membershipProviderIds.length === 0) return [];

  const { data: providers, error: providersError } = await ctx.db
    .from("providers")
    .select("id, status")
    .eq("org_id", ctx.orgId)
    .in("id", membershipProviderIds);
  if (providersError) throw providersError;
  return [
    ...new Set(
      (providers ?? [])
        .filter((provider) => provider.status !== "terminated")
        .map((provider) => provider.id),
    ),
  ];
}

/** Explicit operator choice; the database rechecks full payer/group/state scope. */
export async function assignContractSop(
  ctx: ContractSopAssignmentServiceCtx,
  input: AssignContractSopInput,
): Promise<ContractSopAssignment> {
  const { data, error } = await ctx.db.rpc("assign_contract_sop", {
    p_contract_id: input.contractId,
    p_sop_template_id: input.sopTemplateId,
    p_sop_version: input.sopVersion,
    p_expected_context_version: input.expectedContextVersion ?? undefined,
  });
  if (error) throw error;
  return camelizeRow<ContractSopAssignment>(rowObject(data));
}

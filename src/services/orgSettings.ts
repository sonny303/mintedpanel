// Org settings CRUD (organization name, provider groups, facilities,
// memberships, group insurance policies) with audit_log writes on mutations.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeOptionalStateCode } from "@/lib/stateCode";
import { translateDbError } from "@/lib/dbErrors";
import type { AppRole, Facility, Organization, ProviderGroup } from "@/types";
import type { Database } from "@/integrations/supabase/types";

/* ------------------------------ Organization ------------------------------ */

export async function getOrganization(): Promise<Organization | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, created_at")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Organization>(data) : null;
}

export async function updateOrganizationName(name: string): Promise<Organization> {
  const orgId = requireActiveOrg();
  const before = await getOrganization();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  const { data, error } = await supabase
    .from("organizations")
    .update({ name: trimmed })
    .eq("id", orgId)
    .select("id, name, created_at")
    .single();
  if (error) throw error;
  const after = camelizeRow<Organization>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "organization",
    entityId: orgId,
    before,
    after,
    description: `Renamed organization to ${after.name}`,
  });
  return after;
}

/* ---------------------------- Provider groups ----------------------------- */

export interface ProviderGroupInput {
  name: string;
  tin?: string | null;
  npiType2?: string | null;
  states?: string[] | null;
  isActive?: boolean;
  billingStreet?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
  correspondenceStreet?: string | null;
  correspondenceCity?: string | null;
  correspondenceState?: string | null;
  correspondenceZip?: string | null;
}

export async function listProviderGroups(): Promise<ProviderGroup[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_groups")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return camelizeRow<ProviderGroup[]>(data ?? []);
}

async function getProviderGroup(id: string): Promise<ProviderGroup | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_groups")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<ProviderGroup>(data) : null;
}

export async function createProviderGroup(input: ProviderGroupInput): Promise<ProviderGroup> {
  const orgId = requireActiveOrg();
  if (!input.name.trim()) throw new Error("Name is required");
  // E0.10: billing/correspondence state are DB-checked to ^[A-Z]{2}$ when present.
  const payload: Record<string, unknown> = {
    ...snakeizeRow<Record<string, unknown>>(input),
    org_id: orgId,
  };
  if ("billingState" in input)
    payload.billing_state = normalizeOptionalStateCode(input.billingState);
  if ("correspondenceState" in input)
    payload.correspondence_state = normalizeOptionalStateCode(input.correspondenceState);
  const { data, error } = await supabase
    .from("provider_groups")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const created = camelizeRow<ProviderGroup>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "provider_group",
    entityId: created.id,
    after: created,
    description: `Created provider group ${created.name}`,
  });
  return created;
}

export async function updateProviderGroup(
  id: string,
  patch: Partial<ProviderGroupInput>,
): Promise<ProviderGroup> {
  const orgId = requireActiveOrg();
  const before = await getProviderGroup(id);
  const payload = snakeizeRow<Record<string, unknown>>(patch);
  if ("billingState" in patch)
    payload.billing_state = normalizeOptionalStateCode(patch.billingState);
  if ("correspondenceState" in patch)
    payload.correspondence_state = normalizeOptionalStateCode(patch.correspondenceState);
  const { data, error } = await supabase
    .from("provider_groups")
    .update(payload as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const after = camelizeRow<ProviderGroup>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "provider_group",
    entityId: id,
    before,
    after,
    description: `Updated provider group ${after.name}`,
  });
  return after;
}

/* -------------------------------- Facilities ------------------------------ */

export interface FacilityInput {
  name: string;
  groupId?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  isActive?: boolean;
  // Onboarding-import flag (Epic 2e). Optional; omitted → DB default (false)
  // so existing panel callers are unchanged. The CSV import sets it from the
  // per-import toggle. Rides through snakeizeRow → reference_only.
  referenceOnly?: boolean;
}

export async function listFacilities(): Promise<Facility[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("facilities")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return camelizeRow<Facility[]>(data ?? []);
}

async function getFacility(id: string): Promise<Facility | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("facilities")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Facility>(data) : null;
}

export async function createFacility(input: FacilityInput): Promise<Facility> {
  const orgId = requireActiveOrg();
  if (!input.name.trim()) throw new Error("Name is required");
  // E0.10: facilities.state is DB-checked to ^[A-Z]{2}$ when present.
  const payload: Record<string, unknown> = {
    ...snakeizeRow<Record<string, unknown>>(input),
    org_id: orgId,
  };
  if ("state" in input) payload.state = normalizeOptionalStateCode(input.state);
  const { data, error } = await supabase
    .from("facilities")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const created = camelizeRow<Facility>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "facility",
    entityId: created.id,
    after: created,
    description: `Created facility ${created.name}`,
  });
  return created;
}

export async function updateFacility(id: string, patch: Partial<FacilityInput>): Promise<Facility> {
  const orgId = requireActiveOrg();
  const before = await getFacility(id);
  const payload = snakeizeRow<Record<string, unknown>>(patch);
  if ("state" in patch) payload.state = normalizeOptionalStateCode(patch.state);
  const { data, error } = await supabase
    .from("facilities")
    .update(payload as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const after = camelizeRow<Facility>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "facility",
    entityId: id,
    before,
    after,
    description: `Updated facility ${after.name}`,
  });
  return after;
}

/* ------------------------------ Memberships ------------------------------- */

export interface MembershipRow {
  id: string;
  orgId: string;
  userId: string;
  role: AppRole;
  createdAt: string;
  fullName: string | null;
  email: string | null;
}

export async function listMemberships(): Promise<MembershipRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("memberships")
    .select("id, org_id, user_id, role, created_at, profiles(full_name, email)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = row.profiles as { full_name: string | null; email: string | null } | null;
    return {
      id: row.id as string,
      orgId: row.org_id as string,
      userId: row.user_id as string,
      role: row.role as AppRole,
      createdAt: row.created_at as string,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
    };
  });
}

async function getMembership(id: string): Promise<MembershipRow | null> {
  const list = await listMemberships();
  return list.find((m) => m.id === id) ?? null;
}

export async function updateMembershipRole(id: string, role: AppRole): Promise<MembershipRow> {
  const orgId = requireActiveOrg();
  const before = await getMembership(id);
  const { error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
  const after = await getMembership(id);
  if (!after) throw new Error("Membership not found after update");
  await writeAudit({
    actionType: "UPDATE",
    entityType: "membership",
    entityId: id,
    before,
    after,
    description: `Changed role to ${role}${after.email ? ` for ${after.email}` : ""}`,
  });
  return after;
}

/* --------------------------- Insurance Policies --------------------------- */

export type InsuranceType = "professional_liability" | "general_liability";

export interface InsurancePolicy {
  id: string;
  orgId: string;
  groupId: string;
  insuranceType: InsuranceType;
  insurerName: string;
  policyNumber: string;
  policyStartDate: string;
  policyEndDate: string;
  notes: string | null;
}

export interface InsurancePolicyInput {
  groupId: string;
  insuranceType: InsuranceType;
  insurerName: string;
  policyNumber: string;
  policyStartDate: string;
  policyEndDate: string;
  notes?: string | null;
}

type InsuranceRow = Database["public"]["Tables"]["group_insurance_policies"]["Row"];
type InsuranceInsert = Database["public"]["Tables"]["group_insurance_policies"]["Insert"];
type InsuranceUpdate = Database["public"]["Tables"]["group_insurance_policies"]["Update"];

function toPolicy(row: InsuranceRow): InsurancePolicy {
  return {
    id: row.id,
    orgId: row.org_id,
    groupId: row.group_id,
    insuranceType: row.insurance_type as InsuranceType,
    insurerName: row.insurer_name,
    policyNumber: row.policy_number,
    policyStartDate: row.policy_start_date,
    policyEndDate: row.policy_end_date,
    notes: row.notes,
  };
}

export async function listGroupInsurancePolicies(groupId: string): Promise<InsurancePolicy[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("group_insurance_policies")
    .select("*")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .order("policy_end_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toPolicy);
}

async function getInsurancePolicy(id: string): Promise<InsurancePolicy | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("group_insurance_policies")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? toPolicy(data) : null;
}

function validatePolicyInput(input: InsurancePolicyInput | Partial<InsurancePolicyInput>): void {
  if ("insurerName" in input && input.insurerName !== undefined && !input.insurerName.trim()) {
    throw new Error("Insurer name is required");
  }
  if ("policyNumber" in input && input.policyNumber !== undefined && !input.policyNumber.trim()) {
    throw new Error("Policy number is required");
  }
  if ("policyStartDate" in input && input.policyStartDate !== undefined && !input.policyStartDate) {
    throw new Error("Start date is required");
  }
  if ("policyEndDate" in input && input.policyEndDate !== undefined && !input.policyEndDate) {
    throw new Error("End date is required");
  }
}

export async function createGroupInsurancePolicy(
  input: InsurancePolicyInput,
): Promise<InsurancePolicy> {
  const orgId = requireActiveOrg();
  validatePolicyInput(input);
  const payload: InsuranceInsert = {
    org_id: orgId,
    group_id: input.groupId,
    insurance_type: input.insuranceType,
    insurer_name: input.insurerName.trim(),
    policy_number: input.policyNumber.trim(),
    policy_start_date: input.policyStartDate,
    policy_end_date: input.policyEndDate,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
  const { data, error } = await supabase
    .from("group_insurance_policies")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  const created = toPolicy(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "group_insurance_policy",
    entityId: created.id,
    after: created,
    description: `Created ${created.insuranceType} policy ${created.policyNumber}`,
  });
  return created;
}

export async function updateGroupInsurancePolicy(
  id: string,
  patch: Partial<InsurancePolicyInput>,
): Promise<InsurancePolicy> {
  const orgId = requireActiveOrg();
  validatePolicyInput(patch);
  const before = await getInsurancePolicy(id);
  const payload: InsuranceUpdate = {};
  if (patch.groupId !== undefined) payload.group_id = patch.groupId;
  if (patch.insuranceType !== undefined) payload.insurance_type = patch.insuranceType;
  if (patch.insurerName !== undefined) payload.insurer_name = patch.insurerName.trim();
  if (patch.policyNumber !== undefined) payload.policy_number = patch.policyNumber.trim();
  if (patch.policyStartDate !== undefined) payload.policy_start_date = patch.policyStartDate;
  if (patch.policyEndDate !== undefined) payload.policy_end_date = patch.policyEndDate;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() ? patch.notes.trim() : null;
  const { data, error } = await supabase
    .from("group_insurance_policies")
    .update(payload)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = toPolicy(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "group_insurance_policy",
    entityId: id,
    before,
    after,
    description: `Updated policy ${after.policyNumber}`,
  });
  return after;
}

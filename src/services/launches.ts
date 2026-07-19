// Launch locations service (launch PRD v2.1). A launch is a facilities row in
// a location-track status; this service owns the launch-specific reads and
// writes on top of facilities: provider-location assignments and the
// case-generation path. Case creation goes through the existing createCase
// path (create_case_with_tasks RPC) so audit rows and SOP task seeding behave
// exactly like manual creation.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeStateCode, normalizeOptionalStateCode } from "@/lib/stateCode";
import { translateDbError } from "@/lib/dbErrors";
import { insertAssignmentRows } from "@/services/providerAssignments";
import type { Facility, FacilityAssignment } from "@/types";

export async function getLaunchLocation(id: string): Promise<Facility | null> {
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

export interface CreateLaunchInput {
  name: string;
  street?: string | null;
  city?: string | null;
  state: string;
  groupId: string;
  statusId: string;
  effectiveDate?: string | null;
  /** optional provider to assign at creation */
  providerId?: string | null;
}

export async function createLaunchLocation(input: CreateLaunchInput): Promise<Facility> {
  const orgId = requireActiveOrg();
  if (!input.name.trim()) throw new Error("Name is required");
  const { providerId, ...facilityInput } = input;
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(facilityInput),
    name: input.name.trim(),
    // E0.10: facilities.state is DB-checked to ^[A-Z]{2}$ when present.
    state: normalizeStateCode(input.state),
    org_id: orgId,
    is_active: true,
  };
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
    description: `Created launch ${created.name}`,
  });
  if (providerId) {
    await assignProviderToFacility(providerId, created.id);
  }
  return created;
}

export interface UpdateLaunchInput {
  name?: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  groupId?: string | null;
  statusId?: string;
  effectiveDate?: string | null;
}

export async function updateLaunchLocation(
  id: string,
  patch: UpdateLaunchInput,
): Promise<Facility> {
  const orgId = requireActiveOrg();
  const { data: beforeRow, error: readErr } = await supabase
    .from("facilities")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!beforeRow) throw new Error("Location not found");
  const before = camelizeRow<Facility>(beforeRow);

  const updatePayload = snakeizeRow<Record<string, unknown>>(patch);
  if ("state" in patch) updatePayload.state = normalizeOptionalStateCode(patch.state);
  const { data, error } = await supabase
    .from("facilities")
    .update(updatePayload as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const after = camelizeRow<Facility>(data);

  const statusChanged = patch.statusId !== undefined && patch.statusId !== before.statusId;
  await writeAudit({
    actionType: statusChanged ? "STATUS_CHANGE" : "UPDATE",
    entityType: "facility",
    entityId: id,
    before,
    after,
    description: statusChanged
      ? `Launch status changed for ${after.name}`
      : `Updated launch ${after.name}`,
  });
  return after;
}

export async function listFacilityAssignments(): Promise<FacilityAssignment[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_facility_assignments")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<FacilityAssignment[]>(data ?? []);
}

export async function assignProviderToFacility(
  providerId: string,
  facilityId: string,
): Promise<void> {
  requireActiveOrg();
  // E1.4 TE-3: all assignment writes route through the shared service.
  await insertAssignmentRows([{ providerId, facilityId }]);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "facility",
    entityId: facilityId,
    after: { providerId, facilityId },
    description: "Linked provider to launch location",
  });
}




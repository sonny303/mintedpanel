// Launch locations service (launch PRD v2.1). A launch is a facilities row in
// a location-track status; this service owns the launch-specific reads and
// writes on top of facilities: provider-location assignments and the
// case-generation path. Case creation goes through the existing createCase
// path (create_case_with_tasks RPC) so audit rows and SOP task seeding behave
// exactly like manual creation.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { createCase, type CaseInput, type CaseTaskPayload } from "@/services/cases";
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
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from("provider_facility_assignments")
    .upsert(
      { org_id: orgId, provider_id: providerId, facility_id: facilityId },
      { onConflict: "provider_id,facility_id", ignoreDuplicates: true },
    );
  if (error) throw error;
  await writeAudit({
    actionType: "UPDATE",
    entityType: "facility",
    entityId: facilityId,
    after: { providerId, facilityId },
    description: "Linked provider to launch location",
  });
}

export interface GenerationEntry {
  input: CaseInput;
  tasks: CaseTaskPayload[];
  /** for result reporting */
  providerName: string;
  payerName: string;
}

export interface GenerationResult {
  created: { providerName: string; payerName: string; caseId: string }[];
  failed: { providerName: string; payerName: string; reason: string }[];
}

/** Executes a confirmed generation plan case-by-case through createCase. */
export async function generateLaunchCases(
  location: Facility,
  entries: GenerationEntry[],
): Promise<GenerationResult> {
  const result: GenerationResult = { created: [], failed: [] };
  for (const entry of entries) {
    try {
      const row = await createCase(entry.input, entry.tasks);
      result.created.push({
        providerName: entry.providerName,
        payerName: entry.payerName,
        caseId: row.id,
      });
    } catch (err) {
      result.failed.push({
        providerName: entry.providerName,
        payerName: entry.payerName,
        reason: err instanceof Error ? err.message : "Create failed",
      });
    }
  }
  await writeAudit({
    actionType: "CREATE",
    entityType: "launch",
    entityId: location.id,
    after: {
      created: result.created.length,
      failed: result.failed.length,
    },
    description: `Generated ${result.created.length} cases for launch ${location.name}`,
  });
  return result;
}

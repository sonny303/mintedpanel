// Provider↔facility assignment service (E1.4 TE-3) — the ONE write path for
// provider_facility_assignments. The two legacy writers
// (providers.createProviderWithDetails bulk insert and
// launches.assignProviderToFacility upsert) now route through
// insertAssignmentRows here. The primary swap is atomic via the org-scoped
// SECURITY DEFINER RPC set_primary_assignment (two PostgREST calls are not
// atomic under the one-primary partial unique). Every mutation is audited;
// removals use the DELETE action (CHECK widened by 20260712150200).
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { translateDbError } from "@/lib/dbErrors";
import {
  firstAssignmentIdsToPromote,
  planFacilityAssignmentSync,
  type AssignmentDraft,
  type StoredFacilityAssignment,
} from "@/lib/assignmentScope";
import type { FacilityAssignment } from "@/types";

// Scoped projection (TE-5): ids + flags + dates only — nothing PHI lives on
// this table, but keep the read shape explicit anyway.
const ASSIGNMENT_COLUMNS =
  "id, org_id, provider_id, facility_id, is_primary, start_date, created_at";

export async function listOrgAssignments(): Promise<FacilityAssignment[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_facility_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<FacilityAssignment[]>(data ?? []);
}

export interface AssignmentRowInput {
  providerId: string;
  facilityId: string;
  isPrimary?: boolean;
  startDate?: string | null;
}

/** Local calendar today (YYYY-MM-DD). The PFA start_date CHECK rejects null
 *  on new inserts; callers that omit a date (Add Provider) default here —
 *  same posture as the CSV relationship pass in importRuns. */
function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Shared bulk insert used by the legacy callers (provider create, launch
 * assign). Duplicate (provider, facility) pairs are ignored, matching the
 * old launch upsert semantics. */
export async function insertAssignmentRows(rows: AssignmentRowInput[]): Promise<void> {
  if (rows.length === 0) return;
  const orgId = requireActiveOrg();
  const today = localTodayIso();
  const { error } = await supabase.from("provider_facility_assignments").upsert(
    rows.map((r) => ({
      org_id: orgId,
      provider_id: r.providerId,
      facility_id: r.facilityId,
      is_primary: r.isPrimary ?? false,
      // E1.4 CHECK (start_date IS NOT NULL) — NOT VALID still enforces inserts.
      start_date: r.startDate?.trim() || today,
    })),
    { onConflict: "provider_id,facility_id", ignoreDuplicates: true },
  );
  if (error) throw translateDbError(error);
}

/** After import (or any bulk insert that wrote is_primary=false), promote
 * the first assignment for any provider who still has none. No-op when
 * every listed provider already has a primary or has no assignments. */
export async function ensureFirstFacilityPrimary(providerIds: string[]): Promise<void> {
  if (providerIds.length === 0) return;
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_facility_assignments")
    .select("id, provider_id, is_primary, created_at")
    .eq("org_id", orgId)
    .in("provider_id", providerIds);
  if (error) throw translateDbError(error);
  const promoteIds = firstAssignmentIdsToPromote(
    (data ?? []).map((r) => ({
      id: String(r.id),
      providerId: String(r.provider_id),
      isPrimary: Boolean(r.is_primary),
      createdAt: String(r.created_at ?? ""),
    })),
  );
  if (promoteIds.length === 0) return;
  const { error: updateError } = await supabase
    .from("provider_facility_assignments")
    .update({ is_primary: true })
    .eq("org_id", orgId)
    .in("id", promoteIds);
  if (updateError) throw translateDbError(updateError);
}

async function listProviderAssignmentRows(
  orgId: string,
  providerId: string,
): Promise<Array<StoredFacilityAssignment & { orgId: string }>> {
  const { data, error } = await supabase
    .from("provider_facility_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("org_id", orgId)
    .eq("provider_id", providerId);
  if (error) throw error;
  return camelizeRow<Array<StoredFacilityAssignment & { orgId: string }>>(data ?? []);
}

// Full-set sync for one provider (the E1.4 editor save): validates the
// invariants (start date on every row; exactly one primary when non-empty —
// so removing the primary forces a re-pick), then executes
// updates → deletes → inserts(as non-primary) → atomic RPC swap.
export async function setAssignments(providerId: string, drafts: AssignmentDraft[]): Promise<void> {
  const orgId = requireActiveOrg();
  const stored = await listProviderAssignmentRows(orgId, providerId);
  const plan = planFacilityAssignmentSync(drafts, stored);

  for (const upd of plan.updates) {
    const { error } = await supabase
      .from("provider_facility_assignments")
      .update({ start_date: upd.startDate })
      .eq("id", upd.id)
      .eq("org_id", orgId)
      .eq("provider_id", providerId);
    if (error) throw translateDbError(error);
  }

  if (plan.deleteIds.length > 0) {
    const { error } = await supabase
      .from("provider_facility_assignments")
      .delete()
      .eq("org_id", orgId)
      .eq("provider_id", providerId)
      .in("id", plan.deleteIds);
    if (error) throw translateDbError(error);
    await writeAudit({
      actionType: "DELETE",
      entityType: "provider_facility_assignment",
      entityId: providerId,
      before: { removed: stored.filter((r) => plan.deleteIds.includes(r.id)) },
      description: `Removed ${plan.deleteIds.length} facility assignment(s)`,
    });
  }

  if (plan.inserts.length > 0) {
    // Always inserted non-primary; the RPC promotes atomically below.
    const { error } = await supabase.from("provider_facility_assignments").insert(
      plan.inserts.map((d) => ({
        org_id: orgId,
        provider_id: providerId,
        facility_id: d.facilityId,
        is_primary: false,
        start_date: d.startDate,
      })),
    );
    if (error) throw translateDbError(error);
  }

  if (plan.primaryFacilityId && !plan.primaryAlreadySet) {
    const after = await listProviderAssignmentRows(orgId, providerId);
    const target = after.find((r) => r.facilityId === plan.primaryFacilityId);
    if (!target) throw new Error("Primary assignment not found after save");
    const rpc = supabase.rpc.bind(supabase);
    const { error } = await rpc("set_primary_assignment", {
      p_provider_id: providerId,
      p_assignment_id: target.id,
    });
    if (error) throw translateDbError(error);
  }

  await writeAudit({
    actionType: "UPDATE",
    entityType: "provider_facility_assignment",
    entityId: providerId,
    before: { assignments: stored },
    after: { assignments: drafts },
    description: "Updated facility assignments",
  });
}

/** One-click primary swap from the section list (F1.4.3) — atomic via RPC. */
export async function setPrimaryAssignment(
  providerId: string,
  assignmentId: string,
): Promise<void> {
  requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { error } = await rpc("set_primary_assignment", {
    p_provider_id: providerId,
    p_assignment_id: assignmentId,
  });
  if (error) throw translateDbError(error);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "provider_facility_assignment",
    entityId: assignmentId,
    after: { providerId, assignmentId, isPrimary: true },
    description: "Changed primary practice location",
  });
}

// E2.0 TE-10 — case_generation_exclusions CRUD (list / create / void). An
// exclusion is decided once and persists across generation runs; restoring
// it is ALWAYS a void (status flip + voided_by/at stamp), never a DELETE —
// the grant layer has no DELETE and E2.4 run detail links these records. A
// later re-exclusion inserts a fresh active row (the partial unique permits
// it). Writes are admin-only under RLS ([r4-review] Q2); the UI mirrors that.
//
// PHI/audit posture (TE-12): audit payloads carry ids + reason only — never
// the free-text note, which may describe a provider.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import type { CaseGenerationExclusion, CaseGenerationExclusionReason } from "@/types";

export async function listCaseGenerationExclusions(): Promise<CaseGenerationExclusion[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_generation_exclusions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return camelizeRow<CaseGenerationExclusion[]>(data ?? []);
}

export interface CreateExclusionInput {
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  reason: CaseGenerationExclusionReason;
  note?: string | null;
}

function auditPayload(row: CaseGenerationExclusion) {
  // Ids + reason only — the note never enters the audit spine (TE-12).
  return {
    id: row.id,
    providerId: row.providerId,
    groupId: row.groupId,
    payerId: row.payerId,
    state: row.state,
    reason: row.reason,
    status: row.status,
  };
}

export async function createCaseGenerationExclusion(
  input: CreateExclusionInput,
): Promise<CaseGenerationExclusion> {
  const orgId = requireActiveOrg();
  const userId = currentUserId();
  if (!userId) throw new Error("No authenticated user");
  const note = input.note?.trim() || null;
  const { data, error } = await supabase
    .from("case_generation_exclusions")
    .insert({
      org_id: orgId,
      provider_id: input.providerId,
      group_id: input.groupId,
      payer_id: input.payerId,
      state: input.state,
      reason: input.reason,
      note,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) throw error;
  const row = camelizeRow<CaseGenerationExclusion>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "case_generation_exclusion",
    entityId: row.id,
    after: auditPayload(row),
    description: `Excluded a combination from case generation (${row.reason})`,
  });
  return row;
}

/** Restore = void (TE-2): flip the row to voided and stamp who/when. The row
 * stops suppressing its key on the next derivation — nothing else changes. */
export async function voidCaseGenerationExclusion(id: string): Promise<CaseGenerationExclusion> {
  const orgId = requireActiveOrg();
  const userId = currentUserId();
  if (!userId) throw new Error("No authenticated user");
  const { data, error } = await supabase
    .from("case_generation_exclusions")
    .update({ status: "voided", voided_by: userId, voided_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("status", "active")
    .select("*")
    .single();
  if (error) throw error;
  const row = camelizeRow<CaseGenerationExclusion>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "case_generation_exclusion",
    entityId: row.id,
    after: auditPayload(row),
    description: `Restored a combination to case generation (${row.reason})`,
  });
  return row;
}

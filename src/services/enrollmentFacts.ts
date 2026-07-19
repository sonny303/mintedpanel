// E6.2 F6.2.5 — enrollment facts CRUD. A fact records "already enrolled with
// this payer UNDER THIS GROUP'S CONTRACT" at the case key's grain; it NEVER
// creates a case. Expiry is a status flip (`expired_at`/`expired_by`), never a
// DELETE — the row is history, and everything downstream (board Active,
// candidate suppression) re-derives from the live filter at render time.
// Capture UI ships in E6.4 (provider record + onboarding); this service is the
// audited write path it will consume.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeStateCode } from "@/lib/stateCode";
import type { EnrollmentFact } from "@/types";

export async function listEnrollmentFacts(): Promise<EnrollmentFact[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("enrollment_facts")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return camelizeRow<EnrollmentFact[]>(data ?? []);
}

export interface EnrollmentFactInput {
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  effectiveDate?: string | null;
}

export async function createEnrollmentFact(input: EnrollmentFactInput): Promise<EnrollmentFact> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("enrollment_facts")
    .insert({
      org_id: orgId,
      provider_id: input.providerId,
      group_id: input.groupId,
      payer_id: input.payerId,
      state: normalizeStateCode(input.state),
      effective_date: input.effectiveDate ?? null,
      source: "migration",
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<EnrollmentFact>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "enrollment_fact",
    entityId: created.id,
    after: created,
    description: `Recorded enrollment fact (${created.state})`,
  });
  return created;
}

/** The expiry flip — never a delete. Re-opens the combination as a generation
 * candidate immediately (everything downstream derives from the live filter). */
export async function expireEnrollmentFact(id: string): Promise<EnrollmentFact> {
  const orgId = requireActiveOrg();
  const userId = currentUserId();
  if (!userId) throw new Error("No authenticated user");
  const { data, error } = await supabase
    .from("enrollment_facts")
    .update({ expired_at: new Date().toISOString(), expired_by: userId } as never)
    .eq("org_id", orgId)
    .eq("id", id)
    .is("expired_at", null)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<EnrollmentFact>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "enrollment_fact",
    entityId: after.id,
    after,
    description: `Expired enrollment fact (${after.state})`,
  });
  return after;
}

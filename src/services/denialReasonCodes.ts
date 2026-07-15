// E4.2 F4.2.3 — reason-code vocabulary MANAGEMENT (the read for dropdowns lives
// in cases.ts `listDenialReasonCodes`, which filters to active). E4.0 shipped
// the `denial_reason_codes` table with global (org_id NULL) seeded defaults +
// org-added codes and admin-only writes; this service adds the admin CRUD:
// list-including-inactive, add an org code, and deactivate/reactivate an org
// code. System defaults (org_id NULL) are non-deletable AND non-deactivatable
// by orgs (RLS UPDATE requires own-org), matching "defaults are seeded and
// non-deletable". Codes deactivate, never delete (append-only meaning:
// historical denial rows keep resolving inactive labels).

import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { DenialReasonCode } from "@/types";

const COLUMNS = "id, org_id, code, label, active, created_at";

/** All codes visible to this org — global defaults + org codes, INCLUDING
 * inactive ones (the management surface shows deactivated org codes so they can
 * be reactivated; the dropdown reader filters active). */
export async function listAllDenialReasonCodes(): Promise<DenialReasonCode[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("denial_reason_codes")
    .select(COLUMNS)
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order("label", { ascending: true });
  if (error) throw error;
  return camelizeRow<DenialReasonCode[]>(data ?? []);
}

/** Derive a stable machine code from a label when the admin doesn't supply one. */
export function codeFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export interface DenialReasonCodeInput {
  label: string;
  code?: string;
}

export async function createDenialReasonCode(
  input: DenialReasonCodeInput,
): Promise<DenialReasonCode> {
  const orgId = requireActiveOrg();
  const label = input.label.trim();
  if (!label) throw new Error("A reason label is required");
  const code = input.code?.trim() || codeFromLabel(label) || "reason";

  const { data, error } = await supabase
    .from("denial_reason_codes")
    .insert({ org_id: orgId, code, label, active: true } as never)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const created = camelizeRow<DenialReasonCode>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "denial_reason_code",
    entityId: created.id,
    after: created,
    description: `Added denial reason code "${created.label}"`,
  });
  return created;
}

/** Deactivate (active=false) or reactivate an ORG reason code. Global defaults
 * are RLS-blocked from update, so this only ever touches own-org rows. */
export async function setDenialReasonCodeActive(
  id: string,
  active: boolean,
): Promise<DenialReasonCode> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("denial_reason_codes")
    .update({ active } as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const updated = camelizeRow<DenialReasonCode>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "denial_reason_code",
    entityId: updated.id,
    after: updated,
    description: `${active ? "Reactivated" : "Deactivated"} denial reason code "${updated.label}"`,
  });
  return updated;
}

// E4.2 payer governance — org_payer_settings CRUD (org-scoped, audited).
//
// The org × payer configuration grain: global payer facts stay Minted-curated
// on `payers`; what an ORGANIZATION configures about a payer lives here. Today
// that is exactly one setting with a confirmed consumer — the
// resolution-identifier label/expectedness the E4.0 approval step reads through
// src/lib/payerResolutionIdentifier.ts (org setting → Minted global fallback →
// generic default). RLS: member SELECT own-org; admin-only INSERT/UPDATE; no
// DELETE (clearing = updating the fields to NULL).
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import type { OrgPayerSetting } from "@/types";

export interface OrgPayerSettingInput {
  payerId: string;
  resolutionIdLabel: string | null;
  resolutionIdExpected: boolean | null;
}

export async function listOrgPayerSettings(): Promise<OrgPayerSetting[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase.from("org_payer_settings").select("*").eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<OrgPayerSetting[]>(data ?? []);
}

export async function upsertOrgPayerSetting(input: OrgPayerSettingInput): Promise<OrgPayerSetting> {
  const orgId = requireActiveOrg();
  const { data: existing, error: readError } = await supabase
    .from("org_payer_settings")
    .select("*")
    .eq("org_id", orgId)
    .eq("payer_id", input.payerId)
    .maybeSingle();
  if (readError) throw readError;
  const before = existing ? camelizeRow<OrgPayerSetting>(existing) : null;

  const { data, error } = await supabase
    .from("org_payer_settings")
    .upsert(
      {
        org_id: orgId,
        payer_id: input.payerId,
        resolution_id_label: input.resolutionIdLabel,
        resolution_id_expected: input.resolutionIdExpected,
        updated_by: currentUserId(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "org_id,payer_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<OrgPayerSetting>(data);
  await writeAudit({
    actionType: before ? "UPDATE" : "CREATE",
    entityType: "org_payer_setting",
    entityId: after.id,
    before,
    after,
    description: `${before ? "Updated" : "Set"} organization payer settings`,
  });
  return after;
}

// Org ↔ global-catalog payer assignments (P2). An assignment row links the
// active org to a global payer; `starter` flags it for the starter-pack
// case auto-attach on provider create (Epic 1c / P4). Reads are org-scoped
// under RLS; the starter write is admin-only (RLS enforces it, the UI also
// gates on useIsAdmin). No global payers are assigned today, so this is
// correct-but-inert on current data.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { OrgPayerAssignment } from "@/types";

export async function listAssignments(): Promise<OrgPayerAssignment[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("org_payer_assignments")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<OrgPayerAssignment[]>(data ?? []);
}

export async function setStarter(payerId: string, starter: boolean): Promise<void> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("org_payer_assignments")
    .update({ starter })
    .eq("org_id", orgId)
    .eq("payer_id", payerId)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<OrgPayerAssignment>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "org_payer_assignment",
    entityId: after.id,
    after,
    description: `${starter ? "Flagged" : "Cleared"} payer as starter`,
  });
}

// E4.1 F4.1.3 / E4.2 F4.2.5 — the org-level next-best-action ranking config.
// E4.1 shipped the READ seam (returning null → shipped default); E4.2 F4.2.5
// persists the row in `next_best_action_configs` and this file is now the read
// AND write boundary. The pure reducer consumes the validated shape via
// `resolveQueueRankingConfig` unchanged — a malformed stored row resolves to
// null (= shipped default), so a bad row can never corrupt the queue.

import { supabase } from "@/integrations/supabase/externalClient";
import { requireActiveOrg, writeAudit, currentUserId } from "@/lib/audit";
import { buildQueueRankingRow, type QueueRankingGroup } from "@/lib/queueSettings";

/** Read the org's stored ranking (raw jsonb) for the queue derivation. Returns
 * null when no row is saved → the shipped default applies. */
export async function getQueueRankingConfigRaw(): Promise<unknown> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("next_best_action_configs")
    .select("ranking")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data?.ranking ?? null;
}

/** Persist an admin-chosen ranking order for this org. Validated before write
 * (throws on an invalid order), audited, upserted on the org_id PK. */
export async function saveQueueRankingConfig(order: readonly QueueRankingGroup[]): Promise<void> {
  const orgId = requireActiveOrg();
  const ranking = buildQueueRankingRow(order);
  const { error } = await supabase.from("next_best_action_configs").upsert(
    {
      org_id: orgId,
      ranking: ranking as never,
      updated_by: currentUserId(),
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "org_id" },
  );
  if (error) throw error;
  await writeAudit({
    actionType: "UPDATE",
    entityType: "next_best_action_config",
    entityId: orgId,
    after: ranking,
    description: "Updated My Cases queue ranking",
  });
}

/** Reset to the shipped default by DELETing the org's override row. */
export async function resetQueueRankingConfig(): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase.from("next_best_action_configs").delete().eq("org_id", orgId);
  if (error) throw error;
  await writeAudit({
    actionType: "DELETE",
    entityType: "next_best_action_config",
    entityId: orgId,
    description: "Reset My Cases queue ranking to default",
  });
}

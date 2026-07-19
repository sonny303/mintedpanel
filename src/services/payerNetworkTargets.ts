// E1.5 TE-4/TE-5 — payer_network_targets CRUD. The attachment grain is
// group × payer × state under the org's "we work with this payer" intent;
// archive is ALWAYS a status flip (never a DELETE — deny → reapply is a
// normal payer cycle and E2.x case generation must be able to see the
// history), and restore is idempotent under the (group, payer, state)
// unique key because it re-activates the existing row instead of inserting.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { AttachmentSavePlan } from "@/lib/payerExpansion";
import { addAssignment, archiveAssignment } from "@/services/orgPayerAssignments";
import type { PayerNetworkTarget } from "@/types";

export async function listPayerNetworkTargets(): Promise<PayerNetworkTarget[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return camelizeRow<PayerNetworkTarget[]>(data ?? []);
}

/** Apply a reviewed attachment save plan for one payer: insert the brand-new
 * group×state rows as active and flip previously archived rows back on. */
export async function attachPayerTargets(payerId: string, plan: AttachmentSavePlan): Promise<void> {
  const orgId = requireActiveOrg();
  if (plan.inserts.length > 0) {
    const { data, error } = await supabase
      .from("payer_network_targets")
      .insert(
        plan.inserts.map((row) => ({
          org_id: orgId,
          payer_id: payerId,
          group_id: row.groupId,
          state: row.state,
          status: "active",
        })),
      )
      .select("*");
    if (error) throw error;
    const created = camelizeRow<PayerNetworkTarget[]>(data ?? []);
    for (const target of created) {
      await writeAudit({
        actionType: "CREATE",
        entityType: "payer_network_target",
        entityId: target.id,
        after: target,
        description: `Attached payer network target (${target.state})`,
      });
    }
  }
  for (const id of plan.restoreIds) {
    await restoreTarget(id);
  }
}

/** Flip one target to archived. Never a DELETE (TE-5). */
export async function archiveTarget(id: string): Promise<void> {
  await setTargetStatus(id, "archived");
}

/** Flip one archived target back to active — the one-click re-attach. */
export async function restoreTarget(id: string): Promise<void> {
  await setTargetStatus(id, "active");
}

// ---------------------------------------------------------------------------
// E6.2 F6.2.4 — group-basis attach/remove with IMPLICIT org enablement. The
// org_payer_assignments subscription row is created/archived as a side effect
// and never user-managed: attach ensures it exists (idempotent
// add/reactivate) BEFORE the target insert (the targets RLS WITH CHECK
// requires it); removal archives ONLY this group's targets, then archives the
// org enablement IFF no other group still holds an active target for the
// payer (multi-group honesty, TS-122/TS-124).
// ---------------------------------------------------------------------------

/** Attach a payer to a group: implicit enablement, then the reviewed plan. */
export async function attachGroupPayer(payerId: string, plan: AttachmentSavePlan): Promise<void> {
  await addAssignment(payerId);
  await attachPayerTargets(payerId, plan);
}

/** Archive one GROUP's active targets for a payer (never a DELETE). */
export async function archiveGroupPayerTargets(groupId: string, payerId: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .update({ status: "archived" })
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .eq("payer_id", payerId)
    .eq("status", "active")
    .select("*");
  if (error) throw error;
  const archived = camelizeRow<PayerNetworkTarget[]>(data ?? []);
  for (const target of archived) {
    await writeAudit({
      actionType: "UPDATE",
      entityType: "payer_network_target",
      entityId: target.id,
      after: target,
      description: `Archived payer network target (${target.state})`,
    });
  }
}

/** Remove a payer FROM ONE GROUP: archive that group's targets, then archive
 * the org-level enablement only when no other group still works the payer. */
export async function removeGroupPayer(groupId: string, payerId: string): Promise<void> {
  const orgId = requireActiveOrg();
  await archiveGroupPayerTargets(groupId, payerId);
  const { count, error } = await supabase
    .from("payer_network_targets")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("payer_id", payerId)
    .eq("status", "active");
  if (error) throw error;
  if ((count ?? 0) === 0) {
    await archiveAssignment(payerId);
  }
}

/** Archive every ACTIVE target for a payer — the payer-level archive
 * (F1.5.3). Already-archived rows are left untouched. */
export async function archivePayerTargets(payerId: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .update({ status: "archived" })
    .eq("org_id", orgId)
    .eq("payer_id", payerId)
    .eq("status", "active")
    .select("*");
  if (error) throw error;
  const archived = camelizeRow<PayerNetworkTarget[]>(data ?? []);
  for (const target of archived) {
    await writeAudit({
      actionType: "UPDATE",
      entityType: "payer_network_target",
      entityId: target.id,
      after: target,
      description: `Archived payer network target (${target.state})`,
    });
  }
}

async function setTargetStatus(id: string, status: "active" | "archived"): Promise<void> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .update({ status })
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<PayerNetworkTarget>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "payer_network_target",
    entityId: after.id,
    after,
    description: `${status === "archived" ? "Archived" : "Restored"} payer network target (${after.state})`,
  });
}

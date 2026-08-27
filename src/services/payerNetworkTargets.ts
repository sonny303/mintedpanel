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
  await attachPayerTargetsBulk([{ payerId, plan }]);
}

/** Apply reviewed plans for MANY payers in one pass: every brand-new row across
 * every payer goes in as ONE insert (the multi-select attach saves a whole
 * selection, not a payer at a time), then archived rows flip back on. Each
 * created row still gets its own audit entry. */
export async function attachPayerTargetsBulk(
  entries: readonly { payerId: string; plan: AttachmentSavePlan }[],
): Promise<void> {
  const orgId = requireActiveOrg();
  const inserts = entries.flatMap((entry) =>
    entry.plan.inserts.map((row) => ({
      org_id: orgId,
      payer_id: entry.payerId,
      group_id: row.groupId,
      state: row.state,
      status: "active",
    })),
  );
  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from("payer_network_targets")
      .insert(inserts)
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
  for (const entry of entries) {
    for (const id of entry.plan.restoreIds) {
      await restoreTarget(id);
    }
  }
}

/** Set/clear the payer-issued GROUP identifier (group PIN) on one target —
 * the 2026-07-20 re-scope's group-level capture (a payer issues a group ID
 * under the group's contract, per state where they differ). Audited; the RLS
 * admin-write policy governs who may set it. */
export async function setTargetIdentifier(
  id: string,
  payerIssuedId: string | null,
): Promise<PayerNetworkTarget> {
  const orgId = requireActiveOrg();
  const value = payerIssuedId?.trim() ? payerIssuedId.trim() : null;
  const { data, error } = await supabase
    .from("payer_network_targets")
    .update({ payer_issued_id: value } as never)
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
    description: value
      ? `Set payer-issued group ID on network target (${after.state})`
      : `Cleared payer-issued group ID on network target (${after.state})`,
  });
  return after;
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
// E6.2 F6.2.4 — group-basis attach/remove. OPA-RETIRE (R1 B): org_payer_assignments
// is dormant as a gate — attach writes targets only (WITH CHECK no longer
// requires an assignment row). Removal archives THIS group's targets only.
// ---------------------------------------------------------------------------

/** Attach a payer to a group: the reviewed target plan only. */
export async function attachGroupPayer(payerId: string, plan: AttachmentSavePlan): Promise<void> {
  await attachPayerTargets(payerId, plan);
}

/** Attach SEVERAL payers to a group in one save — the multi-select picker's
 * write. Same reviewed-plan shape per payer, one insert for the whole batch. */
export async function attachGroupPayers(
  entries: readonly { payerId: string; plan: AttachmentSavePlan }[],
): Promise<void> {
  await attachPayerTargetsBulk(entries);
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

/** Remove a payer FROM ONE GROUP: archive that group's targets only. */
export async function removeGroupPayer(groupId: string, payerId: string): Promise<void> {
  await archiveGroupPayerTargets(groupId, payerId);
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

// Group×state payer-attachment targets (redesign E1.5). The wizard's Payer
// Network section writes ONLY through here: attach creates/restores rows from
// the REVIEWED expansion plan (src/lib/payerExpansion.ts — only checked rows
// are passed in), and removal flips status to "archived" — never a DELETE
// (TE-5; this table is not an append-only spine, so the status UPDATE is
// legitimate). RLS: member SELECT own-org; admin-only writes whose WITH
// CHECKs also require a same-org group and an org_payer_assignments row.
// Every insert sets org_id from the active org; every mutation audits.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeStateCode } from "@/lib/stateCode";
import type { PayerNetworkTarget } from "@/types";

export async function listTargets(): Promise<PayerNetworkTarget[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at");
  if (error) throw error;
  return camelizeRow<PayerNetworkTarget[]>(data ?? []);
}

export interface AttachTargetRow {
  groupId: string;
  state: string;
}

export interface AttachTargetsInput {
  payerId: string;
  /** Checked "new" rows from the reviewed expansion — inserted as active. */
  create: AttachTargetRow[];
  /** Checked previously-archived row ids — restored, never re-inserted (the
   * unique (group_id, payer_id, state) key makes a duplicate insert fail). */
  restoreIds: string[];
}

// One attach action (F1.5.1–F1.5.3): insert the checked new rows, flip the
// checked archived rows back to active. No-op input writes nothing.
export async function attachTargets(input: AttachTargetsInput): Promise<PayerNetworkTarget[]> {
  const orgId = requireActiveOrg();
  if (input.create.length === 0 && input.restoreIds.length === 0) return [];
  const results: PayerNetworkTarget[] = [];

  if (input.create.length > 0) {
    const rows = input.create.map((row) => ({
      org_id: orgId,
      payer_id: input.payerId,
      group_id: row.groupId,
      state: normalizeStateCode(row.state),
    }));
    const { data, error } = await supabase
      .from("payer_network_targets")
      .insert(rows as never)
      .select("*");
    if (error) throw error;
    results.push(...camelizeRow<PayerNetworkTarget[]>(data ?? []));
  }

  if (input.restoreIds.length > 0) {
    const { data, error } = await supabase
      .from("payer_network_targets")
      .update({ status: "active" } as never)
      .eq("org_id", orgId)
      .eq("payer_id", input.payerId)
      .in("id", input.restoreIds)
      .select("*");
    if (error) throw error;
    results.push(...camelizeRow<PayerNetworkTarget[]>(data ?? []));
  }

  await writeAudit({
    actionType: "CREATE",
    entityType: "payer_network_target",
    entityId: input.payerId,
    after: results,
    description: `Attached payer network targets (${input.create.length} created, ${input.restoreIds.length} restored)`,
  });
  return results;
}

// Archive ONE group×state target (F1.5.3): status flip, history kept.
export async function archiveTarget(id: string): Promise<PayerNetworkTarget> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .update({ status: "archived" } as never)
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
    description: `Archived payer network target (${after.state})`,
  });
  return after;
}

// Restore ONE archived target in one click (F1.5.3). Idempotent under the
// unique key — a restore flips the existing row, it never inserts.
export async function restoreTarget(id: string): Promise<PayerNetworkTarget> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .update({ status: "active" } as never)
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
    description: `Restored payer network target (${after.state})`,
  });
  return after;
}

// Payer-level removal (F1.5.3): archive every ACTIVE target for the payer.
// Existing cases/contracts are untouched — this service writes only its own
// table (TE-5).
export async function archivePayerTargets(payerId: string): Promise<PayerNetworkTarget[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_network_targets")
    .update({ status: "archived" } as never)
    .eq("org_id", orgId)
    .eq("payer_id", payerId)
    .eq("status", "active")
    .select("*");
  if (error) throw error;
  const after = camelizeRow<PayerNetworkTarget[]>(data ?? []);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "payer_network_target",
    entityId: payerId,
    after,
    description: `Archived payer attachment (${after.length} targets)`,
  });
  return after;
}

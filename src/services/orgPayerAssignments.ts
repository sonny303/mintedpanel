// Org ↔ global-catalog payer assignments. An assignment row is the org's
// SUBSCRIPTION to a canonical payer (the E1.5 attach picker's curated shortlist
// reads active subscriptions; `starter` flags the starter-pack case auto-attach
// on provider create). E4.2 hardening makes the subscription a first-class,
// reversible, history-safe lifecycle:
//   - addAssignment       — add a canonical payer to the org (idempotent).
//   - archiveAssignment   — remove it; ARCHIVES (never DELETE) and cascades to
//                           its active payer_network_targets in ONE transaction
//                           via the archive_org_payer_assignment RPC.
//   - reactivateAssignment— bring an archived subscription back; a status flip
//                           ONLY — it never recreates payer_network_targets
//                           scope (archived targets stay archived for the
//                           existing restore/review flow).
//   - setStarter          — the pre-existing starter flag (retained).
// Reads are org-scoped under RLS; every write is admin-only (RLS enforces it,
// the UI also gates on useIsAdmin) and audited.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { isActiveAssignment } from "@/lib/payerCatalogActions";
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

async function getAssignment(orgId: string, payerId: string): Promise<OrgPayerAssignment | null> {
  const { data, error } = await supabase
    .from("org_payer_assignments")
    .select("*")
    .eq("org_id", orgId)
    .eq("payer_id", payerId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<OrgPayerAssignment>(data) : null;
}

/**
 * Add a canonical payer to the active organization. Idempotent (F item 3
 * "adding twice is harmless"):
 *   - an already-active subscription is returned untouched (no audit noise);
 *   - an archived subscription is reactivated (the deny-then-reapply path);
 *   - otherwise a fresh active subscription is inserted.
 * The unique `(org_id, payer_id)` backstops a concurrent double-add.
 */
export async function addAssignment(payerId: string): Promise<OrgPayerAssignment> {
  const orgId = requireActiveOrg();
  const existing = await getAssignment(orgId, payerId);
  if (existing) {
    return isActiveAssignment(existing) ? existing : reactivateAssignment(payerId);
  }

  const { data, error } = await supabase
    .from("org_payer_assignments")
    .insert({ org_id: orgId, payer_id: payerId, status: "active" } as never)
    .select("*")
    .single();
  if (error) {
    // Concurrent add — the unique constraint won the race; converge to active.
    if ((error as { code?: string }).code === "23505") {
      const row = await getAssignment(orgId, payerId);
      if (row) return isActiveAssignment(row) ? row : reactivateAssignment(payerId);
    }
    throw error;
  }
  const created = camelizeRow<OrgPayerAssignment>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "org_payer_assignment",
    entityId: created.id,
    after: created,
    description: "Added payer to organization",
  });
  return created;
}

/** Bring an archived subscription back to active — a status flip ONLY. It never
 * recreates payer_network_targets scope: archived targets remain archived for
 * the existing restore/review flow (F item 2). */
export async function reactivateAssignment(payerId: string): Promise<OrgPayerAssignment> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("org_payer_assignments")
    .update({ status: "active", archived_at: null } as never)
    .eq("org_id", orgId)
    .eq("payer_id", payerId)
    .select("*")
    .single();
  if (error) throw error;
  const updated = camelizeRow<OrgPayerAssignment>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "org_payer_assignment",
    entityId: updated.id,
    after: updated,
    description: "Reactivated payer for organization",
  });
  return updated;
}

export interface ArchiveAssignmentResult {
  assignment: OrgPayerAssignment;
  archivedTargetCount: number;
}

/** Archive an org payer subscription AND its active payer_network_targets in one
 * transaction (the RPC — two PostgREST UPDATEs are not atomic). Never a DELETE;
 * the row and all target history survive so reactivation is lossless. */
export async function archiveAssignment(payerId: string): Promise<ArchiveAssignmentResult> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("archive_org_payer_assignment", {
    p_org_id: orgId,
    p_payer_id: payerId,
  });
  if (error) throw mapArchiveError(error);
  const payload = (data ?? {}) as {
    assignment?: Record<string, unknown>;
    archived_target_count?: number;
  };
  const assignment = camelizeRow<OrgPayerAssignment>(payload.assignment ?? {});
  const archivedTargetCount = payload.archived_target_count ?? 0;
  await writeAudit({
    actionType: "UPDATE",
    entityType: "org_payer_assignment",
    entityId: assignment.id,
    after: assignment,
    description:
      archivedTargetCount > 0
        ? `Archived payer from organization (also archived ${archivedTargetCount} network target${
            archivedTargetCount === 1 ? "" : "s"
          })`
        : "Archived payer from organization",
  });
  return { assignment, archivedTargetCount };
}

function mapArchiveError(error: unknown): Error {
  const msg =
    error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "");
  if (msg.includes("org_payer_assignment_admin_only")) {
    return new Error("Only an administrator can archive an organization payer.");
  }
  if (msg.includes("org_payer_assignment_not_found")) {
    return new Error("That payer is not assigned to this organization.");
  }
  return error instanceof Error ? error : new Error(msg || "Couldn't archive the payer.");
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

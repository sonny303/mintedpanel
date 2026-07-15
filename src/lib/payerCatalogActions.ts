// E4.2 hardening (canonical payer selection & org assignment) — pure directory
// action derivation. Given a global-catalog payer and the org's assignment
// subscriptions, decide the single control the directory shows for that payer,
// and how the downstream "Payer Setup" surface explains an empty state. No
// Supabase, no React — the components stay thin and every branch is unit-tested
// (retired/merged, add/added/reactivate, empty-state discrimination).
import type { OrgPayerAssignment, Payer } from "@/types";

/** A missing status (pre-hardening row / fixture) reads as active. */
export function isActiveAssignment(
  a: Pick<OrgPayerAssignment, "status"> | null | undefined,
): boolean {
  return !!a && (a.status ?? "active") === "active";
}

/** Index assignments by payerId for O(1) per-row lookup. */
export function assignmentsByPayerId(
  assignments: readonly OrgPayerAssignment[],
): Map<string, OrgPayerAssignment> {
  const map = new Map<string, OrgPayerAssignment>();
  for (const a of assignments) map.set(a.payerId, a);
  return map;
}

export type CatalogActionKind = "add" | "added" | "reactivate" | "unavailable";

export interface CatalogAction {
  kind: CatalogActionKind;
  /** For `unavailable`: why the payer can't be newly added. */
  reason?: "merged" | "retired";
  /** For `unavailable`: the canonical successor payer, when the catalog knows it. */
  successor?: Payer | null;
}

/**
 * The single directory control for one catalog payer, given the org's
 * assignment (if any) and a catalog lookup for successor resolution.
 *
 * Precedence (F item 3):
 *   1. active assignment      → "added" — you already work with it; the payer's
 *                               catalog status is informational once subscribed.
 *   2. merged/retired payer   → "unavailable" + successor — cannot be NEWLY added.
 *   3. archived assignment     → "reactivate" — the deny-then-reapply return path.
 *   4. otherwise (active payer, no assignment) → "add".
 */
export function catalogAction(
  payer: Pick<Payer, "id" | "status" | "mergedIntoId">,
  assignment: OrgPayerAssignment | null | undefined,
  payerById: ReadonlyMap<string, Payer>,
): CatalogAction {
  if (isActiveAssignment(assignment)) return { kind: "added" };

  const status = payer.status ?? "active";
  if (status !== "active") {
    const successor = payer.mergedIntoId ? (payerById.get(payer.mergedIntoId) ?? null) : null;
    return {
      kind: "unavailable",
      reason: status === "merged" ? "merged" : "retired",
      successor,
    };
  }

  if (assignment) return { kind: "reactivate" }; // archived assignment on an active payer
  return { kind: "add" };
}

export type PayerSetupEmptyState = "no_payers" | "no_scope";

/**
 * When the Payer Setup readiness matrix is empty (⟺ no ACTIVE payer_network_targets),
 * distinguish the two causes so the empty state points at the right next step
 * (F item 4b):
 *   - "no_payers": the org has no ACTIVE catalog subscriptions yet → browse the
 *     catalog and add a payer.
 *   - "no_scope": payers ARE subscribed but no credentialing scope is configured
 *     yet → configure credentialing scope (create group×state targets).
 */
export function payerSetupEmptyState(
  assignments: readonly OrgPayerAssignment[],
): PayerSetupEmptyState {
  return assignments.some(isActiveAssignment) ? "no_scope" : "no_payers";
}

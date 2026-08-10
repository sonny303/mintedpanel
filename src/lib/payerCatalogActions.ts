// E4.2 hardening → OPA-RETIRE (R1 B). Catalog directory actions used to read
// org_payer_assignments. Network membership is now target-derived.
import type { OrgPayerAssignment, Payer } from "@/types";

/** @deprecated OPA-RETIRE — assignments are dormant; prefer target membership. */
export function isActiveAssignment(
  a: Pick<OrgPayerAssignment, "status"> | null | undefined,
): boolean {
  return !!a && (a.status ?? "active") === "active";
}

/** @deprecated OPA-RETIRE — keep for legacy callers / merge_payer history. */
export function assignmentsByPayerId(
  assignments: readonly OrgPayerAssignment[],
): Map<string, OrgPayerAssignment> {
  const map = new Map<string, OrgPayerAssignment>();
  for (const a of assignments) map.set(a.payerId, a);
  return map;
}

export type CatalogActionKind = "add" | "added" | "unavailable";

export interface CatalogAction {
  kind: CatalogActionKind;
  /** For `unavailable`: why the payer can't be newly attached. */
  reason?: "merged" | "retired";
  /** For `unavailable`: the canonical successor payer, when the catalog knows it. */
  successor?: Payer | null;
}

/**
 * The single directory control for one catalog payer.
 *
 * Precedence (OPA-RETIRE):
 *   1. inNetwork (has active target) → "added"
 *   2. merged/retired payer          → "unavailable" + successor
 *   3. otherwise                     → "add" (attach via group board)
 */
export function catalogAction(
  payer: Pick<Payer, "id" | "status" | "mergedIntoId">,
  inNetwork: boolean,
  payerById: ReadonlyMap<string, Payer>,
): CatalogAction {
  if (inNetwork) return { kind: "added" };

  const status = payer.status ?? "active";
  if (status !== "active") {
    const successor = payer.mergedIntoId ? (payerById.get(payer.mergedIntoId) ?? null) : null;
    return {
      kind: "unavailable",
      reason: status === "merged" ? "merged" : "retired",
      successor,
    };
  }

  return { kind: "add" };
}

export type PayerSetupEmptyState = "no_payers" | "no_scope";

/**
 * When the Payer Setup readiness matrix is empty (⟺ no ACTIVE
 * payer_network_targets), both causes collapse to the same door after
 * OPA-RETIRE: attach a payer to a group (that creates the targets). Kept as
 * a two-value union so callers that still branch copy stay typed.
 */
export function payerSetupEmptyState(
  targets: readonly Pick<{ status: string }, "status">[],
): PayerSetupEmptyState {
  return targets.some((t) => t.status === "active") ? "no_scope" : "no_payers";
}

// E4.2 unified payer setup → E6.5 slim-down → OPA-RETIRE (R1 B, 2026-08-10).
// Inclusion used to read org_payer_assignments. That table is now DORMANT as a
// gate — "in my network" = ≥1 active payer_network_targets row (group attach).
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type { Payer, PayerNetworkTarget } from "@/types";

export interface ActiveOrgPayer {
  payer: Payer;
}

/** Active target payer ids — the OPA-RETIRE network set. */
export function networkPayerIdsFromTargets(
  targets: readonly Pick<PayerNetworkTarget, "payerId" | "status">[],
): Set<string> {
  const out = new Set<string>();
  for (const t of targets) {
    if (t.status === "active") out.add(t.payerId);
  }
  return out;
}

/**
 * The "active organization payer" inclusion rule the whole workspace shares:
 * a catalog payer with ≥1 ACTIVE payer_network_targets row — never an
 * org_payer_assignments row (OPA-RETIRE). The Pre-Credentialing Setup
 * sentinel is excluded. ARCHIVED payers (`archivedAt`) are excluded unless
 * `includeArchived` (Show-archived toggle).
 */
export function activeOrgPayers(
  payers: readonly Payer[],
  targets: readonly Pick<PayerNetworkTarget, "payerId" | "status">[],
  opts?: { includeArchived?: boolean },
): ActiveOrgPayer[] {
  const inNetwork = networkPayerIdsFromTargets(targets);
  const out: ActiveOrgPayer[] = [];
  for (const payer of payers) {
    if (payer.name === PRE_CRED_PAYER_NAME) continue;
    if (payer.archivedAt != null && !opts?.includeArchived) continue;
    if (!inNetwork.has(payer.id)) continue;
    out.push({ payer });
  }
  out.sort((a, b) => a.payer.name.localeCompare(b.payer.name));
  return out;
}

/**
 * E6.8 F6.8.1 — the archived-payer id set the composition hooks filter
 * against (generation candidates drop targets whose payer is archived; the
 * targets themselves are untouched, so reactivation restores the scope
 * with zero writes).
 */
export function archivedPayerIds(payers: readonly Pick<Payer, "id" | "archivedAt">[]): Set<string> {
  const out = new Set<string>();
  for (const payer of payers) {
    if (payer.archivedAt != null) out.add(payer.id);
  }
  return out;
}

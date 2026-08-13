// E4.2 unified payer setup → E6.5 slim-down → OPA-RETIRE (R1 B, 2026-08-10)
// → catalog Setup (2026-08-13). There is no org↔payer assignment. Payer Setup
// lists the global catalog. Group attach (`payer_network_targets`) is the
// operational grain and lives on Groups → Payer Network. `activeOrgPayers`
// still means "payers this org's groups already work with" for generation,
// attach pickers, and the manual-case door — never for Setup.
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type { Payer, PayerNetworkTarget } from "@/types";

export interface ActiveOrgPayer {
  payer: Payer;
}

/** Active target payer ids — the group-attach set, not an org assignment. */
export function networkPayerIdsFromTargets(
  targets: readonly Pick<PayerNetworkTarget, "payerId" | "status">[],
): Set<string> {
  const out = new Set<string>();
  for (const t of targets) {
    if (t.status === "active") out.add(t.payerId);
  }
  return out;
}

function passesCatalogFilters(payer: Payer, opts?: { includeArchived?: boolean }): boolean {
  if (payer.name === PRE_CRED_PAYER_NAME) return false;
  if (payer.archivedAt != null && !opts?.includeArchived) return false;
  return true;
}

function sortByPayerName(rows: ActiveOrgPayer[]): ActiveOrgPayer[] {
  rows.sort((a, b) => a.payer.name.localeCompare(b.payer.name));
  return rows;
}

/**
 * Payer Setup + the readiness funnel: every catalog payer, with no group-attach
 * filter. The Pre-Credentialing Setup sentinel is excluded. ARCHIVED payers
 * (`archivedAt`) are excluded unless `includeArchived` (Show-archived toggle).
 */
export function catalogSetupPayers(
  payers: readonly Payer[],
  opts?: { includeArchived?: boolean },
): ActiveOrgPayer[] {
  const out: ActiveOrgPayer[] = [];
  for (const payer of payers) {
    if (!passesCatalogFilters(payer, opts)) continue;
    out.push({ payer });
  }
  return sortByPayerName(out);
}

/**
 * Payers this org's groups already work with: a catalog payer with ≥1 ACTIVE
 * payer_network_targets row — never an org_payer_assignments row (OPA-RETIRE).
 * Used by generation, attach pickers, and the manual-case door. Payer Setup
 * uses `catalogSetupPayers` instead.
 */
export function activeOrgPayers(
  payers: readonly Payer[],
  targets: readonly Pick<PayerNetworkTarget, "payerId" | "status">[],
  opts?: { includeArchived?: boolean },
): ActiveOrgPayer[] {
  const inNetwork = networkPayerIdsFromTargets(targets);
  const out: ActiveOrgPayer[] = [];
  for (const payer of payers) {
    if (!passesCatalogFilters(payer, opts)) continue;
    if (!inNetwork.has(payer.id)) continue;
    out.push({ payer });
  }
  return sortByPayerName(out);
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

// E4.2 payer governance — pure rules for the legacy org-scoped payer cutover
// (docs/data-model/legacy-payer-cutover.md is the live inventory + result
// record this module backs).
//
// Two locked properties, machine-checkable here and enforced by having NO
// org-user delete path at all:
//   1. A legacy payer with ANY reference can never be deleted — every
//      case/contract/SOP/target/assignment reference must be re-keyed to the
//      canonical catalog identity first.
//   2. Canonical matching only ever PROPOSES: exact slug, exact normalized
//      name, or exact normalized alias. No fuzzy/substring auto-match, and the
//      "Pre-Credentialing Setup" workflow sentinel is never matched, re-keyed,
//      or deleted (it represents current work by design).
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import type { Payer } from "@/types";

/** Live FK reference counts for one legacy payer row — one field per table
 * with a foreign key to payers (enumerated from pg_constraint; the cutover doc
 * carries the query). */
export interface LegacyPayerReferenceCounts {
  cases: number;
  contracts: number;
  routingRules: number;
  sopTemplates: number;
  networkTargets: number;
  assignments: number;
  generationExclusions: number;
  generationRunRows: number;
  communicationEvents: number;
  catalogChanges: number;
  portals: number;
  /** payers.merged_into_id rows pointing at this row. */
  payerSelfRefs: number;
}

export function totalReferences(counts: LegacyPayerReferenceCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** The sentinel is matched by NAME across the app (the statuses idiom); it is
 * a workflow placeholder, not a payer identity. */
export function isSentinelPayer(payer: Pick<Payer, "name">): boolean {
  return payer.name === PRE_CRED_PAYER_NAME;
}

/** True only for a zero-reference, non-sentinel legacy row — the ONLY rows the
 * human-confirmed cleanup may delete. Referenced rows must be re-keyed first;
 * the sentinel is never deletable. */
export function canDeleteLegacyPayer(
  payer: Pick<Payer, "name" | "orgId">,
  counts: LegacyPayerReferenceCounts,
): boolean {
  if (payer.orgId === null) return false; // global rows are not legacy rows
  if (isSentinelPayer(payer)) return false;
  return totalReferences(counts) === 0;
}

/** Lowercase, strip punctuation, collapse whitespace — the exact-match key. */
export function normalizePayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Canonical-match PROPOSALS for one legacy payer against the global catalog:
 * exact slug match (legacy rows have no slug today, so this arms only if one
 * is ever backfilled), exact normalized-name match, or exact normalized-alias
 * match. Deliberately NO fuzzy/substring matching — "Medicare" must never
 * auto-propose "Great Plains Medicare Advantage". The sentinel never matches.
 * The human confirms every mapping; nothing here applies anything.
 */
export function canonicalMatchCandidates(
  legacy: Pick<Payer, "name" | "payerSlug">,
  globalPayers: readonly Payer[],
): Payer[] {
  if (isSentinelPayer(legacy)) return [];
  const norm = normalizePayerName(legacy.name);
  return globalPayers.filter((g) => {
    if (g.orgId !== null) return false;
    if (legacy.payerSlug && g.payerSlug && legacy.payerSlug === g.payerSlug) return true;
    if (normalizePayerName(g.name) === norm) return true;
    return (g.aliases ?? []).some((a) => normalizePayerName(a) === norm);
  });
}

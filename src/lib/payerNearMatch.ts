// E6.7 F6.7.3 — pure near-match helpers for the future "+ Set up payer"
// dialog's "use this instead" picker. The create_payer RPC is the enforcement
// backstop (its in-body guard raises payer_duplicate); these helpers let the
// UI surface collisions BEFORE submit, with the same normalization the RPC
// uses so the two never disagree on an exact match.

import type { Payer } from "@/types";

/**
 * The normalized-name key: lowercase, trim, collapse internal whitespace.
 * Mirrors the SQL `_payer_norm_name` helper (migration 20260727120000) — keep
 * the two in lockstep; an exact match here IS a `payer_duplicate` server-side.
 */
export function normalizePayerName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type PayerMatchKind = "exact_name" | "exact_alias" | "partial";

export interface PayerNearMatch {
  payer: Payer;
  /** exact_* kinds are the ones the create_payer duplicate guard rejects;
   * partial is advisory ("did you mean…") and never blocks. */
  matchKind: PayerMatchKind;
  /** For a merged match the picker should offer the successor instead —
   * resolved from the passed pool when present. */
  successor: Payer | null;
}

/** Partial matching below this many normalized characters is noise. */
const MIN_PARTIAL_QUERY_LENGTH = 3;

function matchKindFor(query: string, payer: Payer): PayerMatchKind | null {
  const name = normalizePayerName(payer.name);
  const aliases = (payer.aliases ?? []).map(normalizePayerName).filter((a) => a !== "");
  if (name === query) return "exact_name";
  if (aliases.includes(query)) return "exact_alias";
  if (query.length < MIN_PARTIAL_QUERY_LENGTH) return null;
  const partial =
    name.includes(query) ||
    query.includes(name) ||
    aliases.some((a) => a.includes(query) || query.includes(a));
  return partial ? "partial" : null;
}

const KIND_RANK: Record<PayerMatchKind, number> = {
  exact_name: 0,
  exact_alias: 1,
  partial: 2,
};

/**
 * Find catalog rows the typed name collides with or resembles, ranked
 * exact-name → exact-alias → partial, then A→Z. Retired rows are excluded
 * (their names are re-registrable per the RPC guard); merged rows stay IN so
 * the picker can surface the successor ("X was merged into Y — add Y").
 */
export function findPayerNearMatches(name: string, payers: readonly Payer[]): PayerNearMatch[] {
  const query = normalizePayerName(name);
  if (query === "") return [];
  const byId = new Map(payers.map((p) => [p.id, p]));
  return payers
    .filter((p) => (p.status ?? "active") !== "retired")
    .flatMap((p) => {
      const kind = matchKindFor(query, p);
      if (!kind) return [];
      const successor =
        p.status === "merged" && p.mergedIntoId ? (byId.get(p.mergedIntoId) ?? null) : null;
      return [{ payer: p, matchKind: kind, successor }];
    })
    .sort(
      (a, b) =>
        KIND_RANK[a.matchKind] - KIND_RANK[b.matchKind] || a.payer.name.localeCompare(b.payer.name),
    );
}

/** True when the typed name would be rejected outright by create_payer —
 * an exact normalized collision with a non-retired row's name or alias. */
export function hasBlockingPayerMatch(name: string, payers: readonly Payer[]): boolean {
  return findPayerNearMatches(name, payers).some((m) => m.matchKind !== "partial");
}

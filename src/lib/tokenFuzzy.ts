// Fuzzy filter for the field-registry token picker.
//
// The catalog is 100+ keys across a dozen families; a plain Select forces the
// trainer to scroll. Matching is deliberate and dependency-free: substring
// beats subsequence, camelCase / dotted keys are searchable as words
// ("first name" → provider.firstName), and group labels count so typing
// "license" surfaces that family even when the leaf key doesn't repeat it.

import type { SopFieldToken, TokenGroup } from "@/lib/tokenGroups";

/** Expand a catalog key into matchable text: dots + camelCase → words. */
export function searchableTokenText(token: string): string {
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]+/g, " ")
    .toLowerCase();
}

/**
 * Score how well `query` matches `candidate`. Higher is better.
 * Returns null when the candidate is not a match.
 *
 * Empty / whitespace query is not scored here — callers treat it as "show all".
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return null;
  const c = candidate.toLowerCase();
  if (c.length === 0) return null;

  const idx = c.indexOf(q);
  if (idx !== -1) {
    // Prefer earlier + shorter haystacks so "npi" ranks provider.npi above a
    // longer key that merely contains the letters as a substring later.
    return 1000 - idx - Math.min(c.length, 200) * 0.01;
  }

  // Contiguous-run-aware subsequence: every query char must appear in order.
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) {
      score += i === last + 1 ? 5 : 1;
      last = i;
      qi++;
    }
  }
  if (qi !== q.length) return null;
  return score;
}

function bestTokenScore(query: string, token: SopFieldToken, groupLabel: string): number | null {
  const haystacks = [
    token.token,
    searchableTokenText(token.token),
    token.column.replace(/_/g, " "),
    groupLabel,
  ];
  let best: number | null = null;
  for (const h of haystacks) {
    const s = fuzzyScore(query, h);
    if (s == null) continue;
    if (best == null || s > best) best = s;
  }
  return best;
}

/**
 * Filter grouped tokens by a fuzzy query, preserving family headings.
 * Within each surviving group, items are ranked by score (then token key).
 * Empty query returns the groups unchanged (stable catalog order).
 */
export function filterTokenGroups(groups: readonly TokenGroup[], query: string): TokenGroup[] {
  const q = query.trim();
  if (q.length === 0) return [...groups];

  const scored = groups
    .map((group) => {
      const items = group.items
        .map((item) => ({ item, score: bestTokenScore(q, item, group.label) }))
        .filter((row): row is { item: SopFieldToken; score: number } => row.score != null)
        .sort((a, b) => b.score - a.score || a.item.token.localeCompare(b.item.token))
        .map((row) => row.item);
      const top = items.length === 0 ? null : bestTokenScore(q, items[0], group.label);
      return { group: { ...group, items }, top };
    })
    .filter((row) => row.group.items.length > 0);

  scored.sort((a, b) => (b.top ?? 0) - (a.top ?? 0));
  return scored.map((row) => row.group);
}

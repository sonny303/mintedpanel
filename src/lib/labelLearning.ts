// S5.3 — label learning: a mapping made on ONE payer's form becomes a
// suggestion on another's, with the evidence that earned it.
//
// Two sources, in priority order:
//   1. the org's field_dictionary (an explicit human decision: "this label
//      means this token"), and
//   2. approved portal_field_maps carrying the same normalized label on OTHER
//      portals (observed practice).
//
// The evidence shown to the user is the PORTAL COUNT — how many distinct
// payer portals already map this label to this token. That is the honest
// unit: "we've mapped this on 3 other payers" is checkable, whereas a bare
// confidence score is not.
//
// Pure: the caller supplies the rows. Labels arrive already normalized
// (normalizeFieldLabel at the read boundary), so matching is a literal
// compare — the same discipline as portal keys and tokens.

/** One approved mapping observed elsewhere, reduced to what learning needs. */
export interface ObservedMapping {
  /** Normalized field label. */
  label: string;
  /** Bare catalog token key. */
  token: string;
  /** The portal it was observed on (normalized key). */
  portalKey: string;
}

/** An explicit dictionary entry: this org decided this label means this token. */
export interface DictionaryEntry {
  label: string;
  token: string;
  status: string;
}

export interface LabelSuggestion {
  token: string;
  /** Distinct OTHER portals where this label already maps to this token. 0
   * when the only evidence is a dictionary entry with no observed use. */
  portalCount: number;
  /** Whether an explicit dictionary decision backs this suggestion. */
  fromDictionary: boolean;
}

/** Suggest a token for `label`, excluding evidence from `excludePortalKey`
 * (the portal being captured — its own rows can't be evidence for itself).
 *
 * A confirmed dictionary entry wins outright: it is a human decision, and
 * observed rows are how the system guesses. Otherwise the token observed on
 * the most distinct other portals wins; ties break on the token string so the
 * result is stable across reads. Returns null when nothing backs a guess —
 * an honest blank beats a wrong autofill. */
export function suggestTokenForLabel(
  label: string,
  dictionary: readonly DictionaryEntry[],
  observed: readonly ObservedMapping[],
  excludePortalKey: string | null,
): LabelSuggestion | null {
  if (!label) return null;

  // Count distinct OTHER portals per token.
  const portalsByToken = new Map<string, Set<string>>();
  for (const row of observed) {
    if (row.label !== label || !row.token) continue;
    if (excludePortalKey != null && row.portalKey === excludePortalKey) continue;
    let set = portalsByToken.get(row.token);
    if (!set) {
      set = new Set<string>();
      portalsByToken.set(row.token, set);
    }
    set.add(row.portalKey);
  }

  // A rejected dictionary entry is a decision too — it means "don't suggest
  // this" — so only confirmed/suggested entries can back a suggestion.
  const decided = dictionary.find((d) => d.label === label && d.token && d.status !== "rejected");
  if (decided) {
    return {
      token: decided.token,
      portalCount: portalsByToken.get(decided.token)?.size ?? 0,
      fromDictionary: true,
    };
  }

  let best: LabelSuggestion | null = null;
  for (const [token, portals] of portalsByToken) {
    const candidate = { token, portalCount: portals.size, fromDictionary: false };
    if (
      best == null ||
      candidate.portalCount > best.portalCount ||
      (candidate.portalCount === best.portalCount && token < best.token)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** Human-readable evidence for a suggestion, or null when there is none to
 * show. Kept here so the panel and the extension word it identically. */
export function suggestionEvidence(suggestion: LabelSuggestion): string | null {
  if (suggestion.portalCount > 0) {
    const noun = suggestion.portalCount === 1 ? "payer" : "payers";
    return `Mapped this way on ${suggestion.portalCount} other ${noun}`;
  }
  return suggestion.fromDictionary ? "Your organization mapped this label before" : null;
}

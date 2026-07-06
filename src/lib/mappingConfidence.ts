// Pure confidence resolution + batch splitting for Mapping review (Surface 2).
// Deterministic and unit-tested — the training flow renders straight off this.
//
// High-confidence fields batch into one "confirm all N" screen; medium/low go
// one card at a time. Confidence is resolved client-side per proposed row from
// the org's dictionary and the row's captured confidence score.
import { normalizeFieldLabel } from "@/lib/tokenFormat";
import type { FieldDictionaryEntry, PortalFieldMap } from "@/types";

export type Confidence = "high" | "medium" | "low";

export type Provenance = "dictionary" | "label" | "none";

export interface TrainingCard {
  row: PortalFieldMap;
  confidence: Confidence;
  // The token to pre-fill: a confirmed dictionary rule wins over the row's own
  // captured suggestion. null when nothing is suggested (card opens the picker).
  suggestedToken: string | null;
  provenance: Provenance;
}

export interface SplitResult {
  batch: TrainingCard[];
  cards: TrainingCard[];
}

export function buildDictionaryMap(
  entries: FieldDictionaryEntry[],
): Map<string, FieldDictionaryEntry> {
  const map = new Map<string, FieldDictionaryEntry>();
  for (const e of entries) map.set(e.labelNormalized, e);
  return map;
}

// The token a suggestion resolves to: a confirmed dictionary rule for the row's
// label overrides the row's own captured token; a suggested rule only fills in
// when the row captured no token of its own; otherwise the captured token.
export function resolvedSuggestionToken(
  row: PortalFieldMap,
  dict: Map<string, FieldDictionaryEntry>,
): string | null {
  const label = normalizeFieldLabel(row.fieldLabel);
  const entry = label ? dict.get(label) : undefined;
  if (entry?.status === "confirmed") return entry.token;
  if (row.token != null) return row.token;
  if (entry?.status === "suggested") return entry.token;
  return null;
}

export function resolveConfidence(
  row: PortalFieldMap,
  dict: Map<string, FieldDictionaryEntry>,
): Confidence {
  const label = normalizeFieldLabel(row.fieldLabel);
  const entry = label ? dict.get(label) : undefined;
  // A confirmed rule is the strongest signal; a rejected label means the human
  // asked never to guess it — force it onto the manual/low path.
  if (entry?.status === "confirmed") return "high";
  if (entry?.status === "rejected") return "low";
  if (row.confidence != null) {
    if (row.confidence >= 80) return "high";
    if (row.confidence >= 40) return "medium";
    return "low";
  }
  // No numeric score: fall back to whether any suggestion exists at all.
  if (row.token != null || entry?.status === "suggested") return "medium";
  return "low";
}

// Provenance must agree with resolvedSuggestionToken: "dictionary" only when a
// dictionary entry actually supplied the token (confirmed always; suggested only
// when the row had no token of its own). A row's own captured token is "label".
function provenanceOf(
  row: PortalFieldMap,
  dict: Map<string, FieldDictionaryEntry>,
): Provenance {
  const label = normalizeFieldLabel(row.fieldLabel);
  const entry = label ? dict.get(label) : undefined;
  if (entry?.status === "confirmed") return "dictionary";
  if (row.token != null) return "label";
  if (entry?.status === "suggested") return "dictionary";
  return "none";
}

export function toTrainingCard(
  row: PortalFieldMap,
  dict: Map<string, FieldDictionaryEntry>,
): TrainingCard {
  const suggestedToken = resolvedSuggestionToken(row, dict);
  let confidence = resolveConfidence(row, dict);
  // A "high" rating with nothing to suggest isn't actionable as high: it needs
  // the same manual attention as a medium card and must not lead the deck or
  // batch. Downgrade so the badge, batch guard, and ordering all agree.
  if (confidence === "high" && suggestedToken == null) confidence = "medium";
  return {
    row,
    confidence,
    suggestedToken,
    provenance: provenanceOf(row, dict),
  };
}

const TIER_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

// High-confidence rows that resolve to a token batch into the confirm-all
// screen. Everything else becomes cards, medium before low, preserving capture
// order within a tier (a stable sort over the incoming order).
export function splitBatch(
  rows: PortalFieldMap[],
  entries: FieldDictionaryEntry[],
): SplitResult {
  const dict = buildDictionaryMap(entries);
  const batch: TrainingCard[] = [];
  const cards: TrainingCard[] = [];
  for (const row of rows) {
    const card = toTrainingCard(row, dict);
    if (card.confidence === "high" && card.suggestedToken != null) batch.push(card);
    else cards.push(card);
  }
  const withIndex = cards.map((card, i) => ({ card, i }));
  withIndex.sort((a, b) => {
    const t = TIER_RANK[a.card.confidence] - TIER_RANK[b.card.confidence];
    return t !== 0 ? t : a.i - b.i;
  });
  return { batch, cards: withIndex.map((x) => x.card) };
}

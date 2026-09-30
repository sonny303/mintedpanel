import { isPdfFillableToken } from "@/lib/fillTokenReach";
import { isReadablePdfLabel } from "@/lib/pdfFieldImport";
import { suggestTokenForLabel, type LabelSuggestion } from "@/lib/labelLearning";
import { normalizeFieldLabel, normalizeTokenKey } from "@/lib/tokenFormat";
import type { FieldDictionaryEntry, PortalFieldMap } from "@/types";

type PdfSuggestionRow = Pick<
  PortalFieldMap,
  "id" | "portalKey" | "fieldLabel" | "status" | "source" | "token"
>;

/** Payer PDFs often append a required-field marker that web labels omit. */
export function normalizePdfMatchLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return normalizeFieldLabel(raw.replace(/\s*[:*]?\s*\*?\s*required\s*$/i, ""));
}

/** A label repeated on this PDF can refer to different data (e.g. Group NPI
 * and Individual NPI). Do not teach or suggest from that label alone. */
export function pdfLabelIsUnique(label: string | null, rows: readonly PdfSuggestionRow[]): boolean {
  if (!isReadablePdfLabel(label) || label?.startsWith("Unlabeled PDF field")) return false;
  const normalized = normalizePdfMatchLabel(label);
  return rows.filter((row) => normalizePdfMatchLabel(row.fieldLabel) === normalized).length === 1;
}

/** Exact label matches from the existing mapping flywheel, offered for human
 * approval. Conflicting evidence and tokens this PDF cannot fill stay blank. */
export function suggestPdfFieldMappings(
  rows: readonly PdfSuggestionRow[],
  evidence: readonly PdfSuggestionRow[],
  dictionary: readonly Pick<FieldDictionaryEntry, "labelNormalized" | "token" | "status">[],
  allowedTokens: ReadonlySet<string>,
): Map<string, LabelSuggestion> {
  const suggestions = new Map<string, LabelSuggestion>();
  const dictionaryEntries = dictionary.map((entry) => ({
    label: normalizePdfMatchLabel(entry.labelNormalized) ?? "",
    token: normalizeTokenKey(entry.token) ?? "",
    status: entry.status,
  }));
  const observed = evidence
    .filter((row) => row.status === "approved" && row.source === "token" && row.token)
    .map((row) => ({
      label: normalizePdfMatchLabel(row.fieldLabel) ?? "",
      token: normalizeTokenKey(row.token) ?? "",
      portalKey: row.portalKey,
    }));

  for (const row of rows) {
    if (row.status !== "proposed" || !pdfLabelIsUnique(row.fieldLabel, rows)) continue;
    const label = normalizePdfMatchLabel(row.fieldLabel);
    if (!label) continue;
    const matching = observed.filter(
      (item) => item.label === label && item.portalKey !== row.portalKey,
    );
    if (new Set(matching.map((item) => item.token)).size > 1) continue;
    const suggestion = suggestTokenForLabel(label, dictionaryEntries, observed, row.portalKey);
    if (
      suggestion &&
      matching.every((item) => item.token === suggestion.token) &&
      allowedTokens.has(suggestion.token) &&
      isPdfFillableToken(suggestion.token)
    ) {
      suggestions.set(row.id, suggestion);
    }
  }
  return suggestions;
}

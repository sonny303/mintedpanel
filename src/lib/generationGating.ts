// E4.2 F4.2.6 / TE-13 — profile gating rides on TOP of the locked E2.0 preview,
// never inside it. `buildGenerationPreview` produces the candidate rows with
// their [r4]-locked candidate/dedupe/exclusion dispositions; this layer takes
// the PROPOSED rows, resolves each to its SOP via the same `pickTemplate`
// precedence, evaluates that SOP's required-profile-attributes against the
// provider's facts, and splits them into confirmable vs gated (with the exact
// unmet attributes). Gated providers are simply absent from the confirmed set —
// the E2.1 RPC is unchanged. No stored blocked state: re-derived every preview.

import { topRankedTemplates } from "./pickTemplate";
import { previewRowKey } from "./generationPreview";
import {
  evaluateProfileGate,
  normalizeRequiredAttributes,
  type UnmetAttribute,
} from "./profileGating";
import type { ProviderReadinessFacts } from "./enrollmentReadiness";
import type { GenerationPreviewRow } from "./generationPreview";
import type { SOPTemplate } from "@/types";

export interface GatedRow {
  row: GenerationPreviewRow;
  unmet: UnmetAttribute[];
}

export interface GatingResult {
  /** Proposed rows whose provider passes the gate — the confirmable set. */
  confirmable: GenerationPreviewRow[];
  /** Proposed rows blocked by a missing required attribute. */
  gated: GatedRow[];
  /** Rows requiring an operator to choose among equal-priority SOPs. */
  ambiguous: GenerationPreviewRow[];
  /** Proposed Enrollment rows with no compatible SOP; never confirmable. */
  unmatched: GenerationPreviewRow[];
}

export interface GatingInput {
  rows: readonly GenerationPreviewRow[];
  templates: SOPTemplate[];
  factsById: ReadonlyMap<string, ProviderReadinessFacts>;
  /** Operator picks for tied rows: preview row key → template id. A pick
   * outside the row's top-ranked set is ignored (the row stays ambiguous). */
  templateChoices?: ReadonlyMap<string, string>;
}

/** The template a row generates with: the sole top-ranked one, or the
 * operator's pick among a tie. null = no match, or an unresolved tie. Shared
 * by the preview gate and the confirm loop so the two can never disagree. */
export function resolveRowTemplate(
  templates: SOPTemplate[],
  row: Pick<GenerationPreviewRow, "providerId" | "groupId" | "payerId" | "state">,
  templateChoices?: ReadonlyMap<string, string>,
): { ranked: SOPTemplate[]; template: SOPTemplate | null } {
  const ranked = topRankedTemplates(templates, row.payerId, row.state, row.groupId, "enrollment");
  if (ranked.length <= 1) return { ranked, template: ranked[0] ?? null };
  const chosenId = templateChoices?.get(previewRowKey(row));
  return { ranked, template: ranked.find((t) => t.id === chosenId) ?? null };
}

export function evaluateGeneration({
  rows,
  templates,
  factsById,
  templateChoices,
}: GatingInput): GatingResult {
  const confirmable: GenerationPreviewRow[] = [];
  const gated: GatedRow[] = [];
  const ambiguous: GenerationPreviewRow[] = [];
  const unmatched: GenerationPreviewRow[] = [];

  for (const row of rows) {
    if (row.disposition !== "proposed") continue; // only proposed rows are confirmable/gated
    const { ranked, template } = resolveRowTemplate(templates, row, templateChoices);
    if (ranked.length === 0) {
      unmatched.push(row);
      continue;
    }
    if (!template) {
      ambiguous.push(row);
      continue;
    }
    const required = normalizeRequiredAttributes(template.requiredProfileAttributes);
    const facts = factsById.get(row.providerId);
    if (required.length === 0 || !facts) {
      confirmable.push(row);
      continue;
    }
    const result = evaluateProfileGate(required, facts);
    if (result.passed) {
      confirmable.push(row);
    } else {
      gated.push({ row, unmet: result.unmet });
    }
  }

  return { confirmable, gated, ambiguous, unmatched };
}

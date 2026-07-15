// E4.2 F4.2.6 / TE-13 — profile gating rides on TOP of the locked E2.0 preview,
// never inside it. `buildGenerationPreview` produces the candidate rows with
// their [r4]-locked candidate/dedupe/exclusion dispositions; this layer takes
// the PROPOSED rows, resolves each to its SOP via the same `pickTemplate`
// precedence, evaluates that SOP's required-profile-attributes against the
// provider's facts, and splits them into confirmable vs gated (with the exact
// unmet attributes). Gated providers are simply absent from the confirmed set —
// the E2.1 RPC is unchanged. No stored blocked state: re-derived every preview.

import { pickTemplate } from "./pickTemplate";
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
}

export interface GatingInput {
  rows: readonly GenerationPreviewRow[];
  templates: SOPTemplate[];
  factsById: ReadonlyMap<string, ProviderReadinessFacts>;
}

export function evaluateGeneration({ rows, templates, factsById }: GatingInput): GatingResult {
  const confirmable: GenerationPreviewRow[] = [];
  const gated: GatedRow[] = [];

  for (const row of rows) {
    if (row.disposition !== "proposed") continue; // only proposed rows are confirmable/gated
    const template = pickTemplate(templates, row.payerId, row.state, row.groupId);
    const required = normalizeRequiredAttributes(template?.requiredProfileAttributes);
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

  return { confirmable, gated };
}

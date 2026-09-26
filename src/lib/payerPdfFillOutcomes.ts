import {
  createFillEventV2OpaqueKey,
  isFillEventV2Metadata,
  MAX_FILL_EVENT_V2_FIELD_OUTCOMES,
  FILL_EVENT_V2_LIMIT_ERROR,
  type FillEventV2FieldOutcome,
  type FillEventV2Metadata,
} from "@/types/fillEventV2";
import type { PayerFormFillPlan } from "@/lib/payerFormFill";

export type PdfWriterDisposition =
  | { mapId: string; kind: "accepted" }
  | { mapId: string; kind: "rejected" }
  | { mapId: string; kind: "option_mismatch" }
  | { mapId: string; kind: "needs_mapping" }
  | { mapId: string; kind: "unsupported" };

function outcomeForPlannedEntry(
  entry: PayerFormFillPlan["entries"][number],
  disposition: PdfWriterDisposition | undefined,
): Omit<FillEventV2FieldOutcome, "targetKey"> | null {
  const base = { mapId: entry.mapId, frameKey: null, stepKey: null };
  switch (entry.outcome) {
    case "stale":
      return null;
    case "manual":
      return { ...base, attempted: false, outcome: "manual", reasonCode: "manual_required" };
    case "undecided":
      return {
        ...base,
        attempted: false,
        outcome: "needs_mapping",
        reasonCode: "mapping_required",
      };
    case "empty_token":
      return { ...base, attempted: false, outcome: "needs_value", reasonCode: "missing_value" };
    case "token":
    case "fixed":
      if (disposition?.kind === "accepted") {
        return {
          ...base,
          attempted: true,
          outcome: "unverified",
          reasonCode: "readback_unavailable",
        };
      }
      if (disposition?.kind === "rejected") {
        return {
          ...base,
          attempted: true,
          outcome: "write_rejected",
          reasonCode: "setter_rejected",
        };
      }
      if (disposition?.kind === "option_mismatch") {
        return {
          ...base,
          attempted: false,
          outcome: "option_mismatch",
          reasonCode: "option_missing",
        };
      }
      if (disposition?.kind === "needs_mapping") {
        return {
          ...base,
          attempted: false,
          outcome: "needs_mapping",
          reasonCode: "mapping_required",
        };
      }
      if (disposition?.kind === "unsupported") {
        return {
          ...base,
          attempted: false,
          outcome: "unsupported",
          reasonCode: "unsupported_control",
        };
      }
      return { ...base, attempted: false, outcome: "unverified", reasonCode: "setter_unavailable" };
  }
}

/** Convert a PDF plan and numeric writer result to value-free V2 telemetry. */
export function createPayerPdfFillEventV2(
  plan: PayerFormFillPlan,
  dispositions: readonly PdfWriterDisposition[],
): FillEventV2Metadata {
  const byMapId = new Map(dispositions.map((item) => [item.mapId, item]));
  const fieldOutcomes: FillEventV2FieldOutcome[] = [];
  for (const entry of plan.entries) {
    const mapped = outcomeForPlannedEntry(entry, byMapId.get(entry.mapId));
    if (mapped) fieldOutcomes.push({ ...mapped, targetKey: createFillEventV2OpaqueKey("t") });
  }
  if (fieldOutcomes.length > MAX_FILL_EVENT_V2_FIELD_OUTCOMES) {
    throw new Error(FILL_EVENT_V2_LIMIT_ERROR);
  }
  const metadata: FillEventV2Metadata = {
    schemaVersion: 2,
    fieldsAttempted: fieldOutcomes.filter((field) => field.attempted).length,
    fieldsVerified: fieldOutcomes.filter((field) => field.outcome === "verified").length,
    fieldsRejected: fieldOutcomes.filter((field) => field.outcome === "write_rejected").length,
    fieldOutcomes,
  };
  if (!isFillEventV2Metadata(metadata))
    throw new Error("PDF fill outcomes could not be recorded safely");
  return metadata;
}

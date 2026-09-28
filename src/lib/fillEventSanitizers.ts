import type { FillSessionSkippedField, SafeFillSkippedMetadata } from "@/types";
import type { FillEventV2Metadata } from "@/types/fillEventV2";

const LEGACY_SKIP_REASON_BY_KIND = {
  skipped: "readback_unavailable",
  other_page: "field belongs to another page",
  hidden: "field is hidden on this page",
  no_mapping: "mapping_required",
  no_value: "missing_value",
  file: "manual_required",
  manual: "manual_required",
  review: "manual_required",
  page_unknown: "page_unknown",
  unverified: "readback_unavailable",
  unmapped: "unmapped",
  empty_token: "empty_token",
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Preserve only the legacy bounded taxonomy and stable map id; discard labels,
 * selectors, arbitrary reasons, and any value-bearing fields. */
export function sanitizeLegacyFieldsSkipped(value: unknown): FillSessionSkippedField[] | null {
  if (!Array.isArray(value)) return null;
  const safe: FillSessionSkippedField[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    const suppliedReason = typeof candidate.reason === "string" ? candidate.reason : "";
    const suppliedKind =
      typeof candidate.kind === "string"
        ? candidate.kind
        : suppliedReason === "unmapped" || suppliedReason === "empty_token"
          ? suppliedReason
          : "skipped";
    const kind = Object.hasOwn(LEGACY_SKIP_REASON_BY_KIND, suppliedKind)
      ? suppliedKind
      : "unverified";
    let reason: SafeFillSkippedMetadata["reason"] =
      LEGACY_SKIP_REASON_BY_KIND[kind as keyof typeof LEGACY_SKIP_REASON_BY_KIND];
    if (kind === "skipped" && suppliedReason === "field not found on this page") {
      reason = "field not found on this page";
    }
    safe.push({
      label: "",
      reason: reason as SafeFillSkippedMetadata["reason"],
      kind: kind as SafeFillSkippedMetadata["kind"],
      mapId:
        typeof candidate.mapId === "string" && UUID_PATTERN.test(candidate.mapId)
          ? candidate.mapId
          : null,
    });
  }
  return safe;
}

/** Exact derived value-free fields_skipped projection for V2 telemetry. */
export function v2SkippedProjection(metadata: FillEventV2Metadata): SafeFillSkippedMetadata[] {
  return metadata.fieldOutcomes
    .filter((outcome) => outcome.outcome !== "verified" && outcome.outcome !== "unchanged")
    .map((outcome) => ({
      label: "",
      reason: outcome.reasonCode ?? outcome.outcome,
      kind: outcome.outcome,
      mapId: outcome.mapId,
    }));
}

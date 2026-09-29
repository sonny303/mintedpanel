/**
 * Value-free fill-event V2 wire contract shared with the extension team.
 *
 * `schemaVersion` is the JSON/API spelling; it maps to
 * `fill_sessions.event_schema_version`. These records contain only opaque
 * identities, booleans, bounded outcomes, and bounded reason codes.
 */
export const FILL_EVENT_V2_OUTCOMES = [
  "verified",
  "unchanged",
  "write_rejected",
  "unverified",
  "needs_value",
  "needs_mapping",
  "manual",
  "other_page",
  "hidden",
  "page_unknown",
  "not_found",
  "option_mismatch",
  "unsupported",
] as const;

export type FillEventV2Outcome = (typeof FILL_EVENT_V2_OUTCOMES)[number];

export const FILL_EVENT_V2_REASON_CODES = [
  "mask_reverted",
  "readback_mismatch",
  "readback_unavailable",
  "missing_value",
  "mapping_required",
  "manual_required",
  "other_page",
  "field_hidden",
  "page_unknown",
  "target_missing",
  "frame_inaccessible",
  "context_changed",
  "option_missing",
  "unsupported_control",
  "invalid_format",
  "ambiguous_target",
  "setter_unavailable",
  "setter_rejected",
  "unchanged_value",
] as const;

export type FillEventV2ReasonCode = (typeof FILL_EVENT_V2_REASON_CODES)[number];

export const FILL_EVENT_V2_REASON_CODES_BY_OUTCOME: Readonly<
  Record<FillEventV2Outcome, readonly FillEventV2ReasonCode[] | null>
> = {
  verified: null,
  unchanged: ["unchanged_value"],
  write_rejected: ["mask_reverted", "readback_mismatch", "invalid_format", "setter_rejected"],
  unverified: [
    "readback_unavailable",
    "frame_inaccessible",
    "context_changed",
    "setter_unavailable",
  ],
  needs_value: ["missing_value", "invalid_format"],
  needs_mapping: ["mapping_required", "ambiguous_target"],
  manual: ["manual_required"],
  other_page: ["other_page"],
  hidden: ["field_hidden"],
  page_unknown: ["page_unknown"],
  not_found: ["target_missing"],
  option_mismatch: ["option_missing"],
  unsupported: ["unsupported_control"],
};

export interface FillEventV2NotFoundEvidence {
  stepKnown: true;
  frameAccessible: true;
  pageSettled: true;
  searchComplete: true;
  targetAbsent: true;
}

export interface FillEventV2FieldOutcome {
  mapId: string | null;
  /** Generated per-run opaque token; never a label, selector, or value. */
  targetKey: string;
  /** Generated opaque identity; null when frame identity is unavailable. */
  frameKey: string | null;
  /** Generated opaque identity; null when page-step identity is unavailable. */
  stepKey: string | null;
  attempted: boolean;
  outcome: FillEventV2Outcome;
  reasonCode: FillEventV2ReasonCode | null;
  notFoundEvidence?: FillEventV2NotFoundEvidence;
}

export interface FillEventV2Metadata {
  schemaVersion: 2;
  fieldsAttempted: number;
  fieldsVerified: number;
  fieldsRejected: number;
  fieldOutcomes: FillEventV2FieldOutcome[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_KEY_RE =
  /^([tfs])_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export const MAX_FILL_EVENT_V2_FIELD_OUTCOMES = 250;
export const FILL_EVENT_V2_LIMIT_ERROR =
  "Fill outcome limit exceeded; telemetry was not recorded. Review this form before retrying.";
const EXACT_NOT_FOUND_EVIDENCE_KEYS = [
  "stepKnown",
  "frameAccessible",
  "pageSettled",
  "searchComplete",
  "targetAbsent",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function isOpaqueKey(value: unknown, kind: FillEventV2OpaqueKeyKind): value is string {
  if (typeof value !== "string") return false;
  const match = OPAQUE_KEY_RE.exec(value);
  return match?.[1]?.toLowerCase() === kind && UUID_RE.test(match[2] ?? "");
}

export type FillEventV2OpaqueKeyKind = "t" | "f" | "s";

/** Create a run-local identity. Never build one from a selector, label, or value. */
export function createFillEventV2OpaqueKey(kind: FillEventV2OpaqueKeyKind): string {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure opaque fill identity is unavailable");
  return `${kind}_${globalThis.crypto.randomUUID()}`;
}

function isNotFoundEvidence(value: unknown): value is FillEventV2NotFoundEvidence {
  if (!isRecord(value) || !hasExactKeys(value, EXACT_NOT_FOUND_EVIDENCE_KEYS)) return false;
  return EXACT_NOT_FOUND_EVIDENCE_KEYS.every((key) => value[key] === true);
}

const BASE_OUTCOME_KEYS = [
  "mapId",
  "targetKey",
  "frameKey",
  "stepKey",
  "attempted",
  "outcome",
  "reasonCode",
] as const;

export function isFillEventV2FieldOutcome(value: unknown): value is FillEventV2FieldOutcome {
  if (!isRecord(value)) return false;
  const hasEvidence = Object.hasOwn(value, "notFoundEvidence");
  if (
    !hasExactKeys(
      value,
      hasEvidence ? [...BASE_OUTCOME_KEYS, "notFoundEvidence"] : BASE_OUTCOME_KEYS,
    )
  ) {
    return false;
  }
  if (value.mapId !== null && (typeof value.mapId !== "string" || !UUID_RE.test(value.mapId))) {
    return false;
  }
  if (!isOpaqueKey(value.targetKey, "t")) return false;
  if (value.frameKey !== null && !isOpaqueKey(value.frameKey, "f")) return false;
  if (value.stepKey !== null && !isOpaqueKey(value.stepKey, "s")) return false;
  if (typeof value.attempted !== "boolean") return false;
  if (!(FILL_EVENT_V2_OUTCOMES as readonly unknown[]).includes(value.outcome)) return false;
  if (
    value.reasonCode !== null &&
    !(FILL_EVENT_V2_REASON_CODES as readonly unknown[]).includes(value.reasonCode)
  ) {
    return false;
  }

  const outcome = value.outcome as FillEventV2Outcome;
  const allowedReasons = FILL_EVENT_V2_REASON_CODES_BY_OUTCOME[outcome];
  if (
    allowedReasons === null
      ? value.reasonCode !== null
      : !allowedReasons.includes(value.reasonCode as never)
  ) {
    return false;
  }

  if (outcome === "verified" && value.attempted !== true) return false;
  if (outcome === "verified" && value.mapId === null) return false;
  if (outcome === "unchanged" && value.attempted !== false) return false;
  if (outcome === "unchanged" && value.mapId === null) return false;
  if (outcome === "write_rejected" && value.attempted !== true) return false;
  if (
    [
      "needs_value",
      "needs_mapping",
      "manual",
      "other_page",
      "hidden",
      "page_unknown",
      "not_found",
      "option_mismatch",
      "unsupported",
    ].includes(outcome) &&
    value.attempted !== false
  ) {
    return false;
  }
  if (
    outcome === "needs_value" &&
    value.reasonCode === "invalid_format" &&
    value.attempted !== false
  ) {
    return false;
  }

  if (outcome === "not_found") {
    if (
      value.attempted !== false ||
      typeof value.mapId !== "string" ||
      value.frameKey === null ||
      value.stepKey === null ||
      !isNotFoundEvidence(value.notFoundEvidence)
    ) {
      return false;
    }
  } else if (hasEvidence) {
    return false;
  }

  return true;
}

export function isFillEventV2Metadata(value: unknown): value is FillEventV2Metadata {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "fieldsAttempted",
      "fieldsVerified",
      "fieldsRejected",
      "fieldOutcomes",
    ])
  ) {
    return false;
  }
  if (value.schemaVersion !== 2 || !Array.isArray(value.fieldOutcomes)) return false;
  if (
    value.fieldOutcomes.length > MAX_FILL_EVENT_V2_FIELD_OUTCOMES ||
    !value.fieldOutcomes.every(isFillEventV2FieldOutcome)
  ) {
    return false;
  }
  const identities = new Set<string>();
  const counts = value.fieldOutcomes.reduce(
    (result, field) => {
      const identity = `${field.mapId?.toLowerCase() ?? "null"}\u0000${field.targetKey.toLowerCase()}\u0000${field.frameKey?.toLowerCase() ?? "null"}`;
      if (identities.has(identity)) result.duplicateIdentity = true;
      identities.add(identity);
      if (field.attempted) result.attempted += 1;
      if (field.outcome === "verified") result.verified += 1;
      if (field.outcome === "write_rejected") result.rejected += 1;
      return result;
    },
    { attempted: 0, verified: 0, rejected: 0, duplicateIdentity: false },
  );
  return (
    !counts.duplicateIdentity &&
    value.fieldsAttempted === counts.attempted &&
    value.fieldsVerified === counts.verified &&
    value.fieldsRejected === counts.rejected
  );
}

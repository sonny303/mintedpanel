import type { PortalFieldMap } from "@/types";
import type { CaseType } from "@/lib/caseTypes";

/** The exact owner/step/configuration identity acknowledged by Extension. */
export interface WorkContextCommonTuple {
  launchReceiptId: string;
  orgId: string;
  ownerId: string;
  contextVersion: number;
  sopTemplateId: string;
  sopVersion: number;
  portalId: string;
  portalKey: string;
  mappingGeneration: number;
  effectiveMappingFingerprint: string;
  providerId: string;
  facilityId: string | null;
  stepIdentity: string;
}

export type WorkContextTuple = WorkContextCommonTuple &
  (
    | {
        ownerKind: "case";
        taskId: string;
        stepId: string;
        assignmentId?: never;
        taskIndex?: never;
        stepIndex?: never;
      }
    | {
        ownerKind: "contract";
        assignmentId: string;
        taskIndex: number;
        stepIndex: number;
        taskId?: never;
        stepId?: never;
      }
  );

export type WorkContextLaunchTuple = Omit<WorkContextCommonTuple, "launchReceiptId"> &
  (
    | {
        ownerKind: "case";
        taskId: string;
        stepId: string;
        assignmentId?: never;
        taskIndex?: never;
        stepIndex?: never;
      }
    | {
        ownerKind: "contract";
        assignmentId: string;
        taskIndex: number;
        stepIndex: number;
        taskId?: never;
        stepId?: never;
      }
  );

export type WorkContextValidationRequest = WorkContextTuple & { protocolVersion: 2 };

export interface WorkContextValidationData {
  tuple: WorkContextTuple;
  caseType: CaseType;
  formUrl: string;
  requiresExplicitSelection: true;
  mappingGeneration: number;
  effectiveMappingFingerprint: string;
  effectiveWebMaps: PortalFieldMap[];
}

export type WorkContextValidationErrorCode =
  "malformed_request" | "not_found" | "mismatch" | "stale" | "not_ready";

export type ParseWorkContextRequestResult =
  { ok: true; request: WorkContextValidationRequest } | { ok: false; message: string };

export type ParseWorkContextTupleResult =
  { ok: true; tuple: WorkContextTuple } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PORTAL_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MAPPING_FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;
const COMMON_KEYS = [
  "protocolVersion",
  "launchReceiptId",
  "orgId",
  "ownerKind",
  "ownerId",
  "contextVersion",
  "sopTemplateId",
  "sopVersion",
  "portalId",
  "portalKey",
  "mappingGeneration",
  "effectiveMappingFingerprint",
  "providerId",
  "facilityId",
  "stepIdentity",
] as const;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function hasExactKeys(row: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(row).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

/** Strictly parse the v2 POST body. URL hints and owner-specific extra fields
 * are rejected here so the validator has one precise trust boundary. */
export function parseWorkContextValidationRequest(value: unknown): ParseWorkContextRequestResult {
  const row = recordOf(value);
  if (!row) return { ok: false, message: "Request body must be a JSON object." };
  if (row.protocolVersion !== 2) {
    return { ok: false, message: "protocolVersion must be exactly 2." };
  }
  if (row.ownerKind !== "case" && row.ownerKind !== "contract") {
    return { ok: false, message: "ownerKind must be case or contract." };
  }

  const ownerKeys =
    row.ownerKind === "case" ? ["taskId", "stepId"] : ["assignmentId", "taskIndex", "stepIndex"];
  if (!hasExactKeys(row, [...COMMON_KEYS, ...ownerKeys])) {
    return { ok: false, message: "Request body contains missing or unsupported fields." };
  }
  if (
    !isUuid(row.launchReceiptId) ||
    !isUuid(row.orgId) ||
    !isUuid(row.ownerId) ||
    !isUuid(row.sopTemplateId) ||
    !isUuid(row.portalId) ||
    !isUuid(row.providerId) ||
    (row.facilityId !== null && !isUuid(row.facilityId))
  ) {
    return {
      ok: false,
      message: "Owner, provider, facility, portal, SOP, and receipt IDs must be UUIDs.",
    };
  }
  if (
    !isPositiveInteger(row.contextVersion) ||
    !isPositiveInteger(row.sopVersion) ||
    !isPositiveInteger(row.mappingGeneration)
  ) {
    return { ok: false, message: "Context, SOP, and mapping versions must be positive integers." };
  }
  if (
    typeof row.portalKey !== "string" ||
    !PORTAL_KEY_RE.test(row.portalKey) ||
    row.portalKey !== row.portalKey.trim().toLowerCase()
  ) {
    return { ok: false, message: "portalKey must be a normalized configuration key." };
  }
  if (
    typeof row.effectiveMappingFingerprint !== "string" ||
    !MAPPING_FINGERPRINT_RE.test(row.effectiveMappingFingerprint)
  ) {
    return { ok: false, message: "effectiveMappingFingerprint is invalid." };
  }
  if (
    typeof row.stepIdentity !== "string" ||
    row.stepIdentity.length < 1 ||
    row.stepIdentity.length > 512
  ) {
    return { ok: false, message: "stepIdentity is invalid." };
  }

  if (row.ownerKind === "case") {
    if (!isUuid(row.taskId) || !isUuid(row.stepId)) {
      return { ok: false, message: "Case work requires taskId and stepId UUIDs." };
    }
    return { ok: true, request: row as unknown as WorkContextValidationRequest };
  }
  if (
    !isUuid(row.assignmentId) ||
    !Number.isSafeInteger(row.taskIndex) ||
    typeof row.taskIndex !== "number" ||
    row.taskIndex < 0 ||
    !Number.isSafeInteger(row.stepIndex) ||
    typeof row.stepIndex !== "number" ||
    row.stepIndex < 0
  ) {
    return {
      ok: false,
      message: "Contract work requires an assignment and zero-based step indexes.",
    };
  }
  return { ok: true, request: row as unknown as WorkContextValidationRequest };
}

/** Parse the exact canonical tuple nested in fill-event and submission bodies.
 * Unlike the validation endpoint request, a tuple does not carry a protocol
 * version. Reject one if present rather than silently normalizing it away. */
export function parseWorkContextTuple(value: unknown): ParseWorkContextTupleResult {
  const row = recordOf(value);
  if (!row || Object.prototype.hasOwnProperty.call(row, "protocolVersion")) {
    return { ok: false, message: "workContext must be an exact canonical tuple." };
  }
  const parsed = parseWorkContextValidationRequest({ ...row, protocolVersion: 2 });
  if (!parsed.ok) return parsed;
  return { ok: true, tuple: workContextTuple(parsed.request) };
}

export function workContextTuple(request: WorkContextValidationRequest): WorkContextTuple {
  const { protocolVersion: _protocolVersion, ...tuple } = request;
  return tuple;
}

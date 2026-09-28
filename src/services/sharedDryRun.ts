// E6.9 Train dry-run — extension-facing shared-tier writes.
//
// Train forms has no org (D10), so these sit on authenticateUser like
// shared-field-maps. Two writes:
//   1. recordSharedTestFill — log an is_test fill_session (case/provider null).
//      fill_sessions.org_id is NOT NULL, so we resolve a telemetry org from the
//      caller's memberships (optional body.orgId for multi-org). is_test keeps
//      the row out of scorecard/drift metrics.
//   2. proveSharedPortal — MANUAL proven_at stamp only. A dry-run pass never
//      calls this; the trainer marks proven after reviewing the filled form.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { listUserOrgMemberships } from "./orgMemberships";
import { sanitizeLegacyFieldsSkipped, v2SkippedProjection } from "@/lib/fillEventSanitizers";
import { isFillEventV2Metadata } from "@/types/fillEventV2";
import type { FillSession, Portal } from "@/types";

export interface SharedDryRunCtx {
  db: SupabaseClient<Database>;
  userId: string;
}

export type SharedDryRunReject = {
  kind: "rejected";
  status: 400 | 403 | 404 | 409 | 422;
  message: string;
};

const FILL_SESSION_COLUMNS =
  "id, org_id, case_id, provider_id, portal_key, fill_mode, started_at, completed_at, fields_filled, fields_skipped, docs_attached, performed_by, is_test, event_schema_version, fields_attempted, fields_verified, fields_rejected, field_outcomes";

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Pick the org that owns the telemetry row. Never invent an org for a
 * multi-org caller — they must name one. */
export async function resolveTelemetryOrgId(
  ctx: SharedDryRunCtx,
  preferredOrgId: string | null | undefined,
): Promise<{ kind: "ok"; orgId: string } | SharedDryRunReject> {
  const memberships = await listUserOrgMemberships({ db: ctx.db }, ctx.userId);
  if (memberships.length === 0) {
    return { kind: "rejected", status: 403, message: "No org membership" };
  }
  if (preferredOrgId) {
    if (!isUuid(preferredOrgId)) {
      return { kind: "rejected", status: 422, message: "orgId must be a uuid" };
    }
    if (!memberships.some((m) => m.orgId === preferredOrgId)) {
      return { kind: "rejected", status: 403, message: "Not a member of that org" };
    }
    return { kind: "ok", orgId: preferredOrgId };
  }
  if (memberships.length > 1) {
    return {
      kind: "rejected",
      status: 400,
      message: "orgId is required for multi-org callers on shared test fills",
    };
  }
  return { kind: "ok", orgId: memberships[0]!.orgId };
}

export interface SharedTestFillInput {
  id: string;
  portalKey: string;
  fieldsFilled: number;
  fieldsSkipped?: unknown;
  startedAt?: string | null;
  completedAt?: string | null;
  orgId?: string | null;
  mockProfileVersion?: number | null;
  schemaVersion?: number;
  fieldsAttempted?: number;
  fieldsVerified?: number;
  fieldsRejected?: number;
  fieldOutcomes?: unknown;
}

function toFillSession(row: Record<string, unknown>): FillSession {
  const session = camelizeRow<FillSession>(row);
  session.isTest = Boolean(row.is_test);
  return session;
}

export async function recordSharedTestFill(
  ctx: SharedDryRunCtx,
  input: SharedTestFillInput,
): Promise<{ kind: "created" | "duplicate"; session: FillSession } | SharedDryRunReject> {
  if (!isUuid(input.id)) {
    return { kind: "rejected", status: 422, message: "id must be a uuid" };
  }
  const portalKey = normalizePortalKey(input.portalKey ?? "");
  if (!portalKey) {
    return { kind: "rejected", status: 422, message: "portalKey is required" };
  }
  if (typeof input.fieldsFilled !== "number" || !Number.isFinite(input.fieldsFilled)) {
    return { kind: "rejected", status: 422, message: "fieldsFilled must be a number" };
  }
  if (
    !Number.isInteger(input.fieldsFilled) ||
    input.fieldsFilled < 0 ||
    input.fieldsFilled > 2147483647
  ) {
    return {
      kind: "rejected",
      status: 422,
      message: "fieldsFilled must be a non-negative 32-bit integer",
    };
  }
  if (input.schemaVersion != null && input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    return { kind: "rejected", status: 422, message: "schemaVersion must be 1 or 2" };
  }
  const v2KeysPresent =
    input.fieldsAttempted !== undefined ||
    input.fieldsVerified !== undefined ||
    input.fieldsRejected !== undefined ||
    input.fieldOutcomes !== undefined;
  const metadataValue = {
    schemaVersion: input.schemaVersion,
    fieldsAttempted: input.fieldsAttempted,
    fieldsVerified: input.fieldsVerified,
    fieldsRejected: input.fieldsRejected,
    fieldOutcomes: input.fieldOutcomes,
  };
  const metadata =
    input.schemaVersion === 2 && isFillEventV2Metadata(metadataValue) ? metadataValue : null;
  if (
    (input.schemaVersion === 2 && metadata === null) ||
    (input.schemaVersion !== 2 && v2KeysPresent)
  ) {
    return {
      kind: "rejected",
      status: 422,
      message: "V2 metadata is invalid or schemaVersion is missing",
    };
  }
  if (metadata && input.fieldsFilled !== metadata.fieldsVerified) {
    return {
      kind: "rejected",
      status: 422,
      message: "fieldsFilled must equal fieldsVerified for V2",
    };
  }
  if (input.startedAt != null && !isValidTimestamp(input.startedAt)) {
    return { kind: "rejected", status: 422, message: "startedAt must be an ISO timestamp" };
  }
  if (input.completedAt != null && !isValidTimestamp(input.completedAt)) {
    return { kind: "rejected", status: 422, message: "completedAt must be an ISO timestamp" };
  }

  const org = await resolveTelemetryOrgId(ctx, input.orgId);
  if (org.kind === "rejected") return org;

  const fieldsFilled = metadata?.fieldsVerified ?? input.fieldsFilled;
  const fieldsSkipped = metadata
    ? v2SkippedProjection(metadata)
    : sanitizeLegacyFieldsSkipped(input.fieldsSkipped);
  const existingMatchesV2 = (row: Record<string, unknown>): boolean => {
    // V1-to-V1 retains legacy replay semantics. A v1 request cannot reuse a
    // V2 idempotency key and erase the immutable outcome identity.
    if (!metadata) return row.event_schema_version !== 2;
    return (
      row.org_id === org.orgId &&
      row.case_id == null &&
      row.provider_id == null &&
      row.portal_key === portalKey &&
      row.fill_mode === "web" &&
      row.fields_filled === fieldsFilled &&
      Boolean(row.is_test) &&
      row.performed_by === ctx.userId &&
      row.docs_attached == null &&
      row.event_schema_version === 2 &&
      row.fields_attempted === metadata.fieldsAttempted &&
      row.fields_verified === metadata.fieldsVerified &&
      row.fields_rejected === metadata.fieldsRejected &&
      canonicalJson(row.field_outcomes) === canonicalJson(metadata.fieldOutcomes) &&
      canonicalJson(row.fields_skipped ?? null) === canonicalJson(fieldsSkipped) &&
      (input.startedAt == null ||
        Date.parse(String(row.started_at)) === Date.parse(input.startedAt)) &&
      (input.completedAt == null ||
        Date.parse(String(row.completed_at)) === Date.parse(input.completedAt))
    );
  };

  const { data: existing, error: existingErr } = await ctx.db
    .from("fill_sessions")
    .select(FILL_SESSION_COLUMNS)
    .eq("id", input.id)
    .eq("org_id", org.orgId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) {
    if (!existingMatchesV2(existing as Record<string, unknown>)) {
      return {
        kind: "rejected",
        status: 409,
        message: "Idempotency id was already used with a different fill event",
      };
    }
    return { kind: "duplicate", session: toFillSession(existing as Record<string, unknown>) };
  }

  const row: Record<string, unknown> = {
    id: input.id,
    org_id: org.orgId,
    case_id: null,
    provider_id: null,
    portal_key: portalKey,
    fill_mode: "web",
    completed_at: input.completedAt ?? new Date().toISOString(),
    fields_filled: fieldsFilled,
    fields_skipped: fieldsSkipped,
    docs_attached: null,
    performed_by: ctx.userId,
    is_test: true,
    event_schema_version: input.schemaVersion ?? null,
  };
  if (metadata) {
    row.event_schema_version = 2;
    row.fields_attempted = metadata.fieldsAttempted;
    row.fields_verified = metadata.fieldsVerified;
    row.fields_rejected = metadata.fieldsRejected;
    row.field_outcomes = metadata.fieldOutcomes;
  }
  if (input.startedAt != null) row.started_at = input.startedAt;

  const { data, error } = await ctx.db
    .from("fill_sessions")
    .insert(row as never)
    .select(FILL_SESSION_COLUMNS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const { data: raced, error: racedErr } = await ctx.db
        .from("fill_sessions")
        .select(FILL_SESSION_COLUMNS)
        .eq("id", input.id)
        .eq("org_id", org.orgId)
        .maybeSingle();
      if (racedErr) throw racedErr;
      if (raced) {
        if (!existingMatchesV2(raced as Record<string, unknown>)) {
          return {
            kind: "rejected",
            status: 409,
            message: "Idempotency id was already used with a different fill event",
          };
        }
        return { kind: "duplicate", session: toFillSession(raced as Record<string, unknown>) };
      }
      return { kind: "rejected", status: 409, message: "Idempotency id already used" };
    }
    throw error;
  }

  const session = toFillSession(data as Record<string, unknown>);
  if (!metadata) {
    await ctx.db.from("audit_log").insert({
      org_id: org.orgId,
      user_id: ctx.userId,
      action_type: "CREATE",
      entity_type: "fill_session",
      entity_id: session.id,
      after: {
        portalKey: session.portalKey,
        fieldsFilled: session.fieldsFilled,
        isTest: true,
        mockProfileVersion: input.mockProfileVersion ?? null,
        source: "extension_train",
      },
      description: `Shared train mock dry run (${session.portalKey})`,
    } as never);
  }

  return { kind: "created", session };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface ProveSharedPortalInput {
  portalKey?: string | null;
  id?: string | null;
}

export async function proveSharedPortal(
  ctx: SharedDryRunCtx,
  input: ProveSharedPortalInput,
): Promise<{ kind: "ok"; portal: Portal } | SharedDryRunReject> {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const portalKey = normalizePortalKey(input.portalKey ?? "");

  let portalId = id;
  if (!portalId) {
    if (!portalKey) {
      return {
        kind: "rejected",
        status: 422,
        message: "portalKey or id is required",
      };
    }
    const { data, error } = await ctx.db
      .from("portals")
      .select("id")
      .is("org_id", null)
      .eq("portal_key", portalKey)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return { kind: "rejected", status: 404, message: "Shared portal not found" };
    }
    portalId = (data as { id: string }).id;
  } else if (!isUuid(portalId)) {
    return { kind: "rejected", status: 422, message: "id must be a uuid" };
  }

  const rpc = ctx.db.rpc.bind(ctx.db);
  const { data, error } = await rpc("set_global_portal_flags", {
    p_id: portalId,
    p_verified: null as unknown as boolean,
    p_proven: true,
  });
  if (error) {
    const msg = error.message ?? "";
    if (/not found|no rows/i.test(msg)) {
      return { kind: "rejected", status: 404, message: "Shared portal not found" };
    }
    throw error;
  }
  if (!data) {
    // Confirm the row is global — an org-scoped id must not prove via this path.
    const { data: row } = await ctx.db
      .from("portals")
      .select("id, org_id")
      .eq("id", portalId)
      .maybeSingle();
    if (!row || (row as { org_id: string | null }).org_id != null) {
      return { kind: "rejected", status: 404, message: "Shared portal not found" };
    }
    return { kind: "rejected", status: 404, message: "Shared portal not found" };
  }

  const portal = camelizeRow<Portal>(data as Record<string, unknown>);
  if (portal.orgId != null) {
    return { kind: "rejected", status: 404, message: "Shared portal not found" };
  }

  // Proven is user-initiated; audit under a telemetry org when the caller has
  // one so the trail is not lost (audit_log.org_id is NOT NULL).
  const org = await resolveTelemetryOrgId(ctx, null);
  if (org.kind === "ok") {
    await ctx.db.from("audit_log").insert({
      org_id: org.orgId,
      user_id: ctx.userId,
      action_type: "UPDATE",
      entity_type: "portal",
      entity_id: portal.id,
      after: { provenAt: portal.provenAt, portalKey: portal.portalKey, source: "extension_train" },
      description: `Marked shared portal proven (${portal.portalKey})`,
    } as never);
  }

  return { kind: "ok", portal };
}

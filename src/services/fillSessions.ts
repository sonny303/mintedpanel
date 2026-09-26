// Fill sessions: the extension's fill-event log. One row per fill attempt,
// keyed by a CLIENT-generated idempotency id that becomes the row's primary
// key — a duplicate POST returns the existing row instead of inserting twice.
//
// Isolation contract: case/provider/task ownership is validated against the
// caller's resolved org BEFORE anything is written; org_id and performed_by
// come from the authenticated context only, never the request body.
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";
import type { Database } from "@/integrations/supabase/types";
import { requireActiveOrg, writeAudit, currentUserId, type AuditInput } from "@/lib/audit";
import { camelizeRow } from "@/lib/case";
import { sanitizeLegacyFieldsSkipped, v2SkippedProjection } from "@/lib/fillEventSanitizers";
import type { FillMode, FillSession, FillSkippedField } from "@/types";
import {
  isFillEventV2Metadata,
  type FillEventV2FieldOutcome,
  type FillEventV2Metadata,
} from "@/types/fillEventV2";

export interface FillSessionServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
  writeAudit: (input: AuditInput) => Promise<void>;
}

export interface FillEventInput {
  // Client-generated idempotency id (UUID); becomes fill_sessions.id.
  id: string;
  caseId: string;
  providerId?: string | null;
  portalKey: string;
  fillMode?: FillMode;
  startedAt?: string | null;
  completedAt?: string | null;
  fieldsFilled?: number;
  fieldsSkipped?: unknown;
  docsAttached?: unknown;
  // Optional: mark this task complete (org-checked) after logging the fill.
  taskId?: string | null;
  // E4.2 TE-17 — dry-run test fill marker (excluded from every metric reader).
  isTest?: boolean;
  schemaVersion?: number;
  fieldsAttempted?: number;
  fieldsVerified?: number;
  fieldsRejected?: number;
  fieldOutcomes?: unknown;
}

export type RecordFillEventResult =
  | { kind: "created"; session: FillSession }
  | { kind: "duplicate"; session: FillSession }
  | { kind: "rejected"; status: 404 | 409 | 422; message: string };

const FILL_SESSION_COLUMNS =
  "id, org_id, case_id, provider_id, portal_key, fill_mode, started_at, completed_at, fields_filled, fields_skipped, docs_attached, performed_by, is_test, event_schema_version, fields_attempted, fields_verified, fields_rejected, field_outcomes";
const FILL_EVENT_V2_COLUMNS =
  "event_schema_version, fields_attempted, fields_verified, fields_rejected, field_outcomes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILL_MODES = new Set<string>(["web", "pdf"]);
// fields_filled is an int4; anything larger must be a 422, not a mid-request
// Postgres overflow error.
const MAX_INT4 = 2147483647;

type Rejected = Extract<RecordFillEventResult, { kind: "rejected" }>;

function reject(status: Rejected["status"], message: string): Rejected {
  return { kind: "rejected", status, message };
}

function isValidTimestamp(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// camelizeRow walks nested objects, which would rewrite keys INSIDE jsonb
// payloads; restore the bounded telemetry projections verbatim.
function toFillSession(row: Record<string, unknown>): FillSession {
  const session = camelizeRow<FillSession>(row);
  // fields_skipped is client jsonb echoed VERBATIM (the extension's R2 wire
  // contract — camelize must not rewrite keys inside it). The E4.2 type is
  // structured; readers that need the structure parse via parseFillSkipped.
  session.fieldsSkipped = (row.fields_skipped ?? null) as FillSession["fieldsSkipped"];
  session.docsAttached = row.docs_attached ?? null;
  session.isTest = Boolean(row.is_test);
  session.eventSchemaVersion =
    row.event_schema_version == null ? null : (row.event_schema_version as 1 | 2);
  session.fieldsAttempted = (row.fields_attempted ?? null) as number | null;
  session.fieldsVerified = (row.fields_verified ?? null) as number | null;
  session.fieldsRejected = (row.fields_rejected ?? null) as number | null;
  session.fieldOutcomes = Array.isArray(row.field_outcomes)
    ? (row.field_outcomes as FillEventV2FieldOutcome[])
    : null;
  return session;
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

function sameStoredFill(
  row: Record<string, unknown>,
  input: FillEventInput,
  ctx: FillSessionServiceCtx,
): boolean {
  const metadata = input.schemaVersion === 2 ? getV2Metadata(input) : null;
  const fieldsSkipped = metadata
    ? v2SkippedProjection(metadata)
    : sanitizeLegacyFieldsSkipped(input.fieldsSkipped);
  const commonMatches =
    row.org_id === ctx.orgId &&
    row.case_id === input.caseId &&
    (row.provider_id ?? null) === (input.providerId ?? null) &&
    row.portal_key === input.portalKey &&
    row.fill_mode === (input.fillMode ?? "web") &&
    Number(row.fields_filled ?? 0) === (metadata?.fieldsVerified ?? input.fieldsFilled ?? 0) &&
    Boolean(row.is_test) === Boolean(input.isTest) &&
    canonicalJson(row.fields_skipped ?? null) === canonicalJson(fieldsSkipped) &&
    canonicalJson(row.docs_attached ?? null) ===
      canonicalJson(metadata ? null : (input.docsAttached ?? null)) &&
    row.performed_by === ctx.userId;
  if (!commonMatches) return false;
  if (input.startedAt != null && Date.parse(String(row.started_at)) !== Date.parse(input.startedAt))
    return false;
  if (
    input.completedAt != null &&
    Date.parse(String(row.completed_at)) !== Date.parse(input.completedAt)
  )
    return false;
  if (!metadata) {
    return (
      (row.event_schema_version ?? null) === (input.schemaVersion ?? null) &&
      row.fields_attempted == null &&
      row.field_outcomes == null
    );
  }
  return (
    row.event_schema_version === 2 &&
    row.fields_attempted === metadata.fieldsAttempted &&
    row.fields_verified === metadata.fieldsVerified &&
    row.fields_rejected === metadata.fieldsRejected &&
    canonicalJson(row.field_outcomes) === canonicalJson(metadata.fieldOutcomes)
  );
}

function getV2Metadata(input: FillEventInput): FillEventV2Metadata | null {
  const value = {
    schemaVersion: input.schemaVersion,
    fieldsAttempted: input.fieldsAttempted,
    fieldsVerified: input.fieldsVerified,
    fieldsRejected: input.fieldsRejected,
    fieldOutcomes: input.fieldOutcomes,
  };
  return isFillEventV2Metadata(value) ? value : null;
}

// True when `id` exists in `table` within the caller's org. Also the 404
// backstop for cross-org probes: a row in another org is indistinguishable
// from a row that doesn't exist.
async function belongsToOrg(
  ctx: FillSessionServiceCtx,
  table: "credential_cases" | "providers" | "tasks",
  id: string,
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

async function completeTaskForFill(ctx: FillSessionServiceCtx, taskId: string): Promise<void> {
  const { data: before, error: beforeErr } = await ctx.db
    .from("tasks")
    .select("id, status")
    .eq("id", taskId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (beforeErr) throw beforeErr;
  if (!before || before.status === "completed") return;

  const patch = { status: "completed", completed_date: new Date().toISOString().slice(0, 10) };
  const { error } = await ctx.db
    .from("tasks")
    .update(patch as never)
    .eq("id", taskId)
    .eq("org_id", ctx.orgId)
    .select("id")
    .single();
  if (error) throw error;
  await ctx.writeAudit({
    actionType: "UPDATE",
    entityType: "task",
    entityId: taskId,
    before: { status: before.status },
    after: { status: "completed" },
    description: "Task completed by extension fill",
  });
}

export async function recordFillEvent(
  ctx: FillSessionServiceCtx,
  input: FillEventInput,
): Promise<RecordFillEventResult> {
  // ---- shape validation (nothing has touched the DB yet) ----
  if (!UUID_RE.test(input.id ?? "")) {
    return reject(422, "id must be a client-generated UUID (the idempotency key)");
  }
  if (!UUID_RE.test(input.caseId ?? "")) return reject(422, "caseId must be a UUID");
  if (input.providerId != null && !UUID_RE.test(input.providerId)) {
    return reject(422, "providerId must be a UUID");
  }
  if (input.taskId != null && !UUID_RE.test(input.taskId)) {
    return reject(422, "taskId must be a UUID");
  }
  if (typeof input.portalKey !== "string" || input.portalKey.trim() === "") {
    return reject(422, "portalKey is required");
  }
  const fillMode = input.fillMode ?? "web";
  if (!FILL_MODES.has(fillMode)) return reject(422, "fillMode must be 'web' or 'pdf'");
  if (input.schemaVersion != null && input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    return reject(422, "schemaVersion must be 1 or 2");
  }
  const v2KeysPresent =
    input.fieldsAttempted !== undefined ||
    input.fieldsVerified !== undefined ||
    input.fieldsRejected !== undefined ||
    input.fieldOutcomes !== undefined;
  const v2Metadata = input.schemaVersion === 2 ? getV2Metadata(input) : null;
  if (
    (input.schemaVersion === 2 && v2Metadata === null) ||
    (input.schemaVersion !== 2 && v2KeysPresent)
  ) {
    return reject(422, "V2 metadata is invalid or schemaVersion is missing");
  }
  if (
    v2Metadata &&
    input.fieldsFilled != null &&
    input.fieldsFilled !== v2Metadata.fieldsVerified
  ) {
    return reject(422, "fieldsFilled must equal fieldsVerified for V2");
  }
  if (v2Metadata && input.taskId != null) {
    return reject(422, "V2 fill events cannot complete a task");
  }
  if (input.docsAttached != null) {
    return reject(422, "docsAttached is not accepted by the value-free fill event contract");
  }
  const fieldsFilled = v2Metadata?.fieldsVerified ?? input.fieldsFilled ?? 0;
  if (!Number.isInteger(fieldsFilled) || fieldsFilled < 0 || fieldsFilled > MAX_INT4) {
    return reject(422, "fieldsFilled must be a non-negative 32-bit integer");
  }
  if (input.startedAt != null && !isValidTimestamp(input.startedAt)) {
    return reject(422, "startedAt must be an ISO timestamp");
  }
  if (input.completedAt != null && !isValidTimestamp(input.completedAt)) {
    return reject(422, "completedAt must be an ISO timestamp");
  }

  // ---- org validation, all BEFORE any write (the isolation contract) ----
  if (!(await belongsToOrg(ctx, "credential_cases", input.caseId))) {
    return reject(404, "Case not found");
  }
  if (input.providerId != null && !(await belongsToOrg(ctx, "providers", input.providerId))) {
    return reject(404, "Provider not found");
  }
  if (input.taskId != null && !(await belongsToOrg(ctx, "tasks", input.taskId))) {
    return reject(404, "Task not found");
  }

  // V1 retains historical retry/task behavior. V2 compares the immutable
  // stored event because its audit is committed atomically by the database.
  const replay = async (row: Record<string, unknown>): Promise<RecordFillEventResult> => {
    const storedIsV2 = row.event_schema_version === 2;
    const incomingIsV2 = v2Metadata !== null;
    if (
      (storedIsV2 || incomingIsV2) &&
      (!storedIsV2 || !incomingIsV2 || !sameStoredFill(row, input, ctx))
    ) {
      return reject(409, "Idempotency id was already used with a different fill event");
    }
    if (input.taskId != null) await completeTaskForFill(ctx, input.taskId);
    return { kind: "duplicate", session: toFillSession(row) };
  };

  // ---- idempotency: same id in THIS org = a replay; return the stored row ----
  const { data: existing, error: existingErr } = await ctx.db
    .from("fill_sessions")
    .select(FILL_SESSION_COLUMNS)
    .eq("id", input.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return replay(existing);

  // ---- insert; org + performer come from the authenticated ctx only ----
  const row: Record<string, unknown> = {
    id: input.id,
    org_id: ctx.orgId,
    case_id: input.caseId,
    provider_id: input.providerId ?? null,
    portal_key: input.portalKey,
    fill_mode: fillMode,
    completed_at: input.completedAt ?? null,
    fields_filled: fieldsFilled,
    fields_skipped: v2Metadata
      ? v2SkippedProjection(v2Metadata)
      : sanitizeLegacyFieldsSkipped(input.fieldsSkipped),
    docs_attached: v2Metadata ? null : (input.docsAttached ?? null),
    performed_by: ctx.userId,
    is_test: input.isTest ?? false,
    event_schema_version: input.schemaVersion ?? null,
  };
  if (v2Metadata) {
    row.event_schema_version = 2;
    row.fields_attempted = v2Metadata.fieldsAttempted;
    row.fields_verified = v2Metadata.fieldsVerified;
    row.fields_rejected = v2Metadata.fieldsRejected;
    row.field_outcomes = v2Metadata.fieldOutcomes;
  }
  // Omit started_at when absent so the column default (now()) applies.
  if (input.startedAt != null) row.started_at = input.startedAt;

  const { data, error } = await ctx.db
    .from("fill_sessions")
    .insert(row as never)
    .select(FILL_SESSION_COLUMNS)
    .single();
  if (error) {
    // Unique violation after the org-scoped lookup missed. Two cases: a
    // same-org RACE (a concurrent request with the same id won the insert
    // between our lookup and now) — re-look-up and return the stored row,
    // the documented idempotent behavior; or the id exists in ANOTHER org —
    // say "already used" without revealing that row.
    if ((error as { code?: string }).code === "23505") {
      const { data: raced, error: racedErr } = await ctx.db
        .from("fill_sessions")
        .select(FILL_SESSION_COLUMNS)
        .eq("id", input.id)
        .eq("org_id", ctx.orgId)
        .maybeSingle();
      if (racedErr) throw racedErr;
      if (raced) return replay(raced);
      return reject(409, "Idempotency id already used");
    }
    throw error;
  }
  const session = toFillSession(data);

  if (!v2Metadata) {
    await ctx.writeAudit({
      actionType: "CREATE",
      entityType: "fill_session",
      entityId: session.id,
      after: {
        caseId: session.caseId,
        providerId: session.providerId,
        portalKey: session.portalKey,
        fillMode: session.fillMode,
        fieldsFilled: session.fieldsFilled,
        taskId: input.taskId ?? null,
      },
      description: `Fill session logged (${session.portalKey})`,
    });
  }

  if (input.taskId != null) await completeTaskForFill(ctx, input.taskId);

  return { kind: "created", session };
}

// ---------------------------------------------------------------------------
// Browser path (RLS-guarded) — Portals admin's "last fill" column. Returns the
// org's recent fill sessions (most recent first); the hook reduces to the
// latest row per portal_key.
// ---------------------------------------------------------------------------
export async function listRecentFillsFromApp(limit = 200): Promise<FillSession[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("fill_sessions")
    .select(FILL_SESSION_COLUMNS)
    .eq("org_id", orgId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => toFillSession(row as Record<string, unknown>));
}

/** Capability probe used by field-map responses. A caller gets V2 metadata
 * only when this database can select every required additive column. */
export async function supportsFillEventV2(
  ctx: Pick<FillSessionServiceCtx, "db">,
): Promise<boolean> {
  try {
    const { error } = await ctx.db.from("fill_sessions").select(FILL_EVENT_V2_COLUMNS).limit(0);
    return error == null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// E4.2 F4.2.7 — the in-app form test runner. A dry-run fill against the
// designated test provider needs NO case (case_id is nullable since E4.2) and
// NEVER submits to a payer — it only records what a fill WOULD do (per-field
// filled / skipped-unmapped / empty-token), marked is_test so every metric
// reader (scorecard firstPassRate, reporting) excludes it. Browser RLS path
// (writer INSERT on own-org rows); org/performer from the auth context.
// ---------------------------------------------------------------------------
export interface TestFillInput {
  /** null since E6.5 — the mock-data dry run fills from the synthetic profile
   * (mockFillProfile.ts) and involves no provider row at all. */
  providerId: string | null;
  portalKey: string;
  fieldsFilled: number;
  fieldsSkipped: FillSkippedField[];
  /** E6.11 — a payer-PDF sample fill is a `pdf` run. Defaults to `web` so the
   * online-form runner's calls are unchanged; without this every PDF test fill
   * would be logged as a portal fill and misread by the readers. */
  fillMode?: "web" | "pdf";
  /** Stable id supplied by an in-memory recording retry, if present. */
  id?: string;
  startedAt?: string;
  completedAt?: string;
  event?: FillEventV2Metadata;
  expectedOrgId?: string;
  expectedUserId?: string;
  isCurrent?: () => boolean;
}

function requireBrowserUuid(value: string | undefined): string {
  const id = value ?? globalThis.crypto?.randomUUID?.();
  if (!id || !UUID_RE.test(id)) throw new Error("Fill event identity is unavailable");
  return id;
}

function assertSameBrowserFill(row: Record<string, unknown>, input: Record<string, unknown>): void {
  const keys = [
    "org_id",
    "case_id",
    "provider_id",
    "portal_key",
    "fill_mode",
    "fields_filled",
    "fields_skipped",
    "docs_attached",
    "performed_by",
    "is_test",
    "event_schema_version",
    "fields_attempted",
    "fields_verified",
    "fields_rejected",
    "field_outcomes",
  ];
  const same = keys.every(
    (key) => canonicalJson(row[key] ?? null) === canonicalJson(input[key] ?? null),
  );
  const sameInstant = (left: unknown, right: unknown) => {
    if (left == null || right == null) return left == null && right == null;
    const leftMs = Date.parse(String(left));
    const rightMs = Date.parse(String(right));
    return !Number.isNaN(leftMs) && leftMs === rightMs;
  };
  if (
    !same ||
    !sameInstant(row.started_at, input.started_at) ||
    !sameInstant(row.completed_at, input.completed_at)
  ) {
    throw new Error("Fill event id was already used with different data");
  }
}

async function recordBrowserFillRow(
  row: Record<string, unknown>,
  audit: { description: string; after: Record<string, unknown> },
  isCurrent?: () => boolean,
): Promise<FillSession> {
  const assertCurrent = (): boolean => {
    if (isCurrent?.() === false) {
      throw new Error("The fill context changed before its result could be recorded");
    }
    return true;
  };
  const id = row.id as string;
  const orgId = row.org_id as string;
  const findExisting = async () => {
    const { data, error } = await supabase
      .from("fill_sessions")
      .select(FILL_SESSION_COLUMNS)
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw new Error("Could not check the fill recording status");
    return data as Record<string, unknown> | null;
  };

  const existing = await findExisting();
  assertCurrent();
  if (existing) {
    assertSameBrowserFill(existing, row);
    return toFillSession(existing);
  }

  assertCurrent();
  const { data, error } = await supabase
    .from("fill_sessions")
    .insert(row as never)
    .select(FILL_SESSION_COLUMNS)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const raced = await findExisting();
      assertCurrent();
      if (raced) {
        assertSameBrowserFill(raced, row);
        return toFillSession(raced);
      }
    }
    throw new Error("Could not record the fill result");
  }

  const session = toFillSession(data as Record<string, unknown>);
  if (row.event_schema_version !== 2) {
    await writeAudit({
      actionType: "CREATE",
      entityType: "fill_session",
      entityId: session.id,
      after: audit.after,
      description: audit.description,
    });
  }
  return session;
}

export async function recordTestFillFromApp(input: TestFillInput): Promise<FillSession> {
  const orgId = requireActiveOrg();
  const actorId = currentUserId();
  if (
    (input.expectedOrgId != null && input.expectedOrgId !== orgId) ||
    (input.expectedUserId != null && input.expectedUserId !== actorId)
  ) {
    throw new Error("The active organization or user changed before the fill result was recorded");
  }
  const event = input.event;
  if (input.fillMode === "pdf" && !event) throw new Error("PDF recording requires field outcomes");
  if (event && !isFillEventV2Metadata(event)) throw new Error("V2 fill metadata is invalid");
  const now = new Date().toISOString();
  const id = requireBrowserUuid(input.id);
  const fieldsSkipped = event
    ? v2SkippedProjection(event)
    : sanitizeLegacyFieldsSkipped(input.fieldsSkipped);
  const row: Record<string, unknown> = {
    id,
    org_id: orgId,
    case_id: null,
    provider_id: input.providerId,
    portal_key: input.portalKey,
    fill_mode: input.fillMode ?? "web",
    started_at: input.startedAt ?? now,
    completed_at: input.completedAt ?? now,
    fields_filled: event?.fieldsVerified ?? input.fieldsFilled,
    fields_skipped: fieldsSkipped,
    docs_attached: null,
    performed_by: currentUserId(),
    is_test: true,
    event_schema_version: event ? 2 : null,
    fields_attempted: event?.fieldsAttempted ?? null,
    fields_verified: event?.fieldsVerified ?? null,
    fields_rejected: event?.fieldsRejected ?? null,
    field_outcomes: event?.fieldOutcomes ?? null,
  };
  return recordBrowserFillRow(
    row,
    {
      after: {
        providerId: input.providerId,
        portalKey: input.portalKey,
        fieldsFilled: row.fields_filled,
        isTest: true,
      },
      description: `Test fill run (${input.portalKey})`,
    },
    input.isCurrent,
  );
}

// ---------------------------------------------------------------------------
// E6.11 B6 — a REAL payer-PDF fill, run in the browser from the case.
//
// Not the extension's `/api/fill-events` path: nothing here is generated by an
// extension, and the fill happens entirely in this tab. It uses a generated
// idempotency key held in memory for retries, alongside the browser RLS insert.
// The case is attached, `is_test` false, and `fill_mode='pdf'`.
//
// Only bounded outcomes are stored. No field VALUE is written to the row or
// audit trail — the values went into a local PDF and stay there.
// ---------------------------------------------------------------------------
export interface PayerFormFillInput {
  id: string;
  startedAt: string;
  completedAt: string;
  orgId: string;
  userId: string;
  caseId: string;
  providerId: string | null;
  /** `payer-form:<familyId>` — the mapping key, so fills join to the family. */
  portalKey: string;
  event: FillEventV2Metadata;
  isCurrent?: () => boolean;
}

export async function recordPayerFormFill(input: PayerFormFillInput): Promise<FillSession> {
  const orgId = requireActiveOrg();
  const userId = currentUserId();
  if (input.orgId !== orgId || input.userId !== userId) {
    throw new Error("The active organization or user changed before the fill result was recorded");
  }
  if (!UUID_RE.test(input.id) || !isFillEventV2Metadata(input.event)) {
    throw new Error("PDF fill recording is invalid");
  }
  const row: Record<string, unknown> = {
    id: input.id,
    org_id: orgId,
    case_id: input.caseId,
    provider_id: input.providerId,
    portal_key: input.portalKey,
    fill_mode: "pdf",
    started_at: input.startedAt,
    completed_at: input.completedAt,
    fields_filled: input.event.fieldsVerified,
    fields_skipped: v2SkippedProjection(input.event),
    docs_attached: null,
    performed_by: input.userId,
    is_test: false,
    event_schema_version: 2,
    fields_attempted: input.event.fieldsAttempted,
    fields_verified: input.event.fieldsVerified,
    fields_rejected: input.event.fieldsRejected,
    field_outcomes: input.event.fieldOutcomes,
  };
  return recordBrowserFillRow(
    row,
    {
      after: {
        caseId: input.caseId,
        portalKey: input.portalKey,
        fieldsVerified: input.event.fieldsVerified,
      },
      description: `Payer form fill result recorded (${input.portalKey})`,
    },
    input.isCurrent,
  );
}

/** Test fills for a portal, most recent first (the runner's result history). */
export async function listTestFillsFromApp(portalKey: string): Promise<FillSession[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("fill_sessions")
    .select(FILL_SESSION_COLUMNS)
    .eq("org_id", orgId)
    .eq("portal_key", portalKey)
    .eq("is_test", true)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toFillSession(row as Record<string, unknown>));
}

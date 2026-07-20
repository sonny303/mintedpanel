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
import type { FillMode, FillSession, FillSkippedField } from "@/types";

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
}

export type RecordFillEventResult =
  | { kind: "created"; session: FillSession }
  | { kind: "duplicate"; session: FillSession }
  | { kind: "rejected"; status: 404 | 409 | 422; message: string };

const FILL_SESSION_COLUMNS =
  "id, org_id, case_id, provider_id, portal_key, fill_mode, started_at, completed_at, fields_filled, fields_skipped, docs_attached, performed_by, is_test";

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

// camelizeRow walks nested objects, which would rewrite keys INSIDE the
// client-supplied jsonb payloads (fields_skipped/docs_attached); restore them
// verbatim so the echoed session matches what the client stored.
function toFillSession(row: Record<string, unknown>): FillSession {
  const session = camelizeRow<FillSession>(row);
  // fields_skipped is client jsonb echoed VERBATIM (the extension's R2 wire
  // contract — camelize must not rewrite keys inside it). The E4.2 type is
  // structured; readers that need the structure parse via parseFillSkipped.
  session.fieldsSkipped = (row.fields_skipped ?? null) as FillSession["fieldsSkipped"];
  session.docsAttached = row.docs_attached ?? null;
  session.isTest = Boolean(row.is_test);
  return session;
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
  const fieldsFilled = input.fieldsFilled ?? 0;
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

  // A replay returns the stored row and re-runs the (idempotent) task
  // completion: if a prior attempt failed transiently between the insert and
  // the task update, the client's retry converges the side effect instead of
  // silently dropping it. completeTaskForFill early-returns on an
  // already-completed task, so ordinary replays change nothing and never
  // double-audit. The session audit row is NOT re-attempted here — replays
  // must not double-audit, and there is no cheap existence check.
  const replay = async (row: Record<string, unknown>): Promise<RecordFillEventResult> => {
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
    fields_skipped: input.fieldsSkipped ?? null,
    docs_attached: input.docsAttached ?? null,
    performed_by: ctx.userId,
    is_test: input.isTest ?? false,
  };
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
}

export async function recordTestFillFromApp(input: TestFillInput): Promise<FillSession> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("fill_sessions")
    .insert({
      org_id: orgId,
      case_id: null,
      provider_id: input.providerId,
      portal_key: input.portalKey,
      fill_mode: "web",
      completed_at: new Date().toISOString(),
      fields_filled: input.fieldsFilled,
      fields_skipped: input.fieldsSkipped as never,
      performed_by: currentUserId(),
      is_test: true,
    } as never)
    .select(FILL_SESSION_COLUMNS)
    .single();
  if (error) throw error;
  const session = toFillSession(data as Record<string, unknown>);
  await writeAudit({
    actionType: "CREATE",
    entityType: "fill_session",
    entityId: session.id,
    after: {
      providerId: session.providerId,
      portalKey: session.portalKey,
      fieldsFilled: session.fieldsFilled,
      isTest: true,
    },
    description: `Test fill run (${session.portalKey})`,
  });
  return session;
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

// Submission touches: the extension's business log. When the HUMAN submits a
// portal form (the extension never does — locked decision, forever), the
// popup's "Mark submitted" posts here and we append ONE touch to the case:
// touch_type 'portal', outcome 'submitted', source 'extension'. Fill events
// (fill_sessions) stay the machine log; this row is the case-timeline record.
// Never a status change, never a task write — this route logs, nothing else.
//
// Idempotent exactly like fill-events: the CLIENT-generated idempotency_id
// becomes the touch row's primary key, so a duplicate POST returns the stored
// row instead of inserting twice.
//
// Isolation contract: case (and fill-session, when referenced) ownership is
// validated against the caller's resolved org BEFORE anything is written;
// org_id and the performing user come from the authenticated context only,
// never the request body.
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts. The
// app's manual touch path stays in touches.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AuditInput } from "@/lib/audit";
import { camelizeRow } from "@/lib/case";
import type { Touch } from "@/types";

export interface SubmissionTouchServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
  writeAudit: (input: AuditInput) => Promise<void>;
}

// Wire shape of POST /api/cases/:id/touches — snake_case body keys per the
// locked R2 contract (2026-07-05). kind is fixed; anything else is a 422.
export interface SubmissionTouchInput {
  kind: string;
  portal_key: string;
  // The fill session this submission followed, when there was one.
  fill_session_id?: string | null;
  note?: string | null;
  // Client-generated idempotency id (UUID); becomes touches.id.
  idempotency_id: string;
}

export type RecordSubmissionTouchResult =
  | { kind: "created"; touch: Touch }
  | { kind: "duplicate"; touch: Touch }
  | { kind: "rejected"; status: 404 | 409 | 422; message: string };

const TOUCH_COLUMNS =
  "id, org_id, case_id, touch_date, touch_type, outcome, next_follow_up_date, notes, coordinator_id, source, created_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rejected = Extract<RecordSubmissionTouchResult, { kind: "rejected" }>;

function reject(status: Rejected["status"], message: string): Rejected {
  return { kind: "rejected", status, message };
}

// Human label for a portal_key. There is no server-side portal catalog yet
// (labels live in the extension's portals.ts), so derive deterministically:
// underscore segments; short segments read as acronyms/state codes and are
// uppercased, longer ones capitalized. "bcbs_ks_enrollment" -> "BCBS KS
// Enrollment". Swap in the catalog lookup if a portals table ever lands.
export function portalKeyLabel(portalKey: string): string {
  return portalKey
    .split("_")
    .filter((segment) => segment !== "")
    .map((segment) =>
      segment.length <= 4
        ? segment.toUpperCase()
        : segment[0].toUpperCase() + segment.slice(1).toLowerCase(),
    )
    .join(" ");
}

export async function recordSubmissionTouch(
  ctx: SubmissionTouchServiceCtx,
  caseId: string,
  input: SubmissionTouchInput,
): Promise<RecordSubmissionTouchResult> {
  // ---- shape validation (nothing has touched the DB yet) ----
  // The case id is a path segment: a non-UUID can't be a case, so 404 (the
  // profile-route precedent) rather than a Postgres uuid-cast 500.
  if (!UUID_RE.test(caseId ?? "")) return reject(404, "Case not found");
  if (input.kind !== "portal_submission") {
    return reject(422, "kind must be 'portal_submission'");
  }
  if (!UUID_RE.test(input.idempotency_id ?? "")) {
    return reject(422, "idempotency_id must be a client-generated UUID");
  }
  if (typeof input.portal_key !== "string" || input.portal_key.trim() === "") {
    return reject(422, "portal_key is required");
  }
  if (input.fill_session_id != null && !UUID_RE.test(input.fill_session_id)) {
    return reject(422, "fill_session_id must be a UUID");
  }
  if (input.note != null && typeof input.note !== "string") {
    return reject(422, "note must be a string");
  }

  // ---- org validation, all BEFORE any write (the isolation contract) ----
  const { data: caseRow, error: caseErr } = await ctx.db
    .from("credential_cases")
    .select("id")
    .eq("id", caseId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) return reject(404, "Case not found");

  if (input.fill_session_id != null) {
    const { data: session, error: sessionErr } = await ctx.db
      .from("fill_sessions")
      .select("id")
      .eq("id", input.fill_session_id)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return reject(404, "Fill session not found");
  }

  // ---- idempotency: same id in THIS org = a replay; return the stored row.
  // Replays never re-audit (mirrors fill-events). ----
  const { data: existing, error: existingErr } = await ctx.db
    .from("touches")
    .select(TOUCH_COLUMNS)
    .eq("id", input.idempotency_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return { kind: "duplicate", touch: camelizeRow<Touch>(existing) };

  const portalKey = input.portal_key.trim();
  const note = input.note?.trim();
  const text = `Application submitted via ${portalKeyLabel(portalKey)}${note ? ` — ${note}` : ""}`;

  // ---- insert; org + performer come from the authenticated ctx only ----
  const row = {
    id: input.idempotency_id,
    org_id: ctx.orgId,
    case_id: caseId,
    touch_date: new Date().toISOString().slice(0, 10),
    touch_type: "portal",
    outcome: "submitted",
    coordinator_id: ctx.userId,
    source: "extension",
    notes: text,
  };

  const { data, error } = await ctx.db
    .from("touches")
    .insert(row as never)
    .select(TOUCH_COLUMNS)
    .single();
  if (error) {
    // Unique violation after the org-scoped lookup missed: a same-org RACE
    // (return the winner's row — the documented idempotent behavior) or the
    // id exists in ANOTHER org (say "already used" without revealing it).
    if ((error as { code?: string }).code === "23505") {
      const { data: raced, error: racedErr } = await ctx.db
        .from("touches")
        .select(TOUCH_COLUMNS)
        .eq("id", input.idempotency_id)
        .eq("org_id", ctx.orgId)
        .maybeSingle();
      if (racedErr) throw racedErr;
      if (raced) return { kind: "duplicate", touch: camelizeRow<Touch>(raced) };
      return reject(409, "Idempotency id already used");
    }
    throw error;
  }
  const touch = camelizeRow<Touch>(data);

  await ctx.writeAudit({
    actionType: "TOUCH_LOGGED",
    entityType: "touch",
    entityId: touch.id,
    after: {
      caseId,
      portalKey,
      fillSessionId: input.fill_session_id ?? null,
      touchType: "portal",
      outcome: "submitted",
      source: "extension",
    },
    description: text,
  });

  return { kind: "created", touch };
}

// Submission touches: the extension's business log. When the HUMAN submits a
// portal form (the extension never does — locked decision, forever), the
// popup's "Mark submitted" posts here and we append the submission to the case
// touchlog. The R2 core is ONE touchpoint (touch_type 'portal', outcome
// 'submitted', source 'extension'); PR C (Stories 5–7) layers the touchlog
// write-back on top of that same POST:
//   - Story 5: an optional payer_reference_id overwrites the case's latest-wins
//     reference (history stays in the touchlog, not the column).
//   - Story 6: an optional wip_note becomes a touchlog `note` entry, tied to
//     task_id when the extension knows one.
//   - Story 7: every submit also writes a `system_event` "Form submitted to
//     {payer}"; when the extension passes the explicit task_id it just submitted
//     (locked decision (c), 2026-07-07), that task is marked done and a
//     `task_update` entry records it; an optional pdf_filename writes a second
//     `system_event` "PDF attached: {filename}".
// Fill events (fill_sessions) stay the machine log; these rows are the
// case-timeline record. The extension never changes case *status* (v1).
//
// Idempotent exactly like fill-events: the CLIENT-generated idempotency_id
// becomes the anchor touchpoint's primary key, so a duplicate POST returns the
// stored row instead of inserting twice. The Story 5–7 side effects run only on
// the first create; a replay short-circuits at the anchor lookup and re-writes
// nothing (the same best-effort model as the R2 touch — a mid-sequence failure
// returns 500 and the client retry converges on "already submitted").
//
// Isolation contract: case, fill-session, AND task ownership are all validated
// against the caller's resolved org BEFORE anything is written; org_id and the
// performing user come from the authenticated context only, never the request
// body. The task_id ownership check is the isolation gate's assertion 13.
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
  // --- PR C write-back (snake_case per the R2 wire contract) ---
  // Story 5: overwrite the case's latest-wins payer reference / submission id.
  payer_reference_id?: string | null;
  // Story 6: a work-in-progress note → a touchlog `note` entry (task-linked
  // when task_id is present).
  wip_note?: string | null;
  // Story 7: the SOP task the human just submitted (locked decision (c)); when
  // owned by the org it is marked done + a `task_update` entry is written.
  task_id?: string | null;
  // Story 7: the filename of the PDF the human attached, if any → a second
  // `system_event`.
  pdf_filename?: string | null;
}

export type RecordSubmissionTouchResult =
  | { kind: "created"; touch: Touch }
  | { kind: "duplicate"; touch: Touch }
  | { kind: "rejected"; status: 404 | 409 | 422; message: string };

const TOUCH_COLUMNS =
  "id, org_id, case_id, touch_date, entry_type, touch_type, outcome, next_follow_up_date, notes, coordinator_id, task_id, communication_event_id, source, created_at";

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

// A trimmed, non-empty string, or null. Used for the optional free-text fields
// so a blank/whitespace value is a no-op, never a spurious write (Story 5's
// payer reference is latest-wins — a blank must not clear it).
function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const today = (): string => new Date().toISOString().slice(0, 10);

// Append one non-touchpoint touchlog entry (note / system_event / task_update).
// entry_type carries the kind; the text lives in `notes`; touch_type/outcome
// stay null (the touchpoint-shape CHECK only constrains touchpoints). org_id and
// performer come from ctx, never the body.
async function insertEntry(
  ctx: SubmissionTouchServiceCtx,
  caseId: string,
  entryType: "note" | "system_event" | "task_update",
  notes: string,
  taskId: string | null = null,
): Promise<void> {
  const { error } = await ctx.db.from("touches").insert({
    org_id: ctx.orgId,
    case_id: caseId,
    task_id: taskId,
    entry_type: entryType,
    touch_date: today(),
    notes,
    coordinator_id: ctx.userId,
    source: "extension",
  } as never);
  if (error) throw error;
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
  if (input.payer_reference_id != null && typeof input.payer_reference_id !== "string") {
    return reject(422, "payer_reference_id must be a string");
  }
  if (input.wip_note != null && typeof input.wip_note !== "string") {
    return reject(422, "wip_note must be a string");
  }
  if (input.task_id != null && !UUID_RE.test(input.task_id)) {
    return reject(422, "task_id must be a UUID");
  }
  if (input.pdf_filename != null && typeof input.pdf_filename !== "string") {
    return reject(422, "pdf_filename must be a string");
  }

  // ---- org validation, ALL before any write (the isolation contract) ----
  // The payer name rides along with the case ownership lookup so the Story 7
  // system_event can read "Form submitted to {payer}" without a second query.
  const { data: caseRow, error: caseErr } = await ctx.db
    .from("credential_cases")
    .select("id, payers(name)")
    .eq("id", caseId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) return reject(404, "Case not found");
  const payerName = (caseRow as { payers?: { name?: string | null } | null }).payers?.name ?? null;

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

  // Story 7: fetch the task's ownership AND status in one org-scoped read. A
  // cross-org (or nonexistent) task_id is a 404 before any write — the gate's
  // assertion 13. status decides whether the submit transitions it (an
  // already-completed task is a no-op, never a duplicate task_update).
  let taskBefore: { id: string; status: string } | null = null;
  if (input.task_id != null) {
    const { data, error } = await ctx.db
      .from("tasks")
      .select("id, status")
      .eq("id", input.task_id)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return reject(404, "Task not found");
    taskBefore = data as { id: string; status: string };
  }

  // ---- idempotency: same id in THIS org = a replay; return the stored row.
  // Replays never re-audit and never re-run the Story 5–7 side effects
  // (mirrors fill-events / the R2 touch). ----
  const { data: existing, error: existingErr } = await ctx.db
    .from("touches")
    .select(TOUCH_COLUMNS)
    .eq("id", input.idempotency_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return { kind: "duplicate", touch: camelizeRow<Touch>(existing) };

  const portalKey = input.portal_key.trim();
  const note = cleanText(input.note);
  const payerRef = cleanText(input.payer_reference_id);
  const wipNote = cleanText(input.wip_note);
  const pdfFilename = cleanText(input.pdf_filename);
  const text = `Application submitted via ${portalKeyLabel(portalKey)}${note ? ` — ${note}` : ""}`;
  const payerLabel = payerName ?? portalKeyLabel(portalKey);

  // ---- Story 5: overwrite the case's latest-wins payer reference (the case
  // is already validated as own-org above). Audited as a case UPDATE. ----
  if (payerRef) {
    const { data: refRow, error: refErr } = await ctx.db
      .from("credential_cases")
      .update({ payer_reference_id: payerRef } as never)
      .eq("id", caseId)
      .eq("org_id", ctx.orgId)
      .select("id")
      .maybeSingle();
    if (refErr) throw refErr;
    if (refRow) {
      await ctx.writeAudit({
        actionType: "UPDATE",
        entityType: "case",
        entityId: caseId,
        after: { payerReferenceId: payerRef },
        description: "Payer reference set via extension submit",
      });
    }
  }

  // ---- insert the anchor touchpoint; org + performer come from ctx only.
  // This is the idempotency anchor AND the canonical "submitted" record that
  // GET /api/cases reads for the duplicate-submission guard (outcome
  // 'submitted'). ----
  const row = {
    id: input.idempotency_id,
    org_id: ctx.orgId,
    case_id: caseId,
    entry_type: "touchpoint",
    touch_date: today(),
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

  // ---- Story 7: the system-side "form submitted to {payer}" record (the human
  // business-log touchpoint above is its companion). ----
  await insertEntry(ctx, caseId, "system_event", `Form submitted to ${payerLabel}`);

  // ---- Story 6: a work-in-progress note, task-linked when the extension knew
  // which task. ----
  if (wipNote) {
    await insertEntry(ctx, caseId, "note", wipNote, input.task_id ?? null);
  }

  // ---- Story 7: close the linked task (already ownership-validated) and record
  // it. An already-completed task is left alone (no duplicate task_update). ----
  if (taskBefore && taskBefore.status !== "completed") {
    const { error: taskErr } = await ctx.db
      .from("tasks")
      .update({ status: "completed", completed_date: today() } as never)
      .eq("id", taskBefore.id)
      .eq("org_id", ctx.orgId)
      .select("id")
      .single();
    if (taskErr) throw taskErr;
    await insertEntry(
      ctx,
      caseId,
      "task_update",
      `Task ${taskBefore.id} marked done via extension submit`,
      taskBefore.id,
    );
    await ctx.writeAudit({
      actionType: "UPDATE",
      entityType: "task",
      entityId: taskBefore.id,
      before: { status: taskBefore.status },
      after: { status: "completed" },
      description: "Task completed by extension submit",
    });
  }

  // ---- Story 7: the attached PDF, as a second system_event. ----
  if (pdfFilename) {
    await insertEntry(ctx, caseId, "system_event", `PDF attached: ${pdfFilename}`);
  }

  await ctx.writeAudit({
    actionType: "TOUCH_LOGGED",
    entityType: "touch",
    entityId: touch.id,
    after: {
      caseId,
      portalKey,
      fillSessionId: input.fill_session_id ?? null,
      taskId: input.task_id ?? null,
      payerReferenceSet: payerRef != null,
      wipNoteAdded: wipNote != null,
      pdfAttached: pdfFilename != null,
      touchType: "portal",
      outcome: "submitted",
      source: "extension",
    },
    description: text,
  });

  return { kind: "created", touch };
}

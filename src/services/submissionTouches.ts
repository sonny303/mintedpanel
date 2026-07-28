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
// E4.3 TE-5 / F4.3.4 adds a SECOND kind on the same POST: `structured_touch` —
// the E4.1 structured-touch contract from the extension (log-and-advance loop).
// The specialist picks one of the seven canonical touch types, adds the
// single-line context, and optionally a disposition, recipient, follow-up
// date, and tracking ID. The server appends ONE touchpoint (source
// 'extension', org/user from ctx) and writes ONE audit event — never the
// free-text context in the audit (TE-8). The optional payer_reference_id
// rides the same audited latest-wins write-back as the portal submission's
// Story 5. Same idempotency semantics: idempotency_id is the touch PK, a
// replay returns the stored row and re-runs nothing.
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
import { CANONICAL_TOUCH_TYPES } from "@/lib/touchTypes";
import { dispositionRequiresContext, isDisposition } from "@/lib/touchDispositions";
import type { Touch, TouchOutcome, TouchType } from "@/types";

export interface SubmissionTouchServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
  writeAudit: (input: AuditInput) => Promise<void>;
  // The caller-JWT-bound client (RLS + auth.uid()), for the opt-in status bump
  // only — see bumpCaseToSubmitted. Every other write here stays on `db`.
  asUser: () => SupabaseClient<Database>;
}

// Wire shape of POST /api/cases/:id/touches — snake_case body keys per the
// locked R2 contract (2026-07-05). kind ∈ {portal_submission, structured_touch}
// (the latter added by E4.3 TE-5); anything else is a 422.
export interface SubmissionTouchInput {
  kind: string;
  // Required for portal_submission; not accepted on structured_touch.
  portal_key?: string;
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
  // Opt-in: also move the case to Submitted, evidenced by this touch. Accepted
  // on portal_submission ONLY — "the human submitted the portal form" has one
  // unambiguous target, whereas a structured touch of any of the seven types
  // does not. Off by default, preserving the R2 rule that the extension never
  // changes case status unless explicitly asked to for this one transition.
  bump_status?: boolean;
  // --- E4.3 structured touch (kind 'structured_touch' only; E4.1 contract,
  // snake_case per this endpoint's locked idiom) ---
  // REQUIRED for structured_touch: one of the seven canonical E4.1 types.
  touch_type?: string;
  // Optional E4.1 disposition; 'other' requires the single-line context.
  outcome?: string | null;
  // Optional recipient capture (F4.1.5).
  recipient_name?: string | null;
  recipient_contact?: string | null;
  // Optional follow-up date (YYYY-MM-DD); clears_follow_up is the only way to
  // END an active follow-up (F4.1.2 — a missing date carries it forward).
  next_follow_up_date?: string | null;
  clears_follow_up?: boolean;
}

/** Outcome of an opt-in status bump, reported in the response meta. The touch
 * is the deliverable; the bump is a best-effort follow-on. */
export interface StatusBumpOutcome {
  applied: boolean;
  /** Populated only when applied === false: why the bump did not land. Safe,
   * caller-facing text (the mapped set_case_status message), never raw SQL. */
  reason?: string;
}

export type RecordSubmissionTouchResult =
  | { kind: "created"; touch: Touch; bump?: StatusBumpOutcome }
  | { kind: "duplicate"; touch: Touch }
  | { kind: "rejected"; status: 404 | 409 | 422; message: string };

/** The one status a portal submission may bump a case to. Not caller-supplied:
 * "the human submitted the form" has exactly one meaning, and letting the
 * extension name an arbitrary target would hand it the transition machine. */
const BUMP_TARGET_STATUS = "submitted";

// set_case_status raises named errors; these are the ones a bump can plausibly
// hit. Mirrors the browser map in services/cases.ts — kept short on purpose:
// anything unrecognized degrades to a generic line rather than echoing SQL.
const BUMP_ERROR_MESSAGES: Record<string, string> = {
  case_status_invalid_transition: "The case was not in a status that can move to Submitted.",
  case_status_not_authorized: "Your role cannot change the case status.",
  case_status_case_not_found: "Case not found.",
  case_status_evidence_invalid: "The evidencing touch doesn't belong to this case.",
};

function bumpErrorReason(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("case_status_conflict")) {
    return "The case status changed while the touch was being logged.";
  }
  // Longest key first: case_status_invalid prefixes case_status_invalid_transition.
  const key = Object.keys(BUMP_ERROR_MESSAGES)
    .sort((a, b) => b.length - a.length)
    .find((k) => trimmed.startsWith(k));
  return key ? BUMP_ERROR_MESSAGES[key] : "The case status could not be updated.";
}

/** Move the case to Submitted, evidenced by the touch just written.
 *
 * Routed through the CALLER'S JWT (ctx.asUser), never the service-role client:
 * set_case_status is SECURITY INVOKER and leans on RLS to scope its
 * `SELECT ... FOR UPDATE` to the caller's org, on user_role() to authorize, and
 * on auth.uid() to stamp the actor into case_status_history. Under the service
 * key all three break at once — the lock would reach any org's case, the actor
 * would be NULL, and user_role() would deny. Using the caller's own token keeps
 * every transition rule where it already lives.
 *
 * expectedStatus is null (an auto-transition trigger may have just moved the
 * case — the E6.6 Add-touch bump does the same), and a FAILED bump never
 * unwinds the touch: the touch is the durable record of what the human did,
 * and losing it because a transition was illegal would be the worse outcome.
 */
async function bumpCaseToSubmitted(
  ctx: SubmissionTouchServiceCtx,
  caseId: string,
  evidenceTouchId: string,
): Promise<StatusBumpOutcome> {
  const rpc = ctx.asUser().rpc.bind(ctx.asUser()) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  try {
    const { error } = await rpc("set_case_status", {
      p_case_id: caseId,
      p_to_status: BUMP_TARGET_STATUS,
      p_expected_status: null,
      p_evidence_touch_id: evidenceTouchId,
    });
    if (error) return { applied: false, reason: bumpErrorReason(error.message ?? "") };
    return { applied: true };
  } catch {
    // A transport failure is not a reason to fail the whole request — the touch
    // already landed and the human's submission is recorded.
    return { applied: false, reason: "The case status could not be updated." };
  }
}

const TOUCH_COLUMNS =
  "id, org_id, case_id, touch_date, entry_type, touch_type, outcome, next_follow_up_date, notes, coordinator_id, task_id, communication_event_id, source, created_at, clears_follow_up, recipient_name, recipient_contact";

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
  if (input.kind !== "portal_submission" && input.kind !== "structured_touch") {
    return reject(422, "kind must be 'portal_submission' or 'structured_touch'");
  }
  // The bump target is only meaningful for a portal submission; a structured
  // touch of any of the seven types has no single obvious destination, so a
  // bump there is a client error rather than a silently ignored field.
  if (input.bump_status && input.kind !== "portal_submission") {
    return reject(422, "bump_status is only accepted on kind 'portal_submission'");
  }
  if (!UUID_RE.test(input.idempotency_id ?? "")) {
    return reject(422, "idempotency_id must be a client-generated UUID");
  }
  if (input.kind === "structured_touch") return recordStructuredTouch(ctx, caseId, input);
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

  // ---- Opt-in status bump (In Progress -> Submitted). ----
  // Runs LAST, only on a first create: a replay short-circuits at the anchor
  // above, so a retried POST can never double-bump. The touch is already
  // durable at this point — a rejected transition is reported in the response
  // meta, never rolled back onto the human's submission record.
  const bump = input.bump_status
    ? await bumpCaseToSubmitted(ctx, caseId, touch.id)
    : undefined;

  return { kind: "created", touch, bump };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Body fields that belong to the portal_submission flow only. Rejecting them
// loudly keeps the two kinds unambiguous for the coordinated extension build —
// a structured touch never closes tasks, links fill sessions, or writes
// system_events.
const PORTAL_SUBMISSION_ONLY_FIELDS = [
  "portal_key",
  "fill_session_id",
  "task_id",
  "wip_note",
  "pdf_filename",
] as const;

// E4.3 TE-5 — kind 'structured_touch': ONE E4.1 structured touchpoint appended
// from the extension. Required type, single-line context in `note`, optional
// disposition/recipient/follow-up, optional tracking-ID write-back. Server
// sets source 'extension', org + coordinator from ctx. One touch, one audit
// event (never the free-text context — TE-8); replays return the stored row.
async function recordStructuredTouch(
  ctx: SubmissionTouchServiceCtx,
  caseId: string,
  input: SubmissionTouchInput,
): Promise<RecordSubmissionTouchResult> {
  // ---- shape validation (nothing has touched the DB yet) ----
  for (const field of PORTAL_SUBMISSION_ONLY_FIELDS) {
    if (input[field] != null) {
      return reject(422, `${field} is only valid for kind 'portal_submission'`);
    }
  }
  const touchType = input.touch_type;
  if (
    typeof touchType !== "string" ||
    !(CANONICAL_TOUCH_TYPES as readonly string[]).includes(touchType)
  ) {
    return reject(422, `touch_type must be one of: ${CANONICAL_TOUCH_TYPES.join(", ")}`);
  }
  if (input.outcome != null && !isDisposition(input.outcome)) {
    return reject(422, "outcome must be a valid disposition");
  }
  if (input.note != null && typeof input.note !== "string") {
    return reject(422, "note must be a string");
  }
  const note = cleanText(input.note);
  if (dispositionRequiresContext((input.outcome ?? null) as TouchOutcome | null) && !note) {
    return reject(422, "outcome 'other' requires a one-line context in note");
  }
  if (input.recipient_name != null && typeof input.recipient_name !== "string") {
    return reject(422, "recipient_name must be a string");
  }
  if (input.recipient_contact != null && typeof input.recipient_contact !== "string") {
    return reject(422, "recipient_contact must be a string");
  }
  if (input.next_follow_up_date != null && !ISO_DATE_RE.test(input.next_follow_up_date)) {
    return reject(422, "next_follow_up_date must be a YYYY-MM-DD date");
  }
  if (input.clears_follow_up != null && typeof input.clears_follow_up !== "boolean") {
    return reject(422, "clears_follow_up must be a boolean");
  }
  if (input.payer_reference_id != null && typeof input.payer_reference_id !== "string") {
    return reject(422, "payer_reference_id must be a string");
  }

  // ---- org validation before any write (the isolation contract) ----
  const { data: caseRow, error: caseErr } = await ctx.db
    .from("credential_cases")
    .select("id")
    .eq("id", caseId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) return reject(404, "Case not found");

  // ---- idempotency: a replay returns the stored row, re-runs nothing ----
  const { data: existing, error: existingErr } = await ctx.db
    .from("touches")
    .select(TOUCH_COLUMNS)
    .eq("id", input.idempotency_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return { kind: "duplicate", touch: camelizeRow<Touch>(existing) };

  // ---- optional tracking-ID write-back (the audited Story 5 latest-wins
  // semantics; a blank value is a no-op, never a clear) ----
  const payerRef = cleanText(input.payer_reference_id);
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
        description: "Tracking ID set via extension touch",
      });
    }
  }

  // ---- append the ONE touchpoint; org + performer from ctx only ----
  const row = {
    id: input.idempotency_id,
    org_id: ctx.orgId,
    case_id: caseId,
    entry_type: "touchpoint",
    touch_date: today(),
    touch_type: touchType as TouchType,
    outcome: (input.outcome ?? null) as TouchOutcome | null,
    next_follow_up_date: input.next_follow_up_date ?? null,
    clears_follow_up: input.clears_follow_up ?? false,
    recipient_name: cleanText(input.recipient_name),
    recipient_contact: cleanText(input.recipient_contact),
    coordinator_id: ctx.userId,
    source: "extension",
    notes: note,
  };
  const { data, error } = await ctx.db
    .from("touches")
    .insert(row as never)
    .select(TOUCH_COLUMNS)
    .single();
  if (error) {
    // Same race semantics as the portal-submission anchor: a same-org winner's
    // row is the idempotent answer; a foreign-org id collision reveals nothing.
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

  // ---- the ONE audit event — IDs/flags only, never the free-text context ----
  await ctx.writeAudit({
    actionType: "TOUCH_LOGGED",
    entityType: "touch",
    entityId: touch.id,
    after: {
      caseId,
      touchType,
      outcome: input.outcome ?? null,
      followUpSet: input.next_follow_up_date != null,
      clearsFollowUp: input.clears_follow_up ?? false,
      payerReferenceSet: payerRef != null,
      source: "extension",
    },
    description: `Logged ${touchType} touch via extension`,
  });

  return { kind: "created", touch };
}

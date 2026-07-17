// Touchlog: the single append-only case-activity spine. Every row is a `touches`
// entry discriminated by entry_type (touchpoint | note | system_event |
// task_update). Touchpoints carry a channel + outcome; the other kinds carry
// their text in `notes`. Reads filter by org; touchpoint inserts also write an
// audit_log row with action_type 'TOUCH_LOGGED', note inserts write a CREATE row.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import { resolveActiveFollowUp, type FollowUpTouch } from "@/lib/followUps";
import type { Touch, TouchEntryType, TouchOutcome, TouchType } from "@/types";

// E4.1 structured touch input. `touchType` is required; everything else is
// optional. `outcome` (the disposition) is optional and never synthesized
// (F4.1.4). `clearsFollowUp` is the ONLY way to clear a follow-up (F4.1.2) — a
// missing `nextFollowUpDate` carries the prior one forward. `recipientName` /
// `recipientContact` are the optional recipient capture (F4.1.5). `source` is
// explicit per row (TE-6), defaulting to the webapp 'manual'. `correctsTouchId`
// makes this row a correction of an earlier touch (appended, never an edit).
export interface TouchInput {
  touchDate: string;
  touchType: TouchType;
  outcome?: TouchOutcome | null;
  nextFollowUpDate?: string | null;
  clearsFollowUp?: boolean;
  recipientName?: string | null;
  recipientContact?: string | null;
  notes?: string | null;
  source?: "manual" | "extension";
  correctsTouchId?: string | null;
  // Story 8: set when this touchpoint is one child of a batch payer call.
  communicationEventId?: string | null;
}

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// Build the append-only touchpoint row from a structured input. Org, case, and
// coordinator are set by the caller-facing functions, never from the input.
function touchpointRow(orgId: string, caseId: string, input: TouchInput): Record<string, unknown> {
  return {
    entry_type: "touchpoint",
    org_id: orgId,
    case_id: caseId,
    coordinator_id: currentUserId(),
    touch_date: input.touchDate,
    touch_type: input.touchType,
    outcome: input.outcome ?? null,
    next_follow_up_date: input.nextFollowUpDate ?? null,
    clears_follow_up: input.clearsFollowUp ?? false,
    recipient_name: trimOrNull(input.recipientName),
    recipient_contact: trimOrNull(input.recipientContact),
    notes: trimOrNull(input.notes),
    corrects_touch_id: input.correctsTouchId ?? null,
    communication_event_id: input.communicationEventId ?? null,
    source: input.source ?? "manual",
  };
}

function touchAuditDescription(t: Touch): string {
  const outcome = t.outcome ? ` (${t.outcome})` : "";
  return t.correctsTouchId
    ? `Correction: logged ${t.touchType} touch${outcome}`
    : `Logged ${t.touchType} touch${outcome}`;
}

export interface NoteInput {
  content: string;
  // Story 1: a note entry may optionally reference a task.
  taskId?: string | null;
}

// A touchlog slice with the author resolved for display (task detail view).
export interface TouchlogEntry {
  id: string;
  entryType: TouchEntryType;
  touchType: TouchType | null;
  outcome: TouchOutcome | null;
  content: string | null;
  authorName: string | null;
  createdAt: string;
  touchDate: string;
}

export async function getTouches(caseId: string): Promise<Touch[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("touches")
    .select("*")
    .eq("org_id", orgId)
    .eq("case_id", caseId)
    .order("touch_date", { ascending: false });
  if (error) throw error;
  return camelizeRow<Touch[]>(data ?? []);
}

// Latest touchpoint date per case for the active org, as a Map keyed by case_id.
// One query — used by list views to compute "stalled" without N+1 fetches.
// Scoped to touchpoints so a note/system entry never resets the stalled clock.
export async function getLastTouchDates(): Promise<Map<string, string>> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("touches")
    .select("case_id, touch_date")
    .eq("org_id", orgId)
    .eq("entry_type", "touchpoint")
    .order("touch_date", { ascending: false });
  if (error) throw error;
  const m = new Map<string, string>();
  for (const row of (data ?? []) as { case_id: string; touch_date: string }[]) {
    if (!m.has(row.case_id)) m.set(row.case_id, row.touch_date);
  }
  return m;
}

export async function logTouch(caseId: string, input: TouchInput): Promise<Touch> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("touches")
    .insert(touchpointRow(orgId, caseId, input) as never)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<Touch>(data);
  await writeAudit({
    actionType: "TOUCH_LOGGED",
    entityType: "touch",
    entityId: created.id,
    after: created,
    description: touchAuditDescription(created),
  });
  return created;
}

// E4.1 corrections (Edge Cases & Corrections): append a NEW touch that points at
// the one being corrected. No UPDATE path exists — the original stays intact and
// the log renders the pair ("corrected by …"). The target must be an org-owned
// touch on the same case.
export async function correctTouch(
  caseId: string,
  originalTouchId: string,
  input: TouchInput,
): Promise<Touch> {
  const orgId = requireActiveOrg();
  const { data: original, error: origErr } = await supabase
    .from("touches")
    .select("id, case_id")
    .eq("org_id", orgId)
    .eq("id", originalTouchId)
    .maybeSingle();
  if (origErr) throw origErr;
  if (!original) throw new Error("Original touch not found");
  if ((original as { case_id: string }).case_id !== caseId) {
    throw new Error("Correction must target a touch on the same case");
  }
  return logTouch(caseId, { ...input, correctsTouchId: originalTouchId });
}

export interface BulkTouchResult {
  created: Touch[];
  caseIds: string[];
}

// E4.1 bulk logging (F4.1.7/TE-6): one service call writes one touch row per
// selected case and one TOUCH_LOGGED audit row per touch, plus one batch-summary
// audit (additional, never a replacement). Case selection is bounded to
// org-scoped case ids server-side — any id outside the org aborts the whole
// write before a single row lands.
export async function bulkLogTouch(caseIds: string[], input: TouchInput): Promise<BulkTouchResult> {
  const orgId = requireActiveOrg();
  const uniqueIds = Array.from(new Set(caseIds));
  if (uniqueIds.length === 0) throw new Error("Select at least one case");

  // Org-bound the selection: every id must be a case in the active org.
  const { data: owned, error: ownErr } = await supabase
    .from("credential_cases")
    .select("id")
    .eq("org_id", orgId)
    .in("id", uniqueIds);
  if (ownErr) throw ownErr;
  const ownedIds = new Set((owned ?? []).map((r) => (r as { id: string }).id));
  const missing = uniqueIds.filter((id) => !ownedIds.has(id));
  if (missing.length > 0) {
    throw new Error("One or more selected cases are not in this organization");
  }

  const rows = uniqueIds.map((caseId) => touchpointRow(orgId, caseId, input));
  const { data, error } = await supabase
    .from("touches")
    .insert(rows as never)
    .select("*");
  if (error) throw error;
  const created = camelizeRow<Touch[]>(data ?? []);

  // One TOUCH_LOGGED audit per touch (TE-6).
  for (const t of created) {
    await writeAudit({
      actionType: "TOUCH_LOGGED",
      entityType: "touch",
      entityId: t.id,
      after: t,
      description: touchAuditDescription(t),
    });
  }
  // Additional batch summary (never a replacement for the per-touch rows).
  await writeAudit({
    actionType: "TOUCH_LOGGED",
    entityType: "touch_batch",
    entityId: null,
    after: { touchType: input.touchType, outcome: input.outcome ?? null, cases: created.length },
    description: `Bulk-logged ${input.touchType} touch across ${created.length} case${
      created.length === 1 ? "" : "s"
    }`,
  });

  return { created, caseIds: uniqueIds };
}

// Story 1: append a note entry to the touchlog, optionally task-linked. Content
// lives in `notes`; touch_type/outcome are null. touch_date is the entry date.
export async function logNote(caseId: string, input: NoteInput): Promise<Touch> {
  const orgId = requireActiveOrg();
  const payload = {
    entry_type: "note",
    org_id: orgId,
    case_id: caseId,
    task_id: input.taskId ?? null,
    touch_date: new Date().toISOString().slice(0, 10),
    notes: input.content,
    coordinator_id: currentUserId(),
    source: "manual",
  };
  const { data, error } = await supabase
    .from("touches")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<Touch>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "note",
    entityId: created.id,
    after: created,
    description: input.taskId ? "Added note to task" : "Added note to case",
  });
  return created;
}

// Story 1: the task detail view's filtered slice — every touchlog entry that
// references this task, newest first, with the author resolved for display.
export async function getTaskTouchlog(taskId: string): Promise<TouchlogEntry[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("touches")
    .select("id, entry_type, touch_type, outcome, notes, coordinator_id, created_at, touch_date")
    .eq("org_id", orgId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    entry_type: TouchEntryType;
    touch_type: TouchType | null;
    outcome: TouchOutcome | null;
    notes: string | null;
    coordinator_id: string | null;
    created_at: string;
    touch_date: string;
  }>;
  const authorIds = Array.from(
    new Set(rows.map((r) => r.coordinator_id).filter((v): v is string => Boolean(v))),
  );
  const nameMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", authorIds);
    if (profErr) throw profErr;
    for (const p of profs ?? []) {
      nameMap.set(p.id as string, (p.full_name as string | null) ?? (p.email as string | null));
    }
  }
  return rows.map((r) => ({
    id: r.id,
    entryType: r.entry_type,
    touchType: r.touch_type,
    outcome: r.outcome,
    content: r.notes,
    authorName: r.coordinator_id ? (nameMap.get(r.coordinator_id) ?? null) : null,
    createdAt: r.created_at,
    touchDate: r.touch_date,
  }));
}

// M5 (sanctioned, read-only): the latest touchpoint's next_follow_up_date per
// case, explicit columns, one query. Drives the Home "Follow-ups due" section.
export interface CaseFollowUp {
  caseId: string;
  touchDate: string;
  nextFollowUpDate: string | null;
  notes: string | null;
}

export async function getLatestTouchFollowUps(): Promise<Map<string, CaseFollowUp>> {
  const orgId = requireActiveOrg();
  // Read EVERY touchpoint per case — the active follow-up is resolved by the
  // carry-forward reducer (F4.1.2), not by taking the latest row's date. A
  // date-less touch carries the prior follow-up forward; only an explicit
  // clears_follow_up ends it.
  const { data, error } = await supabase
    .from("touches")
    .select("id, case_id, touch_date, created_at, next_follow_up_date, clears_follow_up, notes")
    .eq("org_id", orgId)
    .eq("entry_type", "touchpoint");
  if (error) throw error;

  const byCase = new Map<string, Array<FollowUpTouch & { notes: string | null }>>();
  for (const row of data ?? []) {
    const r = row as {
      id: string;
      case_id: string;
      touch_date: string;
      created_at: string | null;
      next_follow_up_date: string | null;
      clears_follow_up: boolean | null;
      notes: string | null;
    };
    const list = byCase.get(r.case_id) ?? [];
    list.push({
      id: r.id,
      touchDate: r.touch_date,
      createdAt: r.created_at ?? r.touch_date,
      nextFollowUpDate: r.next_follow_up_date,
      clearsFollowUp: r.clears_follow_up ?? false,
      notes: r.notes,
    });
    byCase.set(r.case_id, list);
  }

  // Every case with a touchpoint stays in the map — touchDate is the LATEST
  // touchpoint (the cadence clock input), while nextFollowUpDate is the
  // reducer-resolved ACTIVE follow-up (null when none is active). Dropping
  // no-follow-up cases would erase their last-touch date downstream.
  const result = new Map<string, CaseFollowUp>();
  for (const [caseId, touchpoints] of byCase) {
    const latest = touchpoints.reduce((a, b) => (b.touchDate > a.touchDate ? b : a));
    const resolved = resolveActiveFollowUp(touchpoints);
    const source = resolved ? touchpoints.find((t) => t.id === resolved.sourceTouchId) : undefined;
    result.set(caseId, {
      caseId,
      touchDate: latest.touchDate,
      nextFollowUpDate: resolved?.date ?? null,
      notes: (resolved ? (source?.notes ?? null) : latest.notes) ?? null,
    });
  }
  return result;
}

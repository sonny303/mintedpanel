// Touchlog: the single append-only case-activity spine. Every row is a `touches`
// entry discriminated by entry_type (touchpoint | note | system_event |
// task_update). Touchpoints carry a channel + outcome; the other kinds carry
// their text in `notes`. Reads filter by org; touchpoint inserts also write an
// audit_log row with action_type 'TOUCH_LOGGED', note inserts write a CREATE row.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import type { Touch, TouchEntryType, TouchOutcome, TouchType } from "@/types";

export interface TouchInput {
  touchDate: string;
  touchType: TouchType;
  outcome: TouchOutcome;
  nextFollowUpDate?: string | null;
  notes?: string | null;
  // Story 8: set when this touchpoint is one child of a batch payer call.
  communicationEventId?: string | null;
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
  const source = "manual" as const;
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    entry_type: "touchpoint",
    org_id: orgId,
    case_id: caseId,
    coordinator_id: currentUserId(),
    source,
  };
  const { data, error } = await supabase
    .from("touches")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<Touch>(data);
  await writeAudit({
    actionType: "TOUCH_LOGGED",
    entityType: "touch",
    entityId: created.id,
    after: created,
    description: `Logged ${created.touchType} touch (${created.outcome})`,
  });
  return created;
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
  const { data, error } = await supabase
    .from("touches")
    .select("case_id, touch_date, next_follow_up_date, notes")
    .eq("org_id", orgId)
    .eq("entry_type", "touchpoint")
    .order("touch_date", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, CaseFollowUp>();
  for (const row of data ?? []) {
    const r = row as {
      case_id: string;
      touch_date: string;
      next_follow_up_date: string | null;
      notes: string | null;
    };
    if (!latest.has(r.case_id)) {
      latest.set(r.case_id, {
        caseId: r.case_id,
        touchDate: r.touch_date,
        nextFollowUpDate: r.next_follow_up_date,
        notes: r.notes,
      });
    }
  }
  return latest;
}

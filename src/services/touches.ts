// Touches: append-only contact log per case. Reads filter by org; the insert
// also writes an audit_log row with action_type 'TOUCH_LOGGED'.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import type { Touch, TouchOutcome, TouchType } from "@/types";

export interface TouchInput {
  touchDate: string;
  touchType: TouchType;
  outcome: TouchOutcome;
  nextFollowUpDate?: string | null;
  notes?: string | null;
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

// Latest touch_date per case for the active org, as a Map keyed by case_id.
// One query — used by list views to compute "stalled" without N+1 fetches.
export async function getLastTouchDates(): Promise<Map<string, string>> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("touches")
    .select("case_id, touch_date")
    .eq("org_id", orgId)
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
    org_id: orgId,
    case_id: caseId,
    coordinator_id: source === "manual" ? currentUserId() : null,
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

// M5 (sanctioned, read-only): the latest touch's next_follow_up_date per case,
// explicit columns, one query. Drives the Home "Follow-ups due" section.
export interface CaseFollowUp {
  caseId: string;
  touchDate: string;
  nextFollowUpDate: string | null;
}

export async function getLatestTouchFollowUps(): Promise<Map<string, CaseFollowUp>> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("touches")
    .select("case_id, touch_date, next_follow_up_date")
    .eq("org_id", orgId)
    .order("touch_date", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, CaseFollowUp>();
  for (const row of data ?? []) {
    const r = row as { case_id: string; touch_date: string; next_follow_up_date: string | null };
    if (!latest.has(r.case_id)) {
      latest.set(r.case_id, {
        caseId: r.case_id,
        touchDate: r.touch_date,
        nextFollowUpDate: r.next_follow_up_date,
      });
    }
  }
  return latest;
}

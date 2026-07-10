// Tasks and SOP step completion. completeSOPStep enforces ordered completion:
// a step can only be marked complete when every lower-order step is done.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import { translateDbError } from "@/lib/dbErrors";
import type { SOPStep, Task, TaskStatus } from "@/types";

export interface CaseTaskInput {
  caseId: string;
  providerId: string;
  title: string;
  description: string | null;
  sopContent: unknown;
  sortOrder: number;
  dueDate: string | null;
}

export async function createTasksForCase(inputs: CaseTaskInput[]): Promise<Task[]> {
  if (inputs.length === 0) return [];
  const orgId = requireActiveOrg();
  const caseId = inputs[0].caseId;
  const payload = inputs.map((t) => ({
    org_id: orgId,
    case_id: t.caseId,
    provider_id: t.providerId,
    title: t.title,
    description: t.description,
    sop_content: t.sopContent as never,
    status: "not_started" as const,
    sort_order: t.sortOrder,
    due_date: t.dueDate,
    is_auto_generated: true,
  }));
  const { data, error } = await supabase
    .from("tasks")
    .insert(payload as never)
    .select("*");
  // E0.10: tasks_owner_check rejects ownerless tasks — surface it friendly.
  if (error) throw translateDbError(error);
  const created = camelizeRow<Task[]>(data ?? []);
  await writeAudit({
    actionType: "CREATE",
    entityType: "task",
    entityId: caseId,
    after: { caseId, count: created.length, taskIds: created.map((t) => t.id) },
    description: `Auto-generated ${created.length} SOP task${created.length === 1 ? "" : "s"} for case`,
  });
  return created;
}

// A single follow-up task, created when a Fix-it card is skipped. Distinct from
// the SOP auto-generation path (createTasksForCase) — this is a human deferring
// one piece of data collection, audited as such.
export interface FollowUpTaskInput {
  caseId: string;
  providerId: string;
  title: string;
  dueDate: string | null;
}

export async function createFollowUpTask(input: FollowUpTaskInput): Promise<Task> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      org_id: orgId,
      case_id: input.caseId,
      provider_id: input.providerId,
      title: input.title,
      description: null,
      status: "not_started" as const,
      sort_order: 100,
      due_date: input.dueDate,
      is_auto_generated: false,
    } as never)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const task = camelizeRow<Task>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "task",
    entityId: task.id,
    after: { caseId: input.caseId, title: input.title, dueDate: input.dueDate },
    description: `Follow-up task created: ${input.title}`,
  });
  return task;
}

export interface TaskFilters {
  caseId?: string;
  status?: TaskStatus;
  dueBefore?: string;
  assignedTo?: string;
}

const TASK_LIST_COLUMNS =
  "id, case_id, provider_id, title, status, sort_order, due_date, completed_date, is_auto_generated, created_at, updated_at";

export async function getTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from("tasks")
    .select(TASK_LIST_COLUMNS)
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });
  if (filters.caseId) query = query.eq("case_id", filters.caseId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.dueBefore) query = query.lte("due_date", filters.dueBefore);
  // assignedTo isn't on tasks today; filter via cases when requested.
  if (filters.assignedTo) {
    const { data: caseRows, error: caseErr } = await supabase
      .from("credential_cases")
      .select("id")
      .eq("org_id", orgId)
      .eq("assigned_to", filters.assignedTo);
    if (caseErr) throw caseErr;
    const ids = (caseRows ?? []).map((r) => r.id as string);
    query = query.in("case_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<Task[]>(data ?? []);
}

export async function getTask(id: string): Promise<Task | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Task>(data) : null;
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  const orgId = requireActiveOrg();
  const before = await getTask(id);
  const patch: Record<string, unknown> = { status };
  if (status === "completed") {
    patch.completed_date = new Date().toISOString().slice(0, 10);
  } else {
    patch.completed_date = null;
  }
  const { data, error } = await supabase
    .from("tasks")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<Task>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "task",
    entityId: id,
    before: { status: before?.status ?? null },
    after: { status: after.status },
    description: `Task status set to ${after.status}`,
  });
  return after;
}

export async function completeSOPStep(taskId: string, stepId: string): Promise<Task> {
  const orgId = requireActiveOrg();
  const existing = await getTask(taskId);
  if (!existing) throw new Error("Task not found");

  const currentSteps: SOPStep[] = Array.isArray(existing.sopContent) ? existing.sopContent : [];

  const target = currentSteps.find((step) => step.id === stepId);
  if (!target) throw new Error("Step not found on task");

  const blocker = currentSteps.find((step) => step.order < target.order && !step.isCompleted);
  if (blocker) {
    throw new Error(`Complete "${blocker.label}" first`);
  }

  const userId = currentUserId();
  const now = new Date().toISOString();
  const nextSteps: SOPStep[] = currentSteps.map((step) =>
    step.id === stepId
      ? { ...step, isCompleted: true, completedAt: now, completedBy: userId }
      : step,
  );

  const allDone = nextSteps.every((s) => s.isCompleted);
  const patch: Record<string, unknown> = {
    sop_content: nextSteps as unknown as never,
  };
  if (allDone) {
    patch.status = "completed";
    patch.completed_date = now.slice(0, 10);
  } else if (existing.status === "not_started") {
    patch.status = "in_progress";
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(patch as never)
    .eq("id", taskId)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<Task>(data);

  if (allDone && after.caseId && after.title.toLowerCase().startsWith("submit termination")) {
    const { error: termErr } = await supabase
      .from("credential_cases")
      .update({ termination_date: now.slice(0, 10) } as never)
      .eq("id", after.caseId)
      .eq("org_id", orgId)
      .is("termination_date", null);
    if (termErr) throw termErr;
  }

  await writeAudit({
    actionType: "UPDATE",
    entityType: "task",
    entityId: taskId,
    before: { stepId, isCompleted: false },
    after: { stepId, isCompleted: true, taskStatus: after.status },
    description: `Completed SOP step "${target.label}"`,
  });
  return after;
}

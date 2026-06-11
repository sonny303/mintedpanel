// Tasks and SOP step completion. completeSOPStep enforces ordered completion:
// a step can only be marked complete when every lower-order step is done.
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow } from '@/lib/case';
import { currentUserId, requireActiveOrg, writeAudit } from '@/lib/audit';
import type { SOPStep, Task, TaskStatus } from '@/types';

export interface TaskFilters {
  caseId?: string;
  status?: TaskStatus;
  dueBefore?: string;
  assignedTo?: string;
}

export async function getTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from('tasks')
    .select('*')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true });
  if (filters.caseId) query = query.eq('case_id', filters.caseId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.dueBefore) query = query.lte('due_date', filters.dueBefore);
  // assignedTo isn't on tasks today; filter via cases when requested.
  if (filters.assignedTo) {
    const { data: caseRows } = await supabase
      .from('credential_cases')
      .select('id')
      .eq('org_id', orgId)
      .eq('assigned_to', filters.assignedTo);
    const ids = (caseRows ?? []).map((r) => r.id as string);
    query = query.in('case_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<Task[]>(data ?? []);
}

export async function getTask(id: string): Promise<Task | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Task>(data) : null;
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  const orgId = requireActiveOrg();
  const before = await getTask(id);
  const patch: Record<string, unknown> = { status };
  if (status === 'completed') patch.completed_date = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('tasks')
    .update(patch as never)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  const after = camelizeRow<Task>(data);
  await writeAudit({
    actionType: 'UPDATE',
    entityType: 'task',
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
  if (!existing) throw new Error('Task not found');

  const target = existing.sopContent.find((step) => step.id === stepId);
  if (!target) throw new Error('Step not found on task');

  const blocker = existing.sopContent.find(
    (step) => step.order < target.order && !step.isCompleted,
  );
  if (blocker) {
    throw new Error(`Complete "${blocker.label}" first`);
  }

  const userId = currentUserId();
  const now = new Date().toISOString();
  const nextSteps: SOPStep[] = existing.sopContent.map((step) =>
    step.id === stepId
      ? { ...step, isCompleted: true, completedAt: now, completedBy: userId }
      : step,
  );
  const allDone = nextSteps.every((s) => s.isCompleted);
  const patch: Record<string, unknown> = {
    sop_content: nextSteps as unknown as never,
  };
  if (allDone) {
    patch.status = 'completed';
    patch.completed_date = now.slice(0, 10);
  } else if (existing.status === 'not_started') {
    patch.status = 'in_progress';
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(patch as never)
    .eq('id', taskId)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  const after = camelizeRow<Task>(data);
  await writeAudit({
    actionType: 'UPDATE',
    entityType: 'task',
    entityId: taskId,
    before: { stepId, isCompleted: false },
    after: { stepId, isCompleted: true, taskStatus: after.status },
    description: `Completed SOP step "${target.label}"`,
  });
  return after;
}

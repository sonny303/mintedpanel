// Tasks hooks: list/get, status mutation, and SOP step completion mutation.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrgId } from '@/lib/auth-store';
import { queryKeys } from '@/hooks/queryKeys';
import {
  completeSOPStep,
  getTask,
  getTasks,
  updateTaskStatus,
  type TaskFilters,
} from '@/services/tasks';
import type { TaskStatus } from '@/types';

export function useTasks(filters: TaskFilters = {}) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.tasks(orgId, filters),
    queryFn: () => getTasks(filters),
    enabled: orgId !== 'no-org',
  });
}

export function useTask(id: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.task(orgId, id ?? ''),
    queryFn: () => getTask(id as string),
    enabled: orgId !== 'no-org' && Boolean(id),
  });
}

export interface UpdateTaskStatusVars {
  id: string;
  status: TaskStatus;
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (vars: UpdateTaskStatusVars) => updateTaskStatus(vars.id, vars.status),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks', orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.id) });
      qc.invalidateQueries({ queryKey: ['case', orgId] });
      qc.invalidateQueries({ queryKey: ['audit-log', orgId] });
    },
  });
}

export interface CompleteSOPStepVars {
  taskId: string;
  stepId: string;
}

export function useCompleteSOPStep() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (vars: CompleteSOPStepVars) => completeSOPStep(vars.taskId, vars.stepId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks', orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.taskId) });
      qc.invalidateQueries({ queryKey: ['audit-log', orgId] });
    },
  });
}

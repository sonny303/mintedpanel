// Tasks hooks: list/get, status mutation, and SOP step completion mutation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  completeSOPStep,
  createFollowUpTask,
  getTask,
  getTasks,
  updateTaskStatus,
  type FollowUpTaskInput,
  type TaskFilters,
} from "@/services/tasks";
import type { TaskStatus } from "@/types";

const THIRTY_SECONDS = 30_000;

// E4.0 F4.0.4 — the RFI→task bridge spawns an internal case task through the
// existing follow-up-task machinery. Invalidates tasks + the case detail.
export function useCreateFollowUpTask() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: FollowUpTaskInput) => createFollowUpTask(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, input.caseId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export function useTasks(filters: TaskFilters = {}) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.tasks(orgId, filters),
    queryFn: () => getTasks(filters),
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

export function useTask(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.task(orgId, id ?? ""),
    queryFn: () => getTask(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
    staleTime: THIRTY_SECONDS,
  });
}

export interface UpdateTaskStatusVars {
  id: string;
  status: TaskStatus;
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: UpdateTaskStatusVars) => updateTaskStatus(vars.id, vars.status),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.id) });
      qc.invalidateQueries({ queryKey: ["case", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export interface CompleteSOPStepVars {
  taskId: string;
  stepId: string;
}

export function useCompleteSOPStep() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: CompleteSOPStepVars) => completeSOPStep(vars.taskId, vars.stepId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.taskId) });
      qc.invalidateQueries({ queryKey: ["case", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

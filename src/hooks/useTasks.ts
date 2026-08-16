// Tasks hooks: list/get, status mutation, and SOP step completion mutation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  attachStepArtifact,
  completeSOPStep,
  createFollowUpTask,
  createProviderOutreachTask,
  detachStepArtifact,
  getTask,
  getTasks,
  updateTaskStatus,
  type FollowUpTaskInput,
  type ProviderOutreachTaskInput,
  type TaskFilters,
} from "@/services/tasks";
import type { SOPStepAttachment, TaskStatus } from "@/types";

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

// E4.2 F4.2.6 — spawn a provider-outreach task from the generation preview.
export function useCreateProviderOutreachTask() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: ProviderOutreachTaskInput) => createProviderOutreachTask(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
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

// TS-163 — step artifact attach/detach. The document itself is written
// separately (useUploadDocument, the E4.5 signing boundary); these mutations
// only link/unlink the resulting documentId onto the step's sop_content.
// Invalidates the documents prefix too — a promoted (vault) attachment
// changes what the provider/group DocumentsPanel and readiness derivations
// see, same as useUploadDocument's own invalidation list.
export interface AttachStepArtifactVars {
  taskId: string;
  stepId: string;
  attachment: SOPStepAttachment;
}

export function useAttachStepArtifact() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: AttachStepArtifactVars) =>
      attachStepArtifact(vars.taskId, vars.stepId, vars.attachment),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.taskId) });
      qc.invalidateQueries({ queryKey: ["case", orgId] });
      qc.invalidateQueries({ queryKey: ["documents", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export interface DetachStepArtifactVars {
  taskId: string;
  stepId: string;
  documentId: string;
}

export function useDetachStepArtifact() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: DetachStepArtifactVars) =>
      detachStepArtifact(vars.taskId, vars.stepId, vars.documentId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.taskId) });
      qc.invalidateQueries({ queryKey: ["case", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

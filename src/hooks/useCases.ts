// Cases query hooks including the joined detail view, contract lookup, and
// credentialing-track status mutation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  advancePayerPipeline,
  appendCaseTasks,
  createCase,
  getCase,
  getCases,
  getContractFor,
  listDenialReasonCodes,
  setPayerReference,
  updateCaseStatus,
  type AdvancePipelineInput,
  type CaseFilters,
  type CaseInput,
  type CaseTaskPayload,
} from "@/services/cases";

const THIRTY_SECONDS = 30_000;
const FIVE_MINUTES = 300_000;

export function useCases(filters: CaseFilters = {}) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.cases(orgId, filters),
    queryFn: () => getCases(filters),
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

export function useCase(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.case(orgId, id ?? ""),
    queryFn: () => getCase(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
    staleTime: THIRTY_SECONDS,
  });
}

export function useContractFor(
  groupId: string | undefined,
  payerId: string | undefined,
  state: string | undefined,
) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.contract(orgId, { groupId, payerId, state }),
    queryFn: () => getContractFor(groupId as string, payerId as string, state as string),
    enabled: orgId !== "no-org" && Boolean(groupId && payerId && state),
    staleTime: THIRTY_SECONDS,
  });
}

export interface CreateCaseVars {
  input: CaseInput;
  tasks?: CaseTaskPayload[];
}

export function useCreateCase() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: CreateCaseVars) => createCase(vars.input, vars.tasks ?? []),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export interface SetPayerReferenceVars {
  caseId: string;
  value: string | null;
}

// Story 2: overwrite the case's payer reference / submission ID (latest wins).
export function useSetPayerReference() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: SetPayerReferenceVars) => setPayerReference(vars.caseId, vars.value),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, vars.caseId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

// E2.1 F2.1.3 — reapplication after a denial: a status transition (Denied →
// In Progress, recorded in status_history by the existing updateCaseStatus
// path) plus the restamped task set appended to the SAME case. Never a second
// case at the key; the case keeps its full touches/status history.
export interface ReapplyCaseVars {
  caseId: string;
  /** The org's In Progress credentialing status id ([r4-review] Q6). */
  statusId: string;
  /** Tasks resolved from the CURRENT SOP version (Model A: new work gets
   * latest), sort-ordered after the case's existing tasks. */
  tasks: CaseTaskPayload[];
}

export function useReapplyCase() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: async (vars: ReapplyCaseVars) => {
      // Metadata keys become UPDATE columns in updateCaseStatus — pass none.
      // The reapplication trace is the appendCaseTasks audit row plus the
      // Denied → In Progress status_history entry this call writes.
      await updateCaseStatus(vars.caseId, vars.statusId, {});
      await appendCaseTasks(vars.caseId, vars.tasks);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, vars.caseId) });
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

// E4.0 F4.0.1 — advance the payer pipeline through the atomic RPC. Invalidates
// the case detail (state + timeline), the cases list (badge), and the audit log.
export function useAdvancePayerPipeline() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: AdvancePipelineInput) => advancePayerPipeline(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, input.caseId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

// E4.0 TE-4 — global + own-org active reason codes; long-lived (governance data).
export function useDenialReasonCodes() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.denialReasonCodes(orgId),
    queryFn: () => listDenialReasonCodes(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export interface UpdateCaseStatusVars {
  caseId: string;
  statusId: string;
  metadata?: Record<string, unknown>;
}

export function useUpdateCaseStatus() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: UpdateCaseStatusVars) =>
      updateCaseStatus(vars.caseId, vars.statusId, vars.metadata ?? {}),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, vars.caseId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

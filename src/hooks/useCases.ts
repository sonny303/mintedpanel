// Cases query hooks including the joined detail view, contract lookup, and
// the E6.0 unified-status mutation (the ONE user-facing status machine).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  appendCaseTasks,
  createCase,
  getCase,
  getCases,
  getContractFor,
  listCaseDenialEntries,
  listDenialReasonCodes,
  setCaseFacility,
  setCaseStatus,
  setPayerReference,
  type CaseFilters,
  type CaseInput,
  type CaseTaskPayload,
  type SetCaseStatusInput,
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

export interface SetCaseFacilityVars {
  caseId: string;
  facilityId: string | null;
}

/** Overwrite the case's facility (provider×group assignment scoped). */
export function useSetCaseFacility() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: SetCaseFacilityVars) => setCaseFacility(vars.caseId, vars.facilityId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, vars.caseId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

// E6.0 — the single unified-status transition entry point (set_case_status).
// Invalidates the case detail (status + timeline), the cases list (pill), the
// touch log (evidence links), and the audit log.
export function useSetCaseStatus() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: SetCaseStatusInput) => setCaseStatus(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, input.caseId) });
      qc.invalidateQueries({ queryKey: ["touches", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

// E2.1 F2.1.3 / E6.0 — reapplication after a denial: the SAME case returns to
// In Progress (the denied → in_progress reapply edge through set_case_status —
// unified history + audit in one transaction) plus the restamped task set
// appended. Never a second case at the key; the prior denial stays visible in
// the case's history.
export interface ReapplyCaseVars {
  caseId: string;
  /** Tasks resolved from the CURRENT SOP version (Model A: new work gets
   * latest), sort-ordered after the case's existing tasks. */
  tasks: CaseTaskPayload[];
}

export function useReapplyCase() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: async (vars: ReapplyCaseVars) => {
      await setCaseStatus({
        caseId: vars.caseId,
        toStatus: "in_progress",
        expectedStatus: "denied",
      });
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

// E4.0 TE-4 — global + own-org active reason codes; long-lived (governance
// data). Since E6.0 these back the unified Denied dialog's required reason.
export function useDenialReasonCodes() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.denialReasonCodes(orgId),
    queryFn: () => listDenialReasonCodes(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

// E6.2 F6.2.3 — the board drill-down's denial history. Rides the "cases"
// prefix (queryKeys.caseDenialEntries) so every set_case_status invalidation
// re-derives it alongside the list pills.
export function useCaseDenialEntries() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.caseDenialEntries(orgId),
    queryFn: () => listCaseDenialEntries(),
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

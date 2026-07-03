// Cases query hooks including the joined detail view, contract lookup, and
// credentialing-track status mutation.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrgId } from '@/lib/auth-store';
import { queryKeys, FIVE_MINUTES } from '@/hooks/queryKeys';
import {
  createCase,
  getCase,
  getCases,
  getContractFor,
  updateCaseStatus,
  type CaseFilters,
  type CaseInput,
  type CaseTaskPayload,
} from '@/services/cases';

const THIRTY_SECONDS = 30_000;
void FIVE_MINUTES;

export function useCases(filters: CaseFilters = {}) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.cases(orgId, filters),
    queryFn: () => getCases(filters),
    enabled: orgId !== 'no-org',
    staleTime: THIRTY_SECONDS,
  });
}

export function useCase(id: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.case(orgId, id ?? ''),
    queryFn: () => getCase(id as string),
    enabled: orgId !== 'no-org' && Boolean(id),
    staleTime: THIRTY_SECONDS,
  });
}

export function useContractFor(
  groupId: string | undefined,
  payerId: string | undefined,
  state: string | undefined,
) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.contract(orgId, { groupId, payerId, state }),
    queryFn: () => getContractFor(groupId as string, payerId as string, state as string),
    enabled: orgId !== 'no-org' && Boolean(groupId && payerId && state),
    staleTime: THIRTY_SECONDS,
  });
}

export interface CreateCaseVars {
  input: CaseInput;
  tasks?: CaseTaskPayload[];
}

export function useCreateCase() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (vars: CreateCaseVars) => createCase(vars.input, vars.tasks ?? []),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases', orgId] });
      qc.invalidateQueries({ queryKey: ['tasks', orgId] });
      qc.invalidateQueries({ queryKey: ['audit-log', orgId] });
    },
  });
}

export interface UpdateCaseStatusVars {
  caseId: string;
  statusId: string;
  metadata?: Record<string, unknown>;
}

export function useUpdateCaseStatus() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (vars: UpdateCaseStatusVars) =>
      updateCaseStatus(vars.caseId, vars.statusId, vars.metadata ?? {}),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['cases', orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, vars.caseId) });
      qc.invalidateQueries({ queryKey: ['audit-log', orgId] });
    },
  });
}

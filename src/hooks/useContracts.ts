// Contracts hooks.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  createContract,
  getContract,
  listContracts,
  updateContractStatus,
  type ContractFilters,
  type ContractInput,
} from "@/services/contracts";

const THIRTY_SECONDS = 30_000;

export function useContracts(filters: ContractFilters = {}) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.contracts(orgId, filters),
    queryFn: () => listContracts(filters),
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

export function useContract(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.contract(orgId, id ?? ""),
    queryFn: () => getContract(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
    staleTime: THIRTY_SECONDS,
  });
}

export function useCreateContract() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: ContractInput) => createContract(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts", orgId] });
      qc.invalidateQueries({ queryKey: ["contract", orgId] });
    },
  });
}

export interface UpdateContractStatusVars {
  contractId: string;
  statusId: string;
  metadata?: Record<string, unknown>;
}

export function useUpdateContractStatus() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: UpdateContractStatusVars) =>
      updateContractStatus(vars.contractId, vars.statusId, vars.metadata ?? {}),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["contracts", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.contract(orgId, vars.contractId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/externalClient";
import { useActiveOrgId } from "@/lib/auth-store";
import {
  assignContractSop,
  getContractSopAssignment,
  listContractProviderIds,
  type AssignContractSopInput,
} from "@/services/contractSopAssignments";

export function useContractSopAssignment(contractId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: ["contract-sop-assignment", orgId, contractId ?? ""],
    queryFn: () => getContractSopAssignment({ db: supabase, orgId }, contractId as string),
    enabled: orgId !== "no-org" && Boolean(contractId),
  });
}

export function useContractProviderIds(groupId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: ["contract-provider-ids", orgId, groupId ?? ""],
    queryFn: () => listContractProviderIds({ db: supabase, orgId }, groupId as string),
    enabled: orgId !== "no-org" && Boolean(groupId),
    staleTime: 30_000,
  });
}

export function useAssignContractSop() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: AssignContractSopInput) =>
      assignContractSop({ db: supabase, orgId }, input),
    onSuccess: (_assignment, input) => {
      void qc.invalidateQueries({
        queryKey: ["contract-sop-assignment", orgId, input.contractId],
      });
      void qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

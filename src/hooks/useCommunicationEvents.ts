// Story 8 hooks: payer-scoped case source for the batch touchpoint dialog and the
// batch-log mutation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import {
  getCasesForPayer,
  logBatchTouchpoint,
  type BatchTouchpointInput,
} from "@/services/communicationEvents";

export function useCasesForPayer(payerId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: ["cases-for-payer", orgId, payerId ?? ""] as const,
    queryFn: () => getCasesForPayer(payerId as string),
    enabled: orgId !== "no-org" && Boolean(payerId),
  });
}

export function useLogBatchTouchpoint() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: BatchTouchpointInput) => logBatchTouchpoint(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["touches", orgId] });
      qc.invalidateQueries({ queryKey: ["case", orgId] });
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

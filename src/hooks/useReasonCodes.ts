// E4.2 F4.2.3 — reason-code vocabulary management hooks. The dropdown reader
// (active only) stays `useDenialReasonCodes` in useCases.ts; these manage the
// full vocabulary (add org code, deactivate/reactivate) and invalidate BOTH
// the management list and the dropdown list on write.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  createDenialReasonCode,
  listAllDenialReasonCodes,
  setDenialReasonCodeActive,
  type DenialReasonCodeInput,
} from "@/services/denialReasonCodes";

export function useAllDenialReasonCodes() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.allDenialReasonCodes(orgId),
    queryFn: listAllDenialReasonCodes,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

function useInvalidateReasonCodes() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.allDenialReasonCodes(orgId) });
    qc.invalidateQueries({ queryKey: queryKeys.denialReasonCodes(orgId) });
  };
}

export function useCreateDenialReasonCode() {
  const invalidate = useInvalidateReasonCodes();
  return useMutation({
    mutationFn: (input: DenialReasonCodeInput) => createDenialReasonCode(input),
    onSuccess: invalidate,
  });
}

export interface SetReasonActiveVars {
  id: string;
  active: boolean;
}

export function useSetDenialReasonCodeActive() {
  const invalidate = useInvalidateReasonCodes();
  return useMutation({
    mutationFn: (vars: SetReasonActiveVars) => setDenialReasonCodeActive(vars.id, vars.active),
    onSuccess: invalidate,
  });
}

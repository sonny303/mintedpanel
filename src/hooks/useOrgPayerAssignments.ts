// Org-payer assignment query + starter-flag mutation. The assignment list is
// org-scoped (queryKeys.orgPayerAssignments); the starter mutation invalidates
// that key so the Admin > Payers toggle and the starter-pack derivation both
// see the fresh flag.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { listAssignments, setStarter } from "@/services/orgPayerAssignments";

export function useOrgPayerAssignments() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.orgPayerAssignments(orgId),
    queryFn: listAssignments,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export interface SetStarterVars {
  payerId: string;
  starter: boolean;
}

export function useSetStarter() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: SetStarterVars) => setStarter(vars.payerId, vars.starter),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgPayerAssignments(orgId) }),
  });
}

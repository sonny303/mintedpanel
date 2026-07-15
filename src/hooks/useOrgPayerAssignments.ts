// Org-payer assignment query + lifecycle mutations. The assignment list is
// org-scoped (queryKeys.orgPayerAssignments). add/archive/reactivate change what
// the org subscribes to, which drives the E1.5 curated attach shortlist (payers
// + assignments), the group×state targets (archive cascades to them), and —
// because those are the SOURCE caches the readiness (usePayerReadiness) and
// generation-preview (useGenerationPreview) surfaces COMPOSE — those derived
// views re-derive automatically once the sources refetch. So the shared
// invalidator hits the source families (assignment / payer / catalog / target);
// the composed hooks re-derive with no dedicated key to invalidate.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  addAssignment,
  archiveAssignment,
  listAssignments,
  reactivateAssignment,
  setStarter,
} from "@/services/orgPayerAssignments";

export function useOrgPayerAssignments() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.orgPayerAssignments(orgId),
    queryFn: listAssignments,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

function useInvalidateAssignmentFamilies() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.orgPayerAssignments(orgId) });
    // Adding a global payer makes it visible to listPayers (assigned-global);
    // both the org-scoped payer list and the cross-org catalog card state move.
    void qc.invalidateQueries({ queryKey: queryKeys.payers(orgId) });
    void qc.invalidateQueries({ queryKey: queryKeys.payerCatalog() });
    // Archive cascades to targets; readiness + generation preview compose this.
    void qc.invalidateQueries({ queryKey: queryKeys.payerNetworkTargets(orgId) });
  };
}

export function useAddAssignment() {
  const invalidate = useInvalidateAssignmentFamilies();
  return useMutation({
    mutationFn: (payerId: string) => addAssignment(payerId),
    onSuccess: invalidate,
  });
}

export function useArchiveAssignment() {
  const invalidate = useInvalidateAssignmentFamilies();
  return useMutation({
    mutationFn: (payerId: string) => archiveAssignment(payerId),
    onSuccess: invalidate,
  });
}

export function useReactivateAssignment() {
  const invalidate = useInvalidateAssignmentFamilies();
  return useMutation({
    mutationFn: (payerId: string) => reactivateAssignment(payerId),
    onSuccess: invalidate,
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

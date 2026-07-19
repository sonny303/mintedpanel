// E1.5 — payer network target reads + attach/archive/restore mutations.
// One org-scoped key (queryKeys.payerNetworkTargets); every mutation
// invalidates it so the wizard section, the attach dialog's "already
// attached" filter, and the derived progress chip all stay in step.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  archivePayerTargets,
  archiveTarget,
  attachGroupPayer,
  attachPayerTargets,
  listPayerNetworkTargets,
  removeGroupPayer,
  restoreTarget,
} from "@/services/payerNetworkTargets";
import type { AttachmentSavePlan } from "@/lib/payerExpansion";

export function usePayerNetworkTargets() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.payerNetworkTargets(orgId),
    queryFn: listPayerNetworkTargets,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

function useInvalidateTargets() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return () => qc.invalidateQueries({ queryKey: queryKeys.payerNetworkTargets(orgId) });
}

export interface AttachPayerVars {
  payerId: string;
  plan: AttachmentSavePlan;
}

export function useAttachPayerTargets() {
  const invalidate = useInvalidateTargets();
  return useMutation({
    mutationFn: (vars: AttachPayerVars) => attachPayerTargets(vars.payerId, vars.plan),
    onSuccess: invalidate,
  });
}

export function useArchiveTarget() {
  const invalidate = useInvalidateTargets();
  return useMutation({
    mutationFn: (id: string) => archiveTarget(id),
    onSuccess: invalidate,
  });
}

export function useRestoreTarget() {
  const invalidate = useInvalidateTargets();
  return useMutation({
    mutationFn: (id: string) => restoreTarget(id),
    onSuccess: invalidate,
  });
}

export function useArchivePayerTargets() {
  const invalidate = useInvalidateTargets();
  return useMutation({
    mutationFn: (payerId: string) => archivePayerTargets(payerId),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// E6.2 F6.2.4 — group-basis attach/remove with implicit org enablement. These
// touch the assignment layer too, so they invalidate the assignment/payer
// families the readiness + setup surfaces compose (the useAddAssignment set)
// on top of the targets key.
// ---------------------------------------------------------------------------

function useInvalidateAttachFamilies() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.payerNetworkTargets(orgId) });
    qc.invalidateQueries({ queryKey: queryKeys.orgPayerAssignments(orgId) });
    qc.invalidateQueries({ queryKey: queryKeys.payers(orgId) });
    qc.invalidateQueries({ queryKey: queryKeys.payerCatalog() });
    qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
  };
}

export function useAttachGroupPayer() {
  const invalidate = useInvalidateAttachFamilies();
  return useMutation({
    mutationFn: (vars: AttachPayerVars) => attachGroupPayer(vars.payerId, vars.plan),
    onSuccess: invalidate,
  });
}

export function useRemoveGroupPayer() {
  const invalidate = useInvalidateAttachFamilies();
  return useMutation({
    mutationFn: (vars: { groupId: string; payerId: string }) =>
      removeGroupPayer(vars.groupId, vars.payerId),
    onSuccess: invalidate,
  });
}

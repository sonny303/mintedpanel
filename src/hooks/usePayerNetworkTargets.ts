// Payer network attachment targets (redesign E1.5). One org-scoped query for
// all target rows (active + archived — the section derives its views and the
// wizard chip from the same cache) plus the attach/archive/restore mutations,
// all invalidating the same key so the chip, the attached list, and the
// archived view stay in step.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  archivePayerTargets,
  archiveTarget,
  attachTargets,
  listTargets,
  restoreTarget,
  type AttachTargetsInput,
} from "@/services/payerNetworkTargets";

export function usePayerNetworkTargets() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.payerNetworkTargets(orgId),
    queryFn: listTargets,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

function useInvalidateTargets() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return () => qc.invalidateQueries({ queryKey: queryKeys.payerNetworkTargets(orgId) });
}

export function useAttachTargets() {
  const invalidate = useInvalidateTargets();
  return useMutation({
    mutationFn: (input: AttachTargetsInput) => attachTargets(input),
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

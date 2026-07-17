// Reporting Center hooks (redesign E0.6). Cross-org: the keys are NOT org-scoped
// (the Reporting Center renders without an active org). Share mutations invalidate
// the per-report share list.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";
import { listPortfolioOrgStates } from "@/services/reporting";
import {
  createReportShare,
  listReportShares,
  revokeReportShare,
  type CreateReportShareInput,
} from "@/services/reportShares";

export function usePortfolioOrgStates() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: queryKeys.orgStates(),
    queryFn: listPortfolioOrgStates,
    enabled: Boolean(session),
    staleTime: FIVE_MINUTES,
  });
}

export function useReportShares(reportKey: string) {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: queryKeys.reportShares(reportKey),
    queryFn: () => listReportShares(reportKey),
    enabled: Boolean(session),
  });
}

export function useCreateReportShare(reportKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportShareInput) => createReportShare(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reportShares(reportKey) }),
  });
}

export function useRevokeReportShare(reportKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeReportShare(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reportShares(reportKey) }),
  });
}

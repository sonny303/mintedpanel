// Provider Onboarding funnel hook (RC-06). Org-scoped; the stage derivation
// runs on the cached read with today's local date. The report refetches every
// time it opens. Case creation also marks the key stale (not awaited); it is
// deliberately NOT in the roster cache set, whose awaited "all" refetch would
// make every provider write wait on this five-table read.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { useActiveOrgId } from "@/lib/auth-store";
import { buildOnboardingFunnelRows } from "@/lib/onboardingFunnel";
import { getOnboardingFunnelInput } from "@/services/onboardingFunnel";

export function useOnboardingFunnel() {
  const orgId = useActiveOrgId();
  const query = useQuery({
    queryKey: queryKeys.onboardingFunnel(orgId ?? "no-org"),
    queryFn: getOnboardingFunnelInput,
    enabled: Boolean(orgId),
    staleTime: FIVE_MINUTES,
    refetchOnMount: "always",
  });
  const rows = useMemo(
    () => (query.data ? buildOnboardingFunnelRows(query.data, localTodayIso()) : undefined),
    [query.data],
  );
  return {
    orgId,
    rows,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

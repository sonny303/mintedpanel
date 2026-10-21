// Provider Onboarding funnel hook (RC-06). Org-scoped; the stage derivation
// runs on the cached read with today's local date.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { useActiveOrgId } from "@/lib/auth-store";
import { buildOnboardingRows } from "@/lib/providerOnboarding";
import { getProviderOnboardingInput } from "@/services/providerOnboarding";

export function useProviderOnboarding() {
  const orgId = useActiveOrgId();
  const query = useQuery({
    queryKey: queryKeys.providerOnboarding(orgId ?? "no-org"),
    queryFn: getProviderOnboardingInput,
    enabled: Boolean(orgId),
    staleTime: FIVE_MINUTES,
  });
  const rows = useMemo(
    () => (query.data ? buildOnboardingRows(query.data, localTodayIso()) : undefined),
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

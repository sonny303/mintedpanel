// 2026-10-20 — TanStack Query wrapper for the Provider Onboarding report.
import { useQuery } from "@tanstack/react-query";
import { getProviderOnboardingReport } from "@/services/onboardingReport";
import type { ProviderOnboardingReport } from "@/types";

export function useProviderOnboardingReport(
  orgId: string | undefined,
  filters: { groupId?: string; locationId?: string } = {},
) {
  return useQuery<ProviderOnboardingReport>({
    queryKey: ["provider-onboarding-report", orgId, filters.groupId ?? null, filters.locationId ?? null],
    queryFn: () => getProviderOnboardingReport(orgId ?? "", filters),
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
}

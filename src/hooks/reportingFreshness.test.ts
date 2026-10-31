// The Provider Onboarding funnel and the Portfolio footprint must not serve a
// five-minute-old cache after an edit: the app turns refetchOnWindowFocus off,
// so these reports refetch on open, and case creation (one case, or a
// generation batch) marks the funnel stale. The funnel stays out of the
// awaited roster cache set.
import { describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  useQuery: vi.fn((options: unknown) => ({ options, data: undefined })),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQuery: holder.useQuery,
  useQueryClient: () => ({ invalidateQueries: holder.invalidateQueries }),
}));
vi.mock("@/lib/auth-store", () => ({
  useActiveOrgId: () => "org-1",
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ session: { user: { id: "user-1" } } }),
}));
vi.mock("@/services/onboardingFunnel", () => ({ getOnboardingFunnelInput: vi.fn() }));
vi.mock("@/services/reporting", () => ({ listPortfolioFootprint: vi.fn() }));
vi.mock("@/services/reportShares", () => ({
  createReportShare: vi.fn(),
  listReportShares: vi.fn(),
  revokeReportShare: vi.fn(),
}));
vi.mock("@/services/cases", () => ({}));
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { queryKeys } from "@/hooks/queryKeys";
import { useCreateCase } from "@/hooks/useCases";
import { useConfirmGeneration } from "@/hooks/useGenerationPreview";
import { useOnboardingFunnel } from "@/hooks/useOnboardingFunnel";
import { usePortfolioFootprint } from "@/hooks/useReporting";
import { providerRosterCacheKeys } from "@/lib/providerRosterCaches";

function lastQueryOptions(): Record<string, unknown> {
  const call = holder.useQuery.mock.calls.at(-1);
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

describe("reporting freshness", () => {
  it("refetches the onboarding funnel every time the report opens", () => {
    useOnboardingFunnel();
    expect(lastQueryOptions()).toMatchObject({
      queryKey: queryKeys.onboardingFunnel("org-1"),
      refetchOnMount: "always",
    });
  });

  it("refetches the portfolio footprint every time the report opens", () => {
    usePortfolioFootprint();
    expect(lastQueryOptions()).toMatchObject({
      queryKey: queryKeys.portfolioFootprint("user-1"),
      refetchOnMount: "always",
    });
  });

  it("keeps the funnel out of the awaited roster cache set", () => {
    expect(providerRosterCacheKeys("org-1")).not.toContainEqual(
      queryKeys.onboardingFunnel("org-1"),
    );
  });

  it("marks the funnel stale when a case is created", () => {
    holder.invalidateQueries.mockClear();
    const mutation = useCreateCase() as unknown as { onSuccess: () => void };
    mutation.onSuccess();
    expect(holder.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.onboardingFunnel("org-1"),
    });
  });

  it("marks the funnel stale when a generation batch settles", () => {
    holder.invalidateQueries.mockClear();
    const mutation = useConfirmGeneration() as unknown as { onSettled: () => void };
    mutation.onSettled();
    expect(holder.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.onboardingFunnel("org-1"),
    });
  });
});

import { useQuery } from "@tanstack/react-query";
import {
  buildBillingFeed,
  type BillingReadinessSnapshot,
  type BillingFeedEvent,
} from "@/lib/billingReadiness";
import { useActiveOrgId, useAuthStore } from "@/lib/auth-store";
import { getBillingReadinessSnapshot } from "@/services/billingReadiness";

export interface BillingReadinessQueryData {
  orgId: string;
  userId: string;
  asOf: string;
  assessedAt: string;
  snapshot: BillingReadinessSnapshot;
  feed: BillingFeedEvent[];
}

function localTodayIso(): string {
  const now = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isCurrentBillingReadinessDate(asOf: string): boolean {
  return asOf === localTodayIso();
}

export interface BillingReadinessData {
  orgId: string | null;
  userId: string | null;
  data: BillingReadinessQueryData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isStale: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  refreshForDigest: () => Promise<BillingReadinessQueryData | null>;
}

export function useBillingReadiness(): BillingReadinessData {
  const orgId = useActiveOrgId();
  const session = useAuthStore((state) => state.session);
  const userId = session?.user.id ?? null;
  const query = useQuery({
    queryKey: ["billing-readiness", orgId ?? "no-org", userId ?? "no-session"],
    enabled: Boolean(orgId && session),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<BillingReadinessQueryData> => {
      if (!orgId || !userId)
        throw new Error("Select an organization and sign in to load billing readiness.");
      const asOf = localTodayIso();
      const snapshot = await getBillingReadinessSnapshot(undefined, asOf, orgId);
      const current = useAuthStore.getState();
      if (!current.session || current.session.user.id !== userId || current.activeOrgId !== orgId) {
        throw new Error(
          "The session or active organization changed while billing readiness loaded.",
        );
      }
      return {
        orgId,
        userId,
        asOf,
        assessedAt: new Date().toISOString(),
        snapshot,
        feed: buildBillingFeed(snapshot, asOf),
      };
    },
  });

  // TanStack Query retains prior data after a refetch error. It must not be
  // presented as a current clearance result or an export source.
  let data: BillingReadinessQueryData | undefined;
  if (
    !query.isError &&
    !query.isFetching &&
    !query.isStale &&
    orgId &&
    userId &&
    query.data?.orgId === orgId &&
    query.data.userId === userId &&
    isCurrentBillingReadinessDate(query.data.asOf)
  ) {
    const current = useAuthStore.getState();
    if (current.session?.user.id === userId && current.activeOrgId === orgId) data = query.data;
  }

  const refreshForDigest = async (): Promise<BillingReadinessQueryData | null> => {
    if (!orgId || !userId || !session) return null;
    const before = useAuthStore.getState();
    if (before.activeOrgId !== orgId || before.session?.user.id !== userId) return null;
    const result = await query.refetch();
    const after = useAuthStore.getState();
    if (
      result.isError ||
      !result.data ||
      after.activeOrgId !== orgId ||
      after.session?.user.id !== userId ||
      result.data.orgId !== orgId ||
      result.data.userId !== userId ||
      !isCurrentBillingReadinessDate(result.data.asOf)
    ) {
      return null;
    }
    return result.data;
  };

  return {
    orgId,
    userId,
    data,
    isLoading: query.isLoading || (!orgId || !session ? false : query.isFetching && !query.data),
    isFetching: query.isFetching,
    isError: query.isError,
    isStale: query.isStale,
    error: query.error instanceof Error ? query.error : null,
    refresh: async () => {
      await query.refetch();
    },
    refreshForDigest,
  };
}

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuthStore } from "@/lib/auth-store";
import {
  fetchEnrollmentReportPage,
  fetchEnrollmentScopeDetail,
  fetchEnrollmentScopeHistory,
  type EnrollmentExplorerRequestContext,
} from "@/lib/enrollmentExplorerApi";
import type { EnrollmentReportFilters } from "@/types";

export function useEnrollmentReportContext(): EnrollmentExplorerRequestContext | null {
  const selected = useAuthStore((state) => state.accessContext);
  return useMemo(() => {
    if (!selected?.selectedOrgId || !selected.audience || !selected.contextRevision) return null;
    return {
      orgId: selected.selectedOrgId,
      audience: selected.audience,
      contextRevision: selected.contextRevision,
    };
  }, [selected?.audience, selected?.contextRevision, selected?.selectedOrgId]);
}

export function useEnrollmentReport(filters: EnrollmentReportFilters, enabled = true) {
  const context = useEnrollmentReportContext();
  return useInfiniteQuery({
    queryKey: [
      "enrollment-report-page",
      context?.orgId ?? "no-org",
      context?.audience ?? "none",
      context?.contextRevision ?? "no-context",
      filters,
    ],
    enabled: Boolean(context && enabled),
    initialPageParam: { cursor: null as string | null, viewToken: null as string | null },
    queryFn: ({ pageParam, signal }) => {
      if (!context) throw new Error("Select an organization and access audience first");
      return fetchEnrollmentReportPage(
        context,
        { ...filters, cursor: pageParam.cursor, viewToken: pageParam.viewToken },
        { signal },
      );
    },
    getNextPageParam: (lastPage) =>
      lastPage.nextCursor
        ? { cursor: lastPage.nextCursor, viewToken: lastPage.viewToken }
        : undefined,
    staleTime: 0,
    retry: (failureCount, error) => {
      if (error instanceof Error && "status" in error && error.status === 409) return false;
      return failureCount < 1;
    },
  });
}

export function useEnrollmentScopeHistory(scopeId: string | null, enabled: boolean) {
  const context = useEnrollmentReportContext();
  return useInfiniteQuery({
    queryKey: [
      "enrollment-scope-history",
      context?.orgId ?? "no-org",
      context?.audience ?? "none",
      context?.contextRevision ?? "no-context",
      scopeId,
    ],
    enabled: Boolean(context && scopeId && enabled),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      if (!context || !scopeId) throw new Error("Scope history is unavailable");
      return fetchEnrollmentScopeHistory(context, scopeId, { cursor: pageParam, limit: 20 }, { signal });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    retry: false,
  });
}

export function useEnrollmentScopeDetail(scopeId: string | null, enabled: boolean) {
  const context = useEnrollmentReportContext();
  return useQuery({
    queryKey: [
      "enrollment-scope-detail",
      context?.orgId ?? "no-org",
      context?.audience ?? "none",
      context?.contextRevision ?? "no-context",
      scopeId,
    ],
    enabled: Boolean(context && scopeId && enabled),
    queryFn: ({ signal }) => {
      if (!context || !scopeId) throw new Error("Scope detail is unavailable");
      return fetchEnrollmentScopeDetail(context, scopeId, { signal });
    },
    staleTime: 0,
    retry: false,
  });
}

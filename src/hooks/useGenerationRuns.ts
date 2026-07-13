// E2.4 TE-8 — run-history hooks: the org's runs (actor names resolved by the
// service) and one run's immutable disposition rows. Both are org-scoped
// reads over INSERT-only data; the confirm mutation invalidates the runs
// prefix so a fresh batch appears immediately.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  listGenerationRunRows,
  listGenerationRuns,
  listRunDispositions,
  type RunDispositionRow,
} from "@/services/generationRuns";

export function useGenerationRuns() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.generationRuns(orgId),
    queryFn: listGenerationRuns,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useGenerationRunRows(runId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.generationRunRows(orgId, runId ?? ""),
    queryFn: () => listGenerationRunRows(runId as string),
    enabled: orgId !== "no-org" && Boolean(runId),
    staleTime: FIVE_MINUTES,
  });
}

/** The runs list's counts source: ONE org-scoped dispositions read grouped
 * by run id (its key rides the run-rows prefix, so a confirm invalidates it). */
export function useGenerationRunRowCounts() {
  const orgId = useActiveOrgId() ?? "no-org";
  const query = useQuery({
    queryKey: [...queryKeys.generationRunRows(orgId, "all"), "dispositions"] as const,
    queryFn: listRunDispositions,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const byRun = new Map<string, RunDispositionRow[]>();
    for (const row of query.data) {
      byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row]);
    }
    return byRun;
  }, [query.data]);
  return { ...query, data };
}

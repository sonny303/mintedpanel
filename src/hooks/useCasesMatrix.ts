// Cases Matrix composition hook — combines the existing /cases query cache
// with generation exclusions and passes resolved data to the pure matrix
// derivation without adding a query or invoking generation preview.
import { useMemo } from "react";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { usePayers } from "@/hooks/useAdmin";
import { useCaseGenerationExclusions } from "@/hooks/useGenerationPreview";
import { useProviderGroups } from "@/hooks/useLookups";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { useCases } from "@/hooks/useCases";
import { useQueueTaskRows } from "@/hooks/useNextBestActions";
import { useFollowUpsDue } from "@/hooks/useTouches";
import { useProviders } from "@/hooks/useProviders";
import { buildCasesMatrix, type CasesMatrix, type CasesMatrixInput } from "@/lib/casesMatrix";
import type { CasesFilters } from "@/lib/casesView";
import type { CaseFollowUp } from "@/services/touches";

export interface CasesMatrixData {
  matrix: CasesMatrix | undefined;
  followUps: ReadonlyMap<string, CaseFollowUp> | undefined;
  /** Date-only ISO string the derivation used; reused by the cells so the
   *  board and its popovers never disagree about what "today" is. */
  today: string;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export interface CasesMatrixFilters extends CasesFilters {
  caseIds?: ReadonlySet<string> | null;
  generationRunId?: string | null;
}

export function useCasesMatrix(filters?: CasesMatrixFilters): CasesMatrixData {
  const casesQ = useCases();
  const payersQ = usePayers();
  const providersQ = useProviders();
  const groupsQ = useProviderGroups();
  const targetsQ = usePayerNetworkTargets();
  const tasksQ = useQueueTaskRows();
  const followUpsQ = useFollowUpsDue();
  const exclusionsQ = useCaseGenerationExclusions();
  const sources = [casesQ, payersQ, providersQ, groupsQ, targetsQ, tasksQ, followUpsQ, exclusionsQ];
  const resolved = sources.every((query) => query.data !== undefined);
  const today = localTodayIso();
  const kpi = filters?.kpi ?? "total";
  const state = filters?.state ?? "all";
  const status = filters?.status ?? "all";
  const search = filters?.search ?? "";
  const caseIds = filters?.caseIds ?? null;
  const generationRunId = filters?.generationRunId ?? null;

  const matrix = useMemo(() => {
    if (!resolved) return undefined;
    const input: CasesMatrixInput = {
      today,
      providers: providersQ.data ?? [],
      cases: (casesQ.data ?? []).filter(
        (credentialCase) =>
          (!generationRunId || credentialCase.generationRunId === generationRunId) &&
          (!caseIds || caseIds.has(credentialCase.id)),
      ),
      payers: payersQ.data ?? [],
      groups: groupsQ.data ?? [],
      targets: targetsQ.data ?? [],
      tasks: tasksQ.data ?? [],
      followUps: followUpsQ.data,
      exclusions: exclusionsQ.data ?? [],
      filters: { kpi, state, status, search },
    };
    return buildCasesMatrix(input);
  }, [
    resolved,
    today,
    providersQ.data,
    casesQ.data,
    payersQ.data,
    groupsQ.data,
    targetsQ.data,
    tasksQ.data,
    followUpsQ.data,
    exclusionsQ.data,
    kpi,
    state,
    status,
    search,
    caseIds,
    generationRunId,
  ]);

  return {
    matrix,
    followUps: followUpsQ.data,
    today,
    isLoading: sources.some((query) => query.isLoading),
    isError: sources.some((query) => query.isError),
    refetch: () => {
      for (const query of sources) {
        if (query.isError) void query.refetch();
      }
    },
  };
}

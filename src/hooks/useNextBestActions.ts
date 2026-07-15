// E2.3 TE-4/TE-5 — the queue composition hook: assembles the deadline and
// readiness inputs from the SAME org-scoped caches the generation preview and
// wizard already maintain plus the two narrow queue projections, evaluates
// E1.8 readiness ONCE over the assembled inputs (never a per-row call), and
// runs the pure ranked reduction. The queue stores NOTHING (TE-10): every
// render recomputes, so touching a case, completing a task, or fixing a gap
// re-derives the entry away through the existing cache invalidations.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { useCases } from "@/hooks/useCases";
import { useFollowUpsDue } from "@/hooks/useTouches";
import { useFacilities, useOrgStateLicenses, useProviderGroups } from "@/hooks/useLookups";
import { useProviderAssignments, useProviderGroupAssignments } from "@/hooks/useProviders";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import {
  localTodayIso,
  useGroupInsurancePolicies,
  useGroupReadinessDocuments,
  useProviderReadinessFacts,
} from "@/hooks/useEnrollmentReadiness";
import { useGenerationContractRows } from "@/hooks/useGenerationPreview";
import { evaluateEnrollmentReadiness, type GroupContractInput } from "@/lib/enrollmentReadiness";
import {
  buildNextBestActions,
  type QueueEntry,
  type QueueReadinessInput,
  type QueueTouchInput,
} from "@/lib/nextBestActions";
import { listQueueProviderRows, listQueueTaskRows } from "@/services/nextBestActions";
import { getGenerationRun } from "@/services/caseGenerationRuns";

const THIRTY_SECONDS = 30_000;

export function useQueueTaskRows() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.queueTaskRows(orgId),
    queryFn: listQueueTaskRows,
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

export function useQueueProviderRows() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.queueProviderRows(orgId),
    queryFn: listQueueProviderRows,
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

/** TE-6 — the batch banner's run row (immutable: the confirm-time plan). */
export function useGenerationRun(runId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.generationRun(orgId, runId ?? ""),
    queryFn: () => getGenerationRun(runId as string),
    enabled: orgId !== "no-org" && Boolean(runId),
    staleTime: FIVE_MINUTES,
  });
}

export interface NextBestActionsData {
  /** undefined while any source read is unresolved (loading or error). */
  entries: QueueEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useNextBestActions(): NextBestActionsData {
  const casesQ = useCases();
  const tasksQ = useQueueTaskRows();
  const providersQ = useQueueProviderRows();
  const followUpsQ = useFollowUpsDue();
  const facilityAssignmentsQ = useProviderAssignments();
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();
  // E1.8 readiness inputs (TE-5) — the same reads the generation preview and
  // Scope Review share, including the E2.0 group-contract addition.
  const targetsQ = usePayerNetworkTargets();
  const groupAssignmentsQ = useProviderGroupAssignments();
  const factsQ = useProviderReadinessFacts();
  const licensesQ = useOrgStateLicenses();
  const documentsQ = useGroupReadinessDocuments();
  const insuranceQ = useGroupInsurancePolicies();
  const contractsQ = useGenerationContractRows();

  const sources = [
    casesQ,
    tasksQ,
    providersQ,
    followUpsQ,
    facilityAssignmentsQ,
    facilitiesQ,
    groupsQ,
    payersQ,
    statusConfigsQ,
    targetsQ,
    groupAssignmentsQ,
    factsQ,
    licensesQ,
    documentsQ,
    insuranceQ,
    contractsQ,
  ];
  const resolved = sources.every((q) => q.data !== undefined);
  const today = localTodayIso();

  const entries = useMemo(() => {
    if (!resolved) return undefined;

    const statusById = new Map(
      (statusConfigsQ.data ?? []).map((s) => [s.id, { label: s.label, bucket: s.actionBucket }]),
    );
    const contracts: GroupContractInput[] = (contractsQ.data ?? []).map((c) => ({
      groupId: c.groupId,
      payerId: c.payerId,
      state: c.state,
      statusLabel: c.contractingStatusId
        ? (statusById.get(c.contractingStatusId)?.label ?? null)
        : null,
    }));

    // ONE evaluation pass (TE-5); rows reduce to their open-gap labels and
    // join entries by the 4-part key inside the pure module.
    const readiness: QueueReadinessInput[] = evaluateEnrollmentReadiness({
      today,
      targets: targetsQ.data ?? [],
      groupAssignments: groupAssignmentsQ.data ?? [],
      providers: factsQ.data ?? [],
      licenses: licensesQ.data ?? [],
      facilities: facilitiesQ.data ?? [],
      groupDocuments: documentsQ.data ?? [],
      groupInsurancePolicies: insuranceQ.data ?? [],
      contracts,
    }).map((row) => ({
      providerId: row.providerId,
      groupId: row.groupId,
      payerId: row.payerId,
      state: row.state,
      openGapLabels: row.checks.filter((c) => !c.pass).map((c) => c.label),
    }));

    // The follow-ups read is already the latest touchpoint per case (the
    // touchpoint-scoped M5 read); the module re-enforces the entry_type rule.
    const touches: QueueTouchInput[] = [...(followUpsQ.data?.values() ?? [])].map((f) => ({
      caseId: f.caseId,
      entryType: "touchpoint",
      touchDate: f.touchDate,
      nextFollowUpDate: f.nextFollowUpDate,
    }));

    return buildNextBestActions({
      today,
      cases: (casesQ.data ?? []).map((c) => ({
        id: c.id,
        providerId: c.providerId,
        groupId: c.groupId ?? null,
        payerId: c.payerId,
        state: c.state,
        credentialingStatusId: c.credentialingStatusId,
        facilityId: c.facilityId ?? null,
        generationRunId: c.generationRunId ?? null,
        payerPipelineState: c.payerPipelineState,
        createdAt: c.createdAt,
      })),
      statusConfigs: (statusConfigsQ.data ?? []).map((s) => ({
        id: s.id,
        actionBucket: s.actionBucket,
      })),
      tasks: tasksQ.data ?? [],
      touches,
      providers: providersQ.data ?? [],
      facilityAssignments: (facilityAssignmentsQ.data ?? []).map((a) => ({
        providerId: a.providerId,
        facilityId: a.facilityId,
        startDate: a.startDate ?? null,
      })),
      facilities: (facilitiesQ.data ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        effectiveDate: f.effectiveDate ?? null,
      })),
      groups: (groupsQ.data ?? []).map((g) => ({ id: g.id, name: g.name })),
      payers: (payersQ.data ?? []).map((p) => ({ id: p.id, name: p.name })),
      readiness,
    });
  }, [
    resolved,
    today,
    casesQ.data,
    tasksQ.data,
    providersQ.data,
    followUpsQ.data,
    facilityAssignmentsQ.data,
    facilitiesQ.data,
    groupsQ.data,
    payersQ.data,
    statusConfigsQ.data,
    targetsQ.data,
    groupAssignmentsQ.data,
    factsQ.data,
    licensesQ.data,
    documentsQ.data,
    insuranceQ.data,
    contractsQ.data,
  ]);

  return {
    entries,
    isLoading: sources.some((q) => q.isLoading),
    isError: sources.some((q) => q.isError),
    refetch: () => {
      for (const q of sources) if (q.isError) q.refetch();
    },
  };
}

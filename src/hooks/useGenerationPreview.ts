// E2.0 TE-9/TE-10 — the generation-preview composition hook: assembles the
// candidate inputs from the SAME org-scoped caches the wizard already
// maintains plus the exclusions table and the two narrow projections
// (cases, contracts), runs the pure derivation, and evaluates readiness ONCE
// over the assembled inputs — preview rows join readiness rows by the 4-part
// key (never a readinessForCaseKey call per row). Nothing is stored at
// preview time (TE-11): every open recomputes from live inputs, so delta
// runs fall out of derivation.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
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
import {
  evaluateEnrollmentReadiness,
  type GroupContractInput,
  type ReadinessRow,
} from "@/lib/enrollmentReadiness";
import {
  buildGenerationPreview,
  generationPreviewSummary,
  previewRowKey,
  type GenerationPreviewRow,
  type GenerationPreviewSummary,
} from "@/lib/generationPreview";
import {
  createCaseGenerationExclusion,
  listCaseGenerationExclusions,
  voidCaseGenerationExclusion,
  type CreateExclusionInput,
} from "@/services/caseGenerationExclusions";
import { listGenerationCaseRows, listGenerationContractRows } from "@/services/generationPreview";
import { planGenerationConfirm } from "@/lib/generationConfirm";
import { pickTemplate } from "@/lib/pickTemplate";
import { resolveTemplate } from "@/lib/sopResolver";
import { stampTasks } from "@/lib/sopStamp";
import {
  confirmGenerationBatch,
  type GenerationConfirmEntry,
  type GenerationConfirmResult,
} from "@/services/generationConfirm";
import { useProviders } from "@/hooks/useProviders";
import { useSops } from "@/hooks/useAdmin";
import type { CaseGenerationExclusion } from "@/types";

export function useCaseGenerationExclusions() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.caseGenerationExclusions(orgId),
    queryFn: listCaseGenerationExclusions,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useGenerationCaseRows() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.generationCaseRows(orgId),
    queryFn: listGenerationCaseRows,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useGenerationContractRows() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.generationContractRows(orgId),
    queryFn: listGenerationContractRows,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useCreateCaseGenerationExclusion() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: CreateExclusionInput) => createCaseGenerationExclusion(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.caseGenerationExclusions(orgId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export function useVoidCaseGenerationExclusion() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (id: string) => voidCaseGenerationExclusion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.caseGenerationExclusions(orgId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export interface GenerationPreviewData {
  /** undefined while any source read is unresolved (loading or error). */
  rows: GenerationPreviewRow[] | undefined;
  summary: GenerationPreviewSummary | undefined;
  /** Readiness rows joined by the 4-part key (TE-9). A missing key renders
   * as "no readiness data" — never a green Ready. */
  readinessByKey: Map<string, ReadinessRow> | undefined;
  exclusions: CaseGenerationExclusion[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useGenerationPreview(): GenerationPreviewData {
  const targetsQ = usePayerNetworkTargets();
  const groupAssignmentsQ = useProviderGroupAssignments();
  const facilityAssignmentsQ = useProviderAssignments();
  const factsQ = useProviderReadinessFacts();
  const licensesQ = useOrgStateLicenses();
  const facilitiesQ = useFacilities();
  const documentsQ = useGroupReadinessDocuments();
  const insuranceQ = useGroupInsurancePolicies();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();
  const casesQ = useGenerationCaseRows();
  const contractsQ = useGenerationContractRows();
  const exclusionsQ = useCaseGenerationExclusions();

  const sources = [
    targetsQ,
    groupAssignmentsQ,
    facilityAssignmentsQ,
    factsQ,
    licensesQ,
    facilitiesQ,
    documentsQ,
    insuranceQ,
    groupsQ,
    payersQ,
    statusConfigsQ,
    casesQ,
    contractsQ,
    exclusionsQ,
  ];
  const resolved = sources.every((q) => q.data !== undefined);
  const today = localTodayIso();

  const derived = useMemo(() => {
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
    const existingCases = (casesQ.data ?? []).map((c) => {
      const status = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : undefined;
      return {
        id: c.id,
        providerId: c.providerId,
        payerId: c.payerId,
        state: c.state,
        groupId: c.groupId,
        statusLabel: status?.label ?? null,
        actionBucket: status?.bucket ?? null,
      };
    });

    const rows = buildGenerationPreview({
      today,
      targets: targetsQ.data ?? [],
      groupAssignments: groupAssignmentsQ.data ?? [],
      facilityAssignments: facilityAssignmentsQ.data ?? [],
      facilities: facilitiesQ.data ?? [],
      providers: factsQ.data ?? [],
      groups: (groupsQ.data ?? []).map((g) => ({ id: g.id, name: g.name })),
      payers: (payersQ.data ?? []).map((p) => ({ id: p.id, name: p.name })),
      existingCases,
      exclusions: exclusionsQ.data ?? [],
    });

    // ONE evaluation pass over the same inputs, joined to rows by key (TE-9).
    const readinessRows = evaluateEnrollmentReadiness({
      today,
      targets: targetsQ.data ?? [],
      groupAssignments: groupAssignmentsQ.data ?? [],
      providers: factsQ.data ?? [],
      licenses: licensesQ.data ?? [],
      facilities: facilitiesQ.data ?? [],
      groupDocuments: documentsQ.data ?? [],
      groupInsurancePolicies: insuranceQ.data ?? [],
      contracts,
    });
    const readinessByKey = new Map(readinessRows.map((r) => [previewRowKey(r), r]));
    return { rows, readinessByKey };
  }, [
    resolved,
    today,
    targetsQ.data,
    groupAssignmentsQ.data,
    facilityAssignmentsQ.data,
    factsQ.data,
    licensesQ.data,
    facilitiesQ.data,
    documentsQ.data,
    insuranceQ.data,
    groupsQ.data,
    payersQ.data,
    statusConfigsQ.data,
    casesQ.data,
    contractsQ.data,
    exclusionsQ.data,
  ]);

  return {
    rows: derived?.rows,
    summary: derived ? generationPreviewSummary(derived.rows) : undefined,
    readinessByKey: derived?.readinessByKey,
    exclusions: exclusionsQ.data,
    isLoading: sources.some((q) => q.isLoading),
    isError: sources.some((q) => q.isError),
    refetch: () => {
      for (const q of sources) if (q.isError) q.refetch();
    },
  };
}

// E2.1 F2.1.2 — the confirm & create mutation. Resolution rides the SAME
// pickTemplate/resolveTemplate tier every other creation surface uses;
// facility stays null (generation cases aren't location-linked) and no MSO
// routing is resolved (not in the epic's table trace). Every resolved task is
// version-stamped (E2.2 F2.2.1) from the SAME head-row snapshot the resolver
// consumed — the TE-2 contract: stamp the version read with the content,
// never a re-read that could race a publish. The loop itself — run row first,
// per-row RPC calls, 23505 → skipped_existing — is the generationConfirm
// service.
export function useConfirmGeneration() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  const providersQ = useProviders();
  const groupsQ = useProviderGroups();
  const templatesQ = useSops();

  const ready =
    providersQ.data !== undefined && groupsQ.data !== undefined && templatesQ.data !== undefined;

  const mutation = useMutation({
    mutationFn: async (rows: GenerationPreviewRow[]): Promise<GenerationConfirmResult> => {
      const providerById = new Map((providersQ.data ?? []).map((p) => [p.id, p]));
      const groupById = new Map((groupsQ.data ?? []).map((g) => [g.id, g]));
      const templates = templatesQ.data ?? [];

      const plan = planGenerationConfirm(rows);
      const entries: GenerationConfirmEntry[] = plan.toCreate.map((row) => {
        const provider = providerById.get(row.providerId);
        const template = pickTemplate(templates, row.payerId, row.state, row.groupId);
        const tasks =
          provider && template
            ? stampTasks(
                resolveTemplate(template, provider, groupById.get(row.groupId) ?? null, null, null),
                template,
              )
            : [];
        return { row, tasks };
      });
      return confirmGenerationBatch(plan, entries);
    },
    onSettled: () => {
      // Created cases (even on partial failure) must flip preview rows to
      // "existing" and show up in the work views immediately.
      qc.invalidateQueries({ queryKey: queryKeys.generationCaseRows(orgId) });
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
      // E2.4: the fresh run + its disposition rows appear in run history.
      qc.invalidateQueries({ queryKey: ["generation-runs", orgId] });
      qc.invalidateQueries({ queryKey: ["generation-run-rows", orgId] });
    },
  });

  return { ...mutation, ready };
}

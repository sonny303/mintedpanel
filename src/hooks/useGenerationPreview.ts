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
  type ProviderReadinessFacts,
  type ReadinessRow,
} from "@/lib/enrollmentReadiness";
import { archivedPayerIds } from "@/lib/payerSetup";
import {
  buildGenerationPreview,
  buildGenerationSkips,
  generationPreviewSummary,
  previewRowKey,
  type GenerationPreviewRow,
  type GenerationPreviewSummary,
  type GenerationSkipRow,
} from "@/lib/generationPreview";
import {
  createCaseGenerationExclusion,
  listCaseGenerationExclusions,
  voidCaseGenerationExclusion,
  type CreateExclusionInput,
} from "@/services/caseGenerationExclusions";
import { listGenerationCaseRows, listGenerationContractRows } from "@/services/generationPreview";
import { planGenerationConfirm } from "@/lib/generationConfirm";
import { isFallbackTemplate, pickTemplate } from "@/lib/pickTemplate";
import { resolveTemplate } from "@/lib/sopResolver";
import { stampTasks, stampExecutionTypes, templateProvenance } from "@/lib/sopStamp";
import { evaluateGeneration, type GatedRow } from "@/lib/generationGating";
import { applyReleaseScope, releaseScopeRecord, type ReleaseScope } from "@/lib/releaseScope";
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

/** E4.2 TE-6 — an optional payer/group scope for the bulk-generation entry. */
export interface GenerationScope {
  payerId?: string;
  groupId?: string;
}

export interface GenerationPreviewData {
  /** undefined while any source read is unresolved (loading or error). */
  rows: GenerationPreviewRow[] | undefined;
  summary: GenerationPreviewSummary | undefined;
  /** Readiness rows joined by the 4-part key (TE-9). A missing key renders
   * as "no readiness data" — never a green Ready. */
  readinessByKey: Map<string, ReadinessRow> | undefined;
  exclusions: CaseGenerationExclusion[] | undefined;
  /** E4.2 TE-13 — proposed rows blocked by a missing required attribute. */
  gated: GatedRow[] | undefined;
  /** GEN-SILENT — group members dropped before candidacy with an explanation. */
  skips: GenerationSkipRow[] | undefined;
  /** E4.2 SOP hardening — keys of PROPOSED rows that resolve to the generic
   * fallback SOP (no payer-specific SOP matches). The preview labels these and
   * warns before confirming; the tier is persisted on the created run row. */
  fallbackRowKeys: Set<string> | undefined;
  /** provider id → facility ids, for a location-based release scope (TE-14). */
  providerFacilities: Map<string, Set<string>> | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useGenerationPreview(scope?: GenerationScope): GenerationPreviewData {
  const targetsQ = usePayerNetworkTargets();
  const groupAssignmentsQ = useProviderGroupAssignments();
  const facilityAssignmentsQ = useProviderAssignments();
  const factsQ = useProviderReadinessFacts();
  const rosterQ = useProviders();
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
  const templatesQ = useSops();

  const sources = [
    targetsQ,
    groupAssignmentsQ,
    facilityAssignmentsQ,
    factsQ,
    rosterQ,
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
    templatesQ,
  ];
  const resolved = sources.every((q) => q.data !== undefined);
  const today = localTodayIso();
  const scopePayer = scope?.payerId;
  const scopeGroup = scope?.groupId;

  const derived = useMemo(() => {
    if (!resolved) return undefined;
    // E6.8 F6.8.1 — an ARCHIVED payer generates nothing: its targets are
    // dropped from the candidate inputs (the target rows themselves are
    // untouched, so reactivation restores the scope with zero writes).
    const archivedPayers = archivedPayerIds(payersQ.data ?? []);
    const liveTargets = (targetsQ.data ?? []).filter((t) => !archivedPayers.has(t.payerId));
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

    const previewInput = {
      today,
      targets: liveTargets,
      groupAssignments: groupAssignmentsQ.data ?? [],
      facilityAssignments: facilityAssignmentsQ.data ?? [],
      facilities: facilitiesQ.data ?? [],
      providers: factsQ.data ?? [],
      groups: (groupsQ.data ?? []).map((g) => ({ id: g.id, name: g.name })),
      payers: (payersQ.data ?? []).map((p) => ({ id: p.id, name: p.name })),
      existingCases,
      exclusions: exclusionsQ.data ?? [],
    };

    const allRows = buildGenerationPreview(previewInput);

    // TE-6 — payer/group scope is a POST-filter over the locked preview rows;
    // buildGenerationPreview's candidate/dedupe/exclusion logic is untouched.
    const rows = allRows.filter(
      (r) => (!scopePayer || r.payerId === scopePayer) && (!scopeGroup || r.groupId === scopeGroup),
    );

    const allSkips = buildGenerationSkips(
      previewInput,
      (rosterQ.data ?? []).map((p) => ({
        providerId: p.id,
        providerName: `${p.firstName} ${p.lastName}`.trim(),
        pendingVerification: p.verificationState === "pending_verification",
        skipEligible:
          p.status !== "terminated" && !p.referenceOnly && p.isTestProvider !== true,
      })),
    );
    const skips = allSkips.filter(
      (s) => (!scopePayer || s.payerId === scopePayer) && (!scopeGroup || s.groupId === scopeGroup),
    );

    // TE-13 — gate proposed rows against their SOP's required attributes.
    const factsById = new Map<string, ProviderReadinessFacts>(
      (factsQ.data ?? []).map((f) => [f.providerId, f]),
    );
    const templates = templatesQ.data ?? [];
    const gating = evaluateGeneration({ rows, templates, factsById });

    // E4.2 SOP hardening — flag PROPOSED rows that resolve to the generic
    // fallback (no payer-specific SOP), via the SAME deterministic pickTemplate
    // the confirm loop uses. Derived every preview; never stored.
    const fallbackRowKeys = new Set<string>();
    for (const r of rows) {
      if (r.disposition !== "proposed") continue;
      const tpl = pickTemplate(templates, r.payerId, r.state, r.groupId);
      if (tpl && isFallbackTemplate(tpl)) fallbackRowKeys.add(previewRowKey(r));
    }

    // TE-14 — provider → facility ids for a location-based release scope.
    const providerFacilities = new Map<string, Set<string>>();
    for (const a of facilityAssignmentsQ.data ?? []) {
      if (!a.providerId || !a.facilityId) continue;
      const set = providerFacilities.get(a.providerId) ?? new Set<string>();
      set.add(a.facilityId);
      providerFacilities.set(a.providerId, set);
    }

    const readinessRows = evaluateEnrollmentReadiness({
      today,
      targets: liveTargets,
      groupAssignments: groupAssignmentsQ.data ?? [],
      providers: factsQ.data ?? [],
      licenses: licensesQ.data ?? [],
      facilities: facilitiesQ.data ?? [],
      groupDocuments: documentsQ.data ?? [],
      groupInsurancePolicies: insuranceQ.data ?? [],
      contracts,
    });
    const readinessByKey = new Map(readinessRows.map((r) => [previewRowKey(r), r]));
    return {
      rows,
      readinessByKey,
      gated: gating.gated,
      skips,
      providerFacilities,
      fallbackRowKeys,
    };
  }, [
    resolved,
    today,
    scopePayer,
    scopeGroup,
    targetsQ.data,
    groupAssignmentsQ.data,
    facilityAssignmentsQ.data,
    factsQ.data,
    rosterQ.data,
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
    templatesQ.data,
  ]);

  return {
    rows: derived?.rows,
    summary: derived ? generationPreviewSummary(derived.rows) : undefined,
    readinessByKey: derived?.readinessByKey,
    exclusions: exclusionsQ.data,
    gated: derived?.gated,
    skips: derived?.skips,
    fallbackRowKeys: derived?.fallbackRowKeys,
    providerFacilities: derived?.providerFacilities,
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
export interface ConfirmGenerationVars {
  /** The scoped preview rows (existing/excluded still ride for E2.4 recording). */
  rows: GenerationPreviewRow[];
  /** E4.2 TE-14 — the release scope; omitted ⇒ release all. */
  releaseScope?: ReleaseScope;
  /** provider → facility ids, required for a location-based release scope. */
  providerFacilities?: Map<string, Set<string>>;
  /** E6.3 — skip-for-now candidates (unchecked in the grid): ledger-recorded,
   * never attempted, stay in the buffer. */
  skippedRows?: GenerationPreviewRow[];
  /** E6.3 — enrollment-fact-covered rows: ledger-recorded, never attempted. */
  enrolledRows?: GenerationPreviewRow[];
}

export function useConfirmGeneration() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  const providersQ = useProviders();
  const groupsQ = useProviderGroups();
  const templatesQ = useSops();

  const ready =
    providersQ.data !== undefined && groupsQ.data !== undefined && templatesQ.data !== undefined;

  const mutation = useMutation({
    mutationFn: async (vars: ConfirmGenerationVars): Promise<GenerationConfirmResult> => {
      const rows = vars.rows;
      const providerById = new Map((providersQ.data ?? []).map((p) => [p.id, p]));
      const groupById = new Map((groupsQ.data ?? []).map((g) => [g.id, g]));
      const templates = templatesQ.data ?? [];

      const basePlan = planGenerationConfirm(rows);
      // E4.2 TE-14 — narrow the CREATE set to the released subset (gated rows
      // are already excluded by the caller). Skipped-existing/excluded rows
      // still ride the plan so E2.4 records them; only toCreate is scoped.
      const scope: ReleaseScope = vars.releaseScope ?? { kind: "all" };
      const released = applyReleaseScope(basePlan.toCreate, scope, {
        providerFacilities: vars.providerFacilities,
      });
      const plan = {
        ...basePlan,
        toCreate: released,
        // E6.3 — the grid's extra ledger buckets ride the plan verbatim.
        skipped: vars.skippedRows ?? [],
        enrolled: vars.enrolledRows ?? [],
        plannedCounts: {
          ...basePlan.plannedCounts,
          proposedCount: released.length,
          createdCount: released.length,
        },
      };

      const entries: GenerationConfirmEntry[] = plan.toCreate.map((row) => {
        const provider = providerById.get(row.providerId);
        const template = pickTemplate(templates, row.payerId, row.state, row.groupId);
        const tasks =
          provider && template
            ? stampExecutionTypes(
                stampTasks(
                  resolveTemplate(
                    template,
                    provider,
                    groupById.get(row.groupId) ?? null,
                    null,
                    null,
                  ),
                  template,
                ),
                template.taskDefinitions,
              )
            : [];
        // Record the resolution provenance from the SAME selection the tasks
        // were stamped from — the created run row snapshots it (E4.2).
        return { row, tasks, provenance: templateProvenance(template) };
      });
      const scopeRecord = releaseScopeRecord(scope, released.length, basePlan.toCreate.length);
      return confirmGenerationBatch(plan, entries, scopeRecord);
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

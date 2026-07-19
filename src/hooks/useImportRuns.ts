// E3.0 — import-run hooks + the client-driven async scan (TE-3). The scan
// driver is a MODULE-LEVEL async loop, not React state: starting a scan
// detaches it from the component tree, so in-app navigation never aborts it
// and "leave and return" (F3.0.4) is just re-reading the run row the driver
// keeps updating. The run panel POLLS the run while it is in flight; a run
// stuck in 'scanning' with no live driver in this tab renders as interrupted
// (the epic's client-driven-async honesty note), never a silent hang.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  applyBatchAssignment,
  cancelImportRun,
  commitImportRun,
  commitPayerAttachImportRun,
  commitSectionImportRun,
  completeImportRun,
  createImportRun,
  failImportRun,
  getImportRun,
  listImportRuns,
  listStagedImportRows,
  markImportRunScanning,
  stageImportRows,
} from "@/services/importRuns";
import {
  useProviders,
  useProviderAssignments,
  useProviderGroupAssignments,
} from "@/hooks/useProviders";
import { useFacilities, useOrgStateLicenses, useProviderGroups } from "@/hooks/useLookups";
import {
  dedupeFacilityRows,
  dedupeGroupRows,
  dedupeImportRows,
  type BatchAssignmentPlan,
  type CommitPlan,
  type SectionBlockedEntry,
  type SectionCreateEntry,
  type SectionDedupeResult,
} from "@/lib/importDedupe";
import { STAGE_CHUNK_SIZE, chunkRows, collectRowErrors } from "@/lib/rosterImport";
import {
  scanSectionRecord,
  sectionDescriptor,
  type SectionEntityKind,
  type SectionScanContext,
} from "@/lib/importSections";
import type { ParsedCsv } from "@/lib/csvImport";
import type { ImportRunErrorEntry, ImportRunSource } from "@/types";

const SCAN_POLL_MS = 1200;

// Runs being driven by THIS tab. Module scope (not React state) so a remount
// after navigation still knows the loop is alive; a run 'scanning' without an
// entry here was orphaned by a closed tab (or belongs to another session) and
// is surfaced as interrupted.
const liveScanRunIds = new Set<string>();

export function isScanDrivenHere(runId: string): boolean {
  return liveScanRunIds.has(runId);
}

// The detached scan loop: scan + stage in bounded chunks (the awaits between
// batches keep the main thread free on a 10k-row file), then land the run in
// ready_for_review with the compact error report. Failures mark the run
// 'failed' — the polling UI renders the outcome either way.
async function driveRosterScan(
  qc: QueryClient,
  orgId: string,
  runId: string,
  parsed: ParsedCsv,
  entityKind: SectionEntityKind,
  scanContext?: SectionScanContext,
) {
  liveScanRunIds.add(runId);
  try {
    await markImportRunScanning(runId);
    const descriptor = sectionDescriptor(entityKind);
    const errors: ImportRunErrorEntry[] = [];
    for (const records of chunkRows(parsed.records, STAGE_CHUNK_SIZE)) {
      const scanned = records.map((r) =>
        scanSectionRecord(descriptor, r, parsed.headers, scanContext),
      );
      errors.push(...collectRowErrors(scanned));
      await stageImportRows(runId, scanned);
    }
    await completeImportRun(runId, errors);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Scan failed";
    try {
      await failImportRun(runId, reason);
    } catch {
      // The failure write itself failed (e.g. offline) — the run stays
      // 'scanning' and the interrupted-state UI covers it honestly.
    }
  } finally {
    liveScanRunIds.delete(runId);
    qc.invalidateQueries({ queryKey: queryKeys.importRuns(orgId) });
    qc.invalidateQueries({ queryKey: queryKeys.importRun(orgId, runId) });
  }
}

export function useImportRuns() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.importRuns(orgId),
    queryFn: listImportRuns,
    enabled: orgId !== "no-org",
  });
}

/** One run's durable progress row; polls while the scan is in flight so the
 * progress bar and state pill track the server-persisted counts. */
export function useImportRun(runId: string | null) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.importRun(orgId, runId ?? ""),
    queryFn: () => getImportRun(runId as string),
    enabled: orgId !== "no-org" && Boolean(runId),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "uploading" || state === "scanning" ? SCAN_POLL_MS : false;
    },
  });
}

export interface StartRosterScanInput {
  source: ImportRunSource;
  entityKind: SectionEntityKind;
  fileName: string;
  parsed: ParsedCsv;
  /** E6.2 — org-context inputs for descriptors with a contextScan (the
   * payer-attach eligibility check); other kinds omit it. */
  scanContext?: SectionScanContext;
}

/** Create the run row, then detach the chunked scan loop. Resolves with the
 * run id as soon as the header exists — the UI switches to polling the run,
 * and the loop keeps running through any in-app navigation. */
export function useStartRosterScan() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: async (input: StartRosterScanInput) => {
      const run = await createImportRun({
        source: input.source,
        entityKind: input.entityKind,
        fileName: input.fileName,
        totalRows: input.parsed.records.length,
      });
      void driveRosterScan(qc, orgId, run.id, input.parsed, input.entityKind, input.scanContext);
      return run.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.importRuns(orgId) });
    },
  });
}

export function useCancelImportRun() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (runId: string) => cancelImportRun(runId),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: queryKeys.importRuns(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.importRun(orgId, runId) });
      qc.invalidateQueries({ queryKey: queryKeys.importRunRows(orgId, runId) });
    },
  });
}

/* ----------------------- E3.1 — preview + staged commit ----------------------- */

export function useStagedImportRows(runId: string | null) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.importRunRows(orgId, runId ?? ""),
    queryFn: () => listStagedImportRows(runId as string),
    enabled: orgId !== "no-org" && Boolean(runId),
  });
}

/** The preview composition (the useGenerationPreview pattern): one staged-row
 * read + the EXISTING org caches (providers list projection, groups,
 * facilities, both assignment tables, the org license projection) joined in
 * memory by the pure five-part dedupe. Nothing is stored at preview time —
 * a re-open recomputes over live reads. */
export function useImportPreview(runId: string | null) {
  const runQ = useImportRun(runId);
  const rowsQ = useStagedImportRows(runId);
  const providersQ = useProviders();
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilities();
  const groupAssignmentsQ = useProviderGroupAssignments();
  const facilityAssignmentsQ = useProviderAssignments();
  const licensesQ = useOrgStateLicenses();

  const queries = [
    runQ,
    rowsQ,
    providersQ,
    groupsQ,
    facilitiesQ,
    groupAssignmentsQ,
    facilityAssignmentsQ,
    licensesQ,
  ];
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);

  const dispositions = useMemo(() => {
    if (!rowsQ.data) return null;
    return dedupeImportRows({
      rows: rowsQ.data,
      providers: (providersQ.data ?? []).map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        npi: p.npi,
        specialty: p.specialty,
      })),
      groups: (groupsQ.data ?? []).map((g) => ({ id: g.id, name: g.name, tin: g.tin })),
      facilities: (facilitiesQ.data ?? []).map((f) => ({ id: f.id, name: f.name })),
      groupAssignments: (groupAssignmentsQ.data ?? []).map((a) => ({
        providerId: a.providerId,
        groupId: a.groupId,
      })),
      facilityAssignments: (facilityAssignmentsQ.data ?? [])
        .filter(
          (a): a is typeof a & { providerId: string; facilityId: string } =>
            Boolean(a.providerId) && Boolean(a.facilityId),
        )
        .map((a) => ({ providerId: a.providerId, facilityId: a.facilityId })),
      licenses: (licensesQ.data ?? [])
        .filter((l): l is typeof l & { providerId: string } => Boolean(l.providerId))
        .map((l) => ({
          id: l.id,
          providerId: l.providerId,
          state: l.state,
          licenseNumber: l.licenseNumber,
          issueDate: l.issueDate,
          expirationDate: l.expirationDate,
        })),
    });
  }, [
    rowsQ.data,
    providersQ.data,
    groupsQ.data,
    facilitiesQ.data,
    groupAssignmentsQ.data,
    facilityAssignmentsQ.data,
    licensesQ.data,
  ]);

  return { run: runQ.data ?? null, dispositions, isLoading, isError };
}

/** Commit invalidates every cache the RPC's writes feed — providers, both
 * assignment tables, licenses, the readiness facts (the TE-2 fence read), and
 * the run itself. */
export function useCommitImportRun() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: { runId: string; plan: CommitPlan }) =>
      commitImportRun(input.runId, input.plan),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.importRuns(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.importRun(orgId, input.runId) });
      qc.invalidateQueries({ queryKey: queryKeys.importRunRows(orgId, input.runId) });
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.providerGroupAssignments(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.facilityAssignments(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.orgStateLicenses(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.providerReadinessFacts(orgId) });
    },
  });
}

/* ---------- E3.3 TE-8 — provider_group / facility section preview ---------- */

/** The group/facility preview (the useImportPreview pattern for the simpler
 * grains): one staged-row read + the existing group (and facility) caches →
 * pure dedupeGroupRows / dedupeFacilityRows. Nothing is stored at preview time. */
export function useSectionImportPreview(
  runId: string | null,
  entityKind: "provider_group" | "facility",
) {
  const runQ = useImportRun(runId);
  const rowsQ = useStagedImportRows(runId);
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilities();

  const queries =
    entityKind === "facility" ? [runQ, rowsQ, groupsQ, facilitiesQ] : [runQ, rowsQ, groupsQ];
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);

  const result = useMemo<SectionDedupeResult | null>(() => {
    if (!rowsQ.data) return null;
    const groups = (groupsQ.data ?? []).map((g) => ({ id: g.id, name: g.name, tin: g.tin }));
    if (entityKind === "provider_group") return dedupeGroupRows(rowsQ.data, groups);
    const facilities = (facilitiesQ.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      groupId: f.groupId,
      street: f.street,
      city: f.city,
      state: f.state,
      zip: f.zip,
    }));
    return dedupeFacilityRows(rowsQ.data, groups, facilities);
  }, [rowsQ.data, groupsQ.data, facilitiesQ.data, entityKind]);

  return { run: runQ.data ?? null, result, isLoading, isError };
}

/** Commit a group/facility run through the create-service fan-out; invalidates
 * the group (and facility) caches so the wizard chips flip, plus the run. */
export function useCommitSectionImportRun() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: {
      runId: string;
      entityKind: "provider_group" | "facility";
      creates: SectionCreateEntry[];
      skippedCount: number;
      blocked: SectionBlockedEntry[];
    }) => commitSectionImportRun(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.importRuns(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.importRun(orgId, input.runId) });
      qc.invalidateQueries({ queryKey: queryKeys.importRunRows(orgId, input.runId) });
      qc.invalidateQueries({ queryKey: queryKeys.providerGroups(orgId) });
      qc.invalidateQueries({ queryKey: ["facilities", orgId] });
    },
  });
}

/** E6.2 F6.2.4 — commit a payer_attach run (idempotent skip-on-match; the
 * org-level enablement is implicit). Invalidates the attach families the
 * board + wizard + readiness surfaces compose. */
export function useCommitPayerAttachImportRun() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: { runId: string }) => commitPayerAttachImportRun(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.importRuns(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.importRun(orgId, input.runId) });
      qc.invalidateQueries({ queryKey: queryKeys.payerNetworkTargets(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.orgPayerAssignments(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.payers(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.payerCatalog() });
    },
  });
}

/** The run's providers' EXISTING assignments (from the shared caches), so
 * planBatchAssignment can tell which providers already carried row-explicit
 * group/facility columns — explicit data wins over the batch default. */
export function useProviderAssignmentsForRun(run: {
  createdProviderIds: string[] | null;
  updatedProviderIds: string[] | null;
}) {
  const groupAssignmentsQ = useProviderGroupAssignments();
  const facilityAssignmentsQ = useProviderAssignments();
  return useMemo(() => {
    const ids = new Set([...(run.createdProviderIds ?? []), ...(run.updatedProviderIds ?? [])]);
    return {
      groupAssignments: (groupAssignmentsQ.data ?? [])
        .filter((a) => ids.has(a.providerId))
        .map((a) => ({ providerId: a.providerId, groupId: a.groupId })),
      facilityAssignments: (facilityAssignmentsQ.data ?? [])
        .filter(
          (a): a is typeof a & { providerId: string; facilityId: string } =>
            Boolean(a.providerId) && Boolean(a.facilityId) && ids.has(a.providerId as string),
        )
        .map((a) => ({ providerId: a.providerId, facilityId: a.facilityId })),
    };
  }, [
    run.createdProviderIds,
    run.updatedProviderIds,
    groupAssignmentsQ.data,
    facilityAssignmentsQ.data,
  ]);
}

export function useApplyBatchAssignment() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: {
      runId: string;
      groupId: string | null;
      facilityIds: string[];
      startDate: string;
      plan: BatchAssignmentPlan;
    }) => applyBatchAssignment(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providerGroupAssignments(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.facilityAssignments(orgId) });
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
    },
  });
}

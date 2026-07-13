// E3.0 — import-run hooks + the client-driven async scan (TE-3). The scan
// driver is a MODULE-LEVEL async loop, not React state: starting a scan
// detaches it from the component tree, so in-app navigation never aborts it
// and "leave and return" (F3.0.4) is just re-reading the run row the driver
// keeps updating. The run panel POLLS the run while it is in flight; a run
// stuck in 'scanning' with no live driver in this tab renders as interrupted
// (the epic's client-driven-async honesty note), never a silent hang.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  cancelImportRun,
  completeImportRun,
  createImportRun,
  failImportRun,
  getImportRun,
  listImportRuns,
  markImportRunScanning,
  stageImportRows,
} from "@/services/importRuns";
import {
  STAGE_CHUNK_SIZE,
  chunkRows,
  collectRowErrors,
  scanRosterRecord,
} from "@/lib/rosterImport";
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
async function driveRosterScan(qc: QueryClient, orgId: string, runId: string, parsed: ParsedCsv) {
  liveScanRunIds.add(runId);
  try {
    await markImportRunScanning(runId);
    const errors: ImportRunErrorEntry[] = [];
    for (const records of chunkRows(parsed.records, STAGE_CHUNK_SIZE)) {
      const scanned = records.map((r) => scanRosterRecord(r, parsed.headers));
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
  fileName: string;
  parsed: ParsedCsv;
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
        fileName: input.fileName,
        totalRows: input.parsed.records.length,
      });
      void driveRosterScan(qc, orgId, run.id, input.parsed);
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
    },
  });
}

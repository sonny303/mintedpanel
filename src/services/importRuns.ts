// E3.0 — the import_runs / import_rows staging service (TE-2/TE-3). The ONLY
// Supabase caller for the bulk-roster-import pipeline. Nothing here touches
// live provider/group/facility tables — staged rows wait for E3.1's
// preview/commit. Writes are admin-only under RLS (the F3.0.1 gate); every
// lifecycle event is audited per TE-10 (upload created, scan completed, scan
// failed, run cancelled). Scanned cells reach this boundary ALREADY
// SSN-redacted by src/lib/rosterImport (TE-6) — this service never sees a
// full SSN.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import { translateDbError } from "@/lib/dbErrors";
import { insertAssignmentRows } from "@/services/providerAssignments";
import type { ScannedRow } from "@/lib/rosterImport";
import type { BatchAssignmentPlan, CommitPlan, StagedImportRow } from "@/lib/importDedupe";
import type { ImportRun, ImportRunErrorEntry, ImportRunSource } from "@/types";

const RUN_LIST_LIMIT = 20;

export async function listImportRuns(): Promise<ImportRun[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_runs")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(RUN_LIST_LIMIT);
  if (error) throw error;
  return camelizeRow<ImportRun[]>(data ?? []);
}

export async function getImportRun(id: string): Promise<ImportRun | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<ImportRun>(data) : null;
}

export interface CreateImportRunInput {
  source: ImportRunSource;
  fileName: string;
  totalRows: number;
}

/** Insert the durable run header (state 'uploading'). The scan driver flips it
 * to 'scanning' as its first act, so a run that dies immediately is honestly
 * stale rather than invisible. */
export async function createImportRun(input: CreateImportRunInput): Promise<ImportRun> {
  const orgId = requireActiveOrg();
  const userId = currentUserId();
  if (!userId) throw new Error("No authenticated user");
  const { data, error } = await supabase
    .from("import_runs")
    .insert({
      org_id: orgId,
      created_by: userId,
      source: input.source,
      file_name: input.fileName,
      state: "uploading",
      total_rows: input.totalRows,
      staged_rows: 0,
      error_rows: 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  const run = camelizeRow<ImportRun>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "import_run",
    entityId: run.id,
    after: { id: run.id, source: run.source, fileName: run.fileName, totalRows: run.totalRows },
    description: `Roster import upload created (${run.fileName ?? "file"}, ${run.totalRows ?? 0} rows)`,
  });
  return run;
}

export async function markImportRunScanning(id: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from("import_runs")
    .update({ state: "scanning", updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("state", "uploading");
  if (error) throw error;
}

/** One batched chunk through the SECURITY DEFINER stage_import_rows RPC —
 * inserts the rows AND recomputes the run's staged/error counts in one round
 * trip. Idempotent under UNIQUE (run_id, line): a re-sent chunk neither
 * duplicates rows nor double-counts. */
export async function stageImportRows(runId: string, rows: ScannedRow[]): Promise<void> {
  if (rows.length === 0) return;
  // `supabase.rpc` must be called bound — extracting the method throws at call
  // time (CLAUDE.md gotcha).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpc("stage_import_rows", {
    p_run_id: runId,
    p_rows: rows.map((r) => ({
      line: r.line,
      raw: r.raw,
      mapped: r.mapped,
      row_state: r.rowState,
      error_column: r.errorColumn,
      error_reason: r.errorReason,
    })),
  });
  if (error) throw new Error(error.message);
}

/** Scan finished: land the run in ready_for_review with the compact error
 * report (the download source that survives the TE-7 purge). */
export async function completeImportRun(
  id: string,
  errorReport: ImportRunErrorEntry[],
): Promise<void> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_runs")
    .update({
      state: "ready_for_review",
      error_report: errorReport as never,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", id)
    .select("staged_rows, error_rows")
    .single();
  if (error) throw error;
  const counts = camelizeRow<{ stagedRows: number | null; errorRows: number | null }>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: id,
    after: { id, state: "ready_for_review", ...counts },
    description: `Roster import scan completed (${counts.stagedRows ?? 0} staged, ${counts.errorRows ?? 0} errors)`,
  });
}

/** Catastrophic scan failure (e.g. a staging batch kept failing): the run is
 * honestly 'failed' with the reason in error_report — never a silent hang. */
export async function failImportRun(id: string, reason: string): Promise<void> {
  const orgId = requireActiveOrg();
  const report: ImportRunErrorEntry[] = [{ line: 0, column: null, reason }];
  const { error } = await supabase
    .from("import_runs")
    .update({
      state: "failed",
      error_report: report as never,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: id,
    after: { id, state: "failed" },
    description: "Roster import scan failed",
  });
}

/** Cancel a run: PURGE its staged rows first (TE-7 — staged PII is deleted on
 * terminal transitions), then flip the run header. Re-running after a partial
 * failure deletes zero rows and still lands the state. */
export async function cancelImportRun(id: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { error: purgeError } = await supabase
    .from("import_rows")
    .delete()
    .eq("org_id", orgId)
    .eq("run_id", id);
  if (purgeError) throw purgeError;
  const { error } = await supabase
    .from("import_runs")
    .update({ state: "cancelled", updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: id,
    after: { id, state: "cancelled" },
    description: "Roster import run cancelled (staged rows purged)",
  });
}

/* ----------------------- E3.1 — preview + staged commit ----------------------- */

/** One run's staged rows — the dedupe/conflict input (src/lib/importDedupe).
 * Error rows stay out: they are already counted + reported on the run row. */
export async function listStagedImportRows(runId: string): Promise<StagedImportRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_rows")
    .select("line, mapped")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .eq("row_state", "staged")
    .order("line", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    line: r.line,
    mapped: (r.mapped as Record<string, string | null> | null) ?? null,
  }));
}

export interface CommitImportRunResult {
  alreadyCommitted: boolean;
  created: number;
  updated: number;
  createdProviderIds: string[];
  updatedProviderIds: string[];
}

/** Commit the run through the ONE transactional SECURITY DEFINER RPC (TE-5):
 * a failure rolls every live write back and the run stays ready_for_review
 * (resumable); a replay sees 'committed' and no-ops. The RPC writes the
 * run-level AND per-entity audit rows inside the transaction, so this service
 * deliberately does NOT also writeAudit (the E1.7b publish-RPC rule). */
export async function commitImportRun(
  runId: string,
  plan: CommitPlan,
): Promise<CommitImportRunResult> {
  requireActiveOrg();
  // `supabase.rpc` must be called bound (CLAUDE.md gotcha).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("commit_import_run", {
    p_run_id: runId,
    p_plan: plan as unknown as Record<string, unknown>,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as {
    already_committed?: boolean;
    created?: number;
    updated?: number;
    created_provider_ids?: string[] | null;
    updated_provider_ids?: string[] | null;
  };
  return {
    alreadyCommitted: Boolean(raw.already_committed),
    created: raw.created ?? 0,
    updated: raw.updated ?? 0,
    createdProviderIds: raw.created_provider_ids ?? [],
    updatedProviderIds: raw.updated_provider_ids ?? [],
  };
}

export interface BatchAssignmentResult {
  groupsAdded: number;
  facilitiesAdded: number;
  skippedProviders: number;
}

/** F3.1.5 — the one-shot batch assignment for a committed run's providers.
 * The plan comes from the pure planBatchAssignment (explicit row data wins —
 * only assignment GAPS are filled); both insert paths are idempotent under
 * the DB uniques (TE-7), so running it twice adds nothing. New facility
 * assignments carry the caller's start date (the pfa start_date CHECK
 * rejects dateless inserts). */
export async function applyBatchAssignment(input: {
  runId: string;
  groupId: string | null;
  facilityIds: string[];
  startDate: string;
  plan: BatchAssignmentPlan;
}): Promise<BatchAssignmentResult> {
  const orgId = requireActiveOrg();
  if (input.plan.groupInserts.length > 0) {
    const { error } = await supabase.from("provider_group_assignments").upsert(
      input.plan.groupInserts.map((g) => ({
        org_id: orgId,
        provider_id: g.providerId,
        group_id: g.groupId,
        is_primary: g.isPrimary,
      })),
      { onConflict: "provider_id,group_id", ignoreDuplicates: true },
    );
    if (error) throw translateDbError(error);
  }
  if (input.plan.facilityInserts.length > 0) {
    await insertAssignmentRows(
      input.plan.facilityInserts.map((f) => ({
        providerId: f.providerId,
        facilityId: f.facilityId,
        startDate: input.startDate,
      })),
    );
  }
  const result: BatchAssignmentResult = {
    groupsAdded: input.plan.groupInserts.length,
    facilitiesAdded: input.plan.facilityInserts.length,
    skippedProviders: input.plan.skippedProviderIds.length,
  };
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: input.runId,
    after: {
      id: input.runId,
      groupId: input.groupId,
      facilityIds: input.facilityIds,
      ...result,
    },
    description: "Batch assignment applied to imported providers",
  });
  return result;
}

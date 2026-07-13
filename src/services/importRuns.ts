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
import type { ScannedRow } from "@/lib/rosterImport";
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

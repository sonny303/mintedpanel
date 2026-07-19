// E2.4 TE-6/TE-8/TE-10 — the pure run-trace derivations: disposition counts
// from the immutable child rows (superseding the run's stored plan counts at
// read time, so the two can never disagree — TE-1), partial-batch honesty
// ("run ended early"), manual-vs-generated case origin (F2.4.2), and the
// derived reapply timeline (TE-6: lineage is recovered from append-only data
// — task creation clusters with their version stamps — never stored). No
// Supabase, no clock reads.

import { distinctStampPairs, type StampedTaskRef } from "@/lib/sopStamp";
import type { CaseGenerationRun, CaseGenerationRunRow, GenerationRowDisposition } from "@/types";

export const DISPOSITION_LABELS: Record<GenerationRowDisposition, string> = {
  created: "Created",
  skipped_existing: "Skipped — already exists",
  excluded: "Excluded",
  failed: "Failed",
  // E6.3 — the decoupled grid's two extra ledger buckets.
  skipped: "Skipped for now",
  enrolled: "Enrolled — fact",
};

// E4.2 SOP hardening — the dimensions generic-fallback usage is reportable by.
// (org is the RLS/query scope; these are the per-row grouping keys.)
export type RunRowDimension = "runId" | "payerId" | "state" | "groupId";

/** Count run rows by a chosen dimension (run / payer / state / group). Pure —
 * the caller pre-filters to the tier it cares about (e.g. generic_fallback),
 * so generic-fallback usage is countable per run, payer, state, and group. */
export function countRunRowsBy(
  rows: readonly Pick<CaseGenerationRunRow, RunRowDimension>[],
  dimension: RunRowDimension,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r[dimension];
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

export interface RunCounts {
  created: number;
  skippedExisting: number;
  excluded: number;
  failed: number;
  /** E6.3 — skip-for-now rows (stay in the buffer; zero on pre-E6.3 runs). */
  skipped: number;
  /** E6.3 — enrollment-fact-covered rows (zero on pre-E6.3 runs). */
  enrolled: number;
  recorded: number;
  /** true when no child rows exist and the counts are the run's stored
   * confirm-time PLAN (a pre-E2.4 run, or a run that died before recording
   * any row) — surfaced honestly, never passed off as outcomes. */
  fromPlan: boolean;
}

/** Counts for a run: derived from its disposition rows when any exist,
 * otherwise the stored plan (flagged). */
export function deriveRunCounts(
  run: Pick<
    CaseGenerationRun,
    "createdCount" | "skippedExistingCount" | "excludedCount" | "failedCount"
  >,
  rows: readonly Pick<CaseGenerationRunRow, "disposition">[],
): RunCounts {
  if (rows.length === 0) {
    return {
      created: run.createdCount,
      skippedExisting: run.skippedExistingCount,
      excluded: run.excludedCount,
      failed: run.failedCount,
      skipped: 0,
      enrolled: 0,
      recorded: 0,
      fromPlan: true,
    };
  }
  const count = (d: GenerationRowDisposition) => rows.filter((r) => r.disposition === d).length;
  return {
    created: count("created"),
    skippedExisting: count("skipped_existing"),
    excluded: count("excluded"),
    failed: count("failed"),
    skipped: count("skipped"),
    enrolled: count("enrolled"),
    recorded: rows.length,
    fromPlan: false,
  };
}

export interface RunRecordStatus {
  /** The confirm-time candidate total (proposed + skipped + excluded). */
  expected: number;
  recorded: number;
  /** rows < expected: the batch ended before every outcome was recorded —
   * shown honestly in run detail; no mutable run status exists to "fix" it. */
  endedEarly: boolean;
}

export function runRecordStatus(
  run: Pick<CaseGenerationRun, "proposedCount" | "skippedExistingCount" | "excludedCount">,
  rows: readonly unknown[],
): RunRecordStatus {
  const expected = run.proposedCount + run.skippedExistingCount + run.excludedCount;
  return { expected, recorded: rows.length, endedEarly: rows.length < expected };
}

// ---------- case provenance (F2.4.2) ----------

export interface CaseOriginInput {
  generationRunId?: string | null;
  createdByName?: string | null;
  createdAt: string;
}

export type CaseOrigin =
  | { kind: "generation"; runId: string; actorName: string | null; createdAt: string }
  | { kind: "manual"; actorName: string | null; createdAt: string };

/** Where a case came from: its generating run, or a manual origin (NULL run
 * id — every manual one-off and pre-E2.1 row, the E2.1 F2.1.4 contract). */
export function caseOrigin(c: CaseOriginInput): CaseOrigin {
  const actorName = c.createdByName ?? null;
  if (c.generationRunId) {
    return { kind: "generation", runId: c.generationRunId, actorName, createdAt: c.createdAt };
  }
  return { kind: "manual", actorName, createdAt: c.createdAt };
}

export interface TaskCycle {
  /** The cluster's shared creation timestamp (tasks born in one RPC call or
   * one reapply append share it). */
  createdAt: string;
  taskCount: number;
  /** Distinct (template, version) stamps in the cluster — the cycle's
   * procedure version(s); empty for legacy unstamped tasks. */
  stamps: Array<{ sopTemplateId: string; sopVersion: number }>;
}

/** TE-6 — the derived reapply timeline: tasks cluster by their creation
 * timestamp (each generation/reapply writes its task set in one statement,
 * so a cycle shares one created_at), ordered oldest first. One cluster =
 * the original set; a second+ cluster = a reapplication's appended set. */
export function deriveTaskCycles(
  tasks: readonly (StampedTaskRef & { createdAt?: string | null })[],
): TaskCycle[] {
  const byCreatedAt = new Map<string, (StampedTaskRef & { createdAt?: string | null })[]>();
  for (const t of tasks) {
    // The column is NOT NULL with a default, but a partial projection may
    // omit it — an unknown timestamp clusters together rather than throwing.
    const key = t.createdAt ?? "";
    byCreatedAt.set(key, [...(byCreatedAt.get(key) ?? []), t]);
  }
  return [...byCreatedAt.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([createdAt, cluster]) => ({
      createdAt,
      taskCount: cluster.length,
      stamps: distinctStampPairs(cluster),
    }));
}

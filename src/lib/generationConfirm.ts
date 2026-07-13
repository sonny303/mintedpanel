// E2.1 F2.1.2 / TE-3 — the batch confirm's skip/failure disposition logic as
// pure, unit-tested functions. The confirm loop itself (per-row
// create_case_with_tasks calls) lives in src/services/generationConfirm.ts;
// this module owns what the loop feeds on and reports: which preview rows are
// attempted, the confirm-time plan counts the immutable run row stores, and
// the outcome summary the UI and the run's audit row report.
//
// Batch semantics (TE-3): the RPC is not replay-idempotent — idempotence
// comes from per-row transactionality plus skip-on-unique-violation. A 23505
// on the 4-part key (including a concurrent duplicate confirm) degrades
// safely to a skipped_existing disposition, never a failure and never a
// half-created case.
//
// Deliberately absent (F2.1.5, [r4] Q3): NO prerequisite-payer logic of any
// kind — no blocking, flagging, or auto-creation from
// payers.prerequisite_payer_id, which stays dormant. Asserted by the unit
// suite at the code level.

import type { GenerationPreviewRow } from "@/lib/generationPreview";

export interface GenerationRunCounts {
  proposedCount: number;
  createdCount: number;
  skippedExistingCount: number;
  excludedCount: number;
  failedCount: number;
}

export interface GenerationConfirmPlan {
  /** Proposed rows — exactly the checked rows the confirm attempts. */
  toCreate: GenerationPreviewRow[];
  /** Existing-key rows, grayed in the preview and never attempted. */
  skippedExisting: GenerationPreviewRow[];
  /** Actively excluded rows, never attempted. */
  excluded: GenerationPreviewRow[];
  /** The confirm-time counts stored on the immutable case_generation_runs
   * row (inserted BEFORE the loop so created cases can FK it; no UPDATE
   * policy exists, so these are the plan — createdCount is the expected
   * outcome and failedCount 0). Actual outcomes are reported client-side and
   * in the run's audit row; E2.4's disposition rows supersede these at read
   * time. */
  plannedCounts: GenerationRunCounts;
}

export function planGenerationConfirm(
  rows: readonly GenerationPreviewRow[],
): GenerationConfirmPlan {
  const toCreate = rows.filter((r) => r.disposition === "proposed");
  const skippedExisting = rows.filter((r) => r.disposition === "existing");
  const excluded = rows.filter((r) => r.disposition === "excluded");
  return {
    toCreate,
    skippedExisting,
    excluded,
    plannedCounts: {
      proposedCount: toCreate.length,
      createdCount: toCreate.length,
      skippedExistingCount: skippedExisting.length,
      excludedCount: excluded.length,
      failedCount: 0,
    },
  };
}

export type GenerationRowOutcome =
  | { row: GenerationPreviewRow; disposition: "created"; caseId: string }
  | { row: GenerationPreviewRow; disposition: "skipped_existing" }
  | { row: GenerationPreviewRow; disposition: "failed"; message: string };

export interface GenerationConfirmSummary {
  created: number;
  /** Concurrent-duplicate skips observed DURING the loop (23505), on top of
   * the plan's never-attempted skippedExisting rows. */
  skippedExisting: number;
  failed: number;
  failures: Array<{ row: GenerationPreviewRow; message: string }>;
}

export function summarizeGenerationOutcomes(
  outcomes: readonly GenerationRowOutcome[],
): GenerationConfirmSummary {
  const failures = outcomes
    .filter((o): o is Extract<GenerationRowOutcome, { disposition: "failed" }> => {
      return o.disposition === "failed";
    })
    .map((o) => ({ row: o.row, message: o.message }));
  return {
    created: outcomes.filter((o) => o.disposition === "created").length,
    skippedExisting: outcomes.filter((o) => o.disposition === "skipped_existing").length,
    failed: failures.length,
    failures,
  };
}

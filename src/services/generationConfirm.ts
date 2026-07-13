// E2.1 F2.1.2 — the confirm loop behind the generation preview: one
// case_generation_runs row (inserted first, so every created case can carry
// its id), then one create_case_with_tasks call per checked row. Batch
// semantics per TE-3: each RPC call is its own transaction (a mid-batch
// failure never half-creates a single case) and a unique violation on the
// 4-part key — including a concurrent duplicate confirm — degrades safely to
// a skipped_existing disposition. After the loop, ONE audit row records the
// ACTUAL outcome counts against the run (the immutable run row stores the
// confirm-time plan; E2.4's disposition rows supersede both at read time).
//
// NO prerequisite-payer logic here (F2.1.5, [r4] Q3) — commercial and
// Medicare Advantage rows create and run in parallel.
import { writeAudit } from "@/lib/audit";
import { UniqueViolationError } from "@/lib/dbErrors";
import {
  summarizeGenerationOutcomes,
  type GenerationConfirmPlan,
  type GenerationConfirmSummary,
  type GenerationRowOutcome,
} from "@/lib/generationConfirm";
import type { GenerationPreviewRow } from "@/lib/generationPreview";
import { createCase, type CaseTaskPayload } from "@/services/cases";
import { recordGenerationRun } from "@/services/caseGenerationRuns";

export interface GenerationConfirmEntry {
  row: GenerationPreviewRow;
  /** Resolved from the SAME pickTemplate/resolveTemplate tier the manual and
   * launch flows use (E2.2 owns version stamping — stamps stay unset here). */
  tasks: CaseTaskPayload[];
}

export interface GenerationConfirmResult {
  runId: string;
  outcomes: GenerationRowOutcome[];
  summary: GenerationConfirmSummary;
}

export async function confirmGenerationBatch(
  plan: GenerationConfirmPlan,
  entries: GenerationConfirmEntry[],
): Promise<GenerationConfirmResult> {
  const run = await recordGenerationRun(plan.plannedCounts);

  const outcomes: GenerationRowOutcome[] = [];
  for (const entry of entries) {
    const { row } = entry;
    try {
      const created = await createCase(
        {
          providerId: row.providerId,
          payerId: row.payerId,
          state: row.state,
          groupId: row.groupId,
          generationRunId: run.id,
        },
        entry.tasks,
      );
      outcomes.push({ row, disposition: "created", caseId: created.id });
    } catch (e) {
      if (e instanceof UniqueViolationError) {
        outcomes.push({ row, disposition: "skipped_existing" });
      } else {
        outcomes.push({
          row,
          disposition: "failed",
          message: e instanceof Error ? e.message : "Case creation failed",
        });
      }
    }
  }

  const summary = summarizeGenerationOutcomes(outcomes);
  await writeAudit({
    actionType: "CREATE",
    entityType: "case_generation_run",
    entityId: run.id,
    after: {
      proposed: plan.plannedCounts.proposedCount,
      created: summary.created,
      skippedExisting: plan.plannedCounts.skippedExistingCount + summary.skippedExisting,
      excluded: plan.plannedCounts.excludedCount,
      failed: summary.failed,
    },
    description: `Confirmed case generation run: ${summary.created} created, ${
      plan.plannedCounts.skippedExistingCount + summary.skippedExisting
    } skipped (existing), ${plan.plannedCounts.excludedCount} excluded, ${summary.failed} failed`,
  });

  return { runId: run.id, outcomes, summary };
}

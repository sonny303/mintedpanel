// E2.1 F2.1.2 — the confirm loop behind the generation preview: one
// case_generation_runs row (inserted first, so every created case can carry
// its id), then one create_case_with_tasks call per checked row. Batch
// semantics per TE-3: each RPC call is its own transaction (a mid-batch
// failure never half-creates a single case) and a unique violation on the
// 4-part key — including a concurrent duplicate confirm — degrades safely to
// a skipped_existing disposition. After the loop, ONE audit row records the
// ACTUAL outcome counts against the run (the immutable run row stores the
// confirm-time plan; the E2.4 disposition child rows written throughout this
// loop are the authoritative per-row record, superseding both at read time).
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
import {
  EXCLUSION_REASON_LABELS,
  existingCaseIndicator,
  type GenerationPreviewRow,
} from "@/lib/generationPreview";
import { createCase, type CaseTaskPayload } from "@/services/cases";
import type { SopResolutionTier } from "@/lib/pickTemplate";
import {
  recordGenerationRun,
  recordGenerationRunRows,
  type GenerationRunRowInput,
} from "@/services/caseGenerationRuns";

export interface GenerationConfirmEntry {
  row: GenerationPreviewRow;
  /** Resolved from the SAME pickTemplate/resolveTemplate tier the manual and
   * launch flows use, version-stamped by the caller (E2.2 TE-2: the stamp is
   * the head snapshot the resolver consumed, threaded here as-is). */
  tasks: CaseTaskPayload[];
  /** E4.2 SOP hardening — the resolution provenance for THIS candidate, from the
   * SAME `pickTemplate` selection the tasks were stamped from, recorded on the
   * created run row so generic-fallback usage is countable per run. Null when no
   * template resolved. */
  provenance?: {
    sopTemplateId: string | null;
    sopVersion: number | null;
    sopResolutionTier: SopResolutionTier | null;
  } | null;
  /** Facility stamped at confirm time (primary or sole under the case's
   * group; null when ambiguous / none). Editable after create on case detail. */
  facilityId?: string | null;
}

export interface GenerationConfirmResult {
  runId: string;
  outcomes: GenerationRowOutcome[];
  summary: GenerationConfirmSummary;
}

/** E2.4 TE-1 — the disposition-row shape for one preview row. `outcome` may
 * additionally carry the E4.2 SOP resolution provenance for a `created` row. */
function runRowInput(
  runId: string,
  row: GenerationPreviewRow,
  outcome: Pick<
    GenerationRunRowInput,
    | "disposition"
    | "reason"
    | "caseId"
    | "exclusionId"
    | "sopTemplateId"
    | "sopVersion"
    | "sopResolutionTier"
  >,
): GenerationRunRowInput {
  return {
    runId,
    providerId: row.providerId,
    groupId: row.groupId,
    payerId: row.payerId,
    state: row.state,
    ...outcome,
  };
}

export async function confirmGenerationBatch(
  plan: GenerationConfirmPlan,
  entries: GenerationConfirmEntry[],
  releaseScope?: unknown,
): Promise<GenerationConfirmResult> {
  const run = await recordGenerationRun(plan.plannedCounts, releaseScope);

  // E2.4 TE-2: outcomes known AT CONFIRM are recorded first — grayed
  // existing rows (linking the BLOCKING case) and excluded rows (linking the
  // exclusion + snapshotting its reason label; never the note). Rows for the
  // attempted creations follow one by one as each RPC resolves, so a
  // mid-batch crash leaves a run whose record is visibly short — honest and
  // queryable, with no UPDATE anywhere.
  await recordGenerationRunRows([
    ...plan.skippedExisting.map((row) =>
      runRowInput(run.id, row, {
        disposition: "skipped_existing",
        reason: row.existingCase ? existingCaseIndicator(row.existingCase).label : "already exists",
        caseId: row.existingCase?.caseId ?? null,
      }),
    ),
    ...plan.excluded.map((row) =>
      runRowInput(run.id, row, {
        disposition: "excluded",
        reason: row.exclusion ? EXCLUSION_REASON_LABELS[row.exclusion.reason] : "Excluded",
        exclusionId: row.exclusion?.exclusionId ?? null,
      }),
    ),
    // E6.3 — the grid's two extra buckets, so the ledger accounts for EVERY
    // candidate: skip-for-now (stays in the buffer, no user reason demanded)
    // and enrolled-by-fact (never casework).
    ...(plan.skipped ?? []).map((row) =>
      runRowInput(run.id, row, {
        disposition: "skipped",
        reason: "Skipped for now — remains a candidate",
      }),
    ),
    ...(plan.enrolled ?? []).map((row) =>
      runRowInput(run.id, row, {
        disposition: "enrolled",
        reason: "Already enrolled — covered by an enrollment fact",
      }),
    ),
  ]);

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
          facilityId: entry.facilityId ?? null,
          generationRunId: run.id,
        },
        entry.tasks,
      );
      outcomes.push({ row, disposition: "created", caseId: created.id });
      await recordGenerationRunRows([
        runRowInput(run.id, row, {
          disposition: "created",
          reason: row.reason,
          caseId: created.id,
          // E4.2 — the SOP resolution provenance from the SAME pickTemplate
          // selection the tasks were stamped from (null when no template resolved).
          sopTemplateId: entry.provenance?.sopTemplateId ?? null,
          sopVersion: entry.provenance?.sopVersion ?? null,
          sopResolutionTier: entry.provenance?.sopResolutionTier ?? null,
        }),
      ]);
    } catch (e) {
      if (e instanceof UniqueViolationError) {
        outcomes.push({ row, disposition: "skipped_existing" });
        // The constraint rejected the insert, so the blocking case's id is
        // unknown here — the reason says why the link is absent.
        await recordGenerationRunRows([
          runRowInput(run.id, row, {
            disposition: "skipped_existing",
            reason: "already exists — created concurrently by another confirm",
          }),
        ]);
      } else {
        const message = e instanceof Error ? e.message : "Case creation failed";
        outcomes.push({ row, disposition: "failed", message });
        await recordGenerationRunRows([
          runRowInput(run.id, row, { disposition: "failed", reason: message }),
        ]);
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
      // E6.3 buckets (zero on pre-grid confirms).
      skipped: (plan.skipped ?? []).length,
      enrolled: (plan.enrolled ?? []).length,
    },
    description: `Confirmed case generation run: ${summary.created} created, ${
      plan.plannedCounts.skippedExistingCount + summary.skippedExisting
    } skipped (existing), ${plan.plannedCounts.excludedCount} excluded, ${summary.failed} failed`,
  });

  return { runId: run.id, outcomes, summary };
}

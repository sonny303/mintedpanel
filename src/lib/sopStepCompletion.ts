// S4.3 — the pure reference rules for completing one SOP step. MINT-19 moved
// persisted Panel and extension completions into one SQL transaction; this
// helper remains a small executable description of the ordering and rollup
// contract for focused rule tests. It no longer writes task state.
// Pure — callers supply the actor and clock for the reference plan.
import type { SOPStep } from "@/types";

export type StepCompletionPlan =
  | { ok: true; nextSteps: SOPStep[]; allDone: boolean }
  // The step exists but an EARLIER incomplete step blocks it; `blockedBy` is
  // that step's label, so both surfaces can say the same thing.
  | { ok: false; reason: "blocked"; blockedBy: string }
  | { ok: false; reason: "not_found" };

/** Plan the step tick. Returns the full next steps array (the jsonb the caller
 * writes) plus whether every step is now complete. */
export function planStepCompletion(
  steps: readonly SOPStep[],
  stepId: string,
  userId: string | null,
  nowIso: string,
): StepCompletionPlan {
  const target = steps.find((step) => step.id === stepId);
  if (!target) return { ok: false, reason: "not_found" };

  // Steps run in order: an earlier incomplete step blocks this one. Checked
  // against `order`, not array position, so a reordered payload can't skip it.
  const blocker = steps.find((step) => step.order < target.order && !step.isCompleted);
  if (blocker) return { ok: false, reason: "blocked", blockedBy: blocker.label };

  const nextSteps: SOPStep[] = steps.map((step) =>
    step.id === stepId
      ? { ...step, isCompleted: true, completedAt: nowIso, completedBy: userId }
      : step,
  );
  return { ok: true, nextSteps, allDone: nextSteps.every((s) => s.isCompleted) };
}

/** The task-row patch a completion implies: the steps jsonb always, plus the
 * status rollup — all steps done completes the task, and the first tick moves
 * a not-yet-started task to in_progress. Column names are snake_case because
 * this is the write payload both callers hand to PostgREST. */
export function stepCompletionPatch(
  plan: Extract<StepCompletionPlan, { ok: true }>,
  currentStatus: string,
  nowIso: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { sop_content: plan.nextSteps };
  if (plan.allDone) {
    patch.status = "completed";
    patch.completed_date = nowIso.slice(0, 10);
  } else if (currentStatus === "not_started") {
    patch.status = "in_progress";
  }
  return patch;
}

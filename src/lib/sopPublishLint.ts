// E4.2 F4.2.1 (PM round-4) — minimum-content publish lint.
// Publish (and the wizard's Review step) rejects an SOP that is empty or a
// placeholder so a payer can never flip to Ready on a hollow template:
//   - at least one task,
//   - every task has at least one step,
//   - no blank or default "New step"/"New task" labels.
// Pure; enforced in the wizard — the only publish surface.

import type { SOPTaskDefinition } from "@/types";

/** Default placeholder labels the wizard seeds a fresh row with — these must be
 * renamed before publish. Compared case-insensitively after trimming. */
const PLACEHOLDER_LABELS = new Set(["", "new step", "new task", "untitled", "untitled task"]);

function isPlaceholder(label: string | undefined | null): boolean {
  return PLACEHOLDER_LABELS.has((label ?? "").trim().toLowerCase());
}

export interface SopLintError {
  /** 1-based task index the error is anchored to (0 when it's a whole-SOP rule). */
  taskIndex: number;
  /** 1-based step index within the task, when the error is step-scoped. */
  stepIndex?: number;
  message: string;
}

export interface SopLintResult {
  ok: boolean;
  errors: SopLintError[];
}

/** Validate the minimum publish content. Returns every violation (not just the
 * first) so the wizard can surface them all. */
export function lintSopForPublish(tasks: readonly SOPTaskDefinition[]): SopLintResult {
  const errors: SopLintError[] = [];

  if (tasks.length === 0) {
    errors.push({ taskIndex: 0, message: "Add at least one task before publishing." });
    return { ok: false, errors };
  }

  tasks.forEach((task, ti) => {
    const taskNo = ti + 1;
    if (isPlaceholder(task.title)) {
      errors.push({ taskIndex: taskNo, message: `Task ${taskNo} needs a name.` });
    }
    const steps = task.steps ?? [];
    if (steps.length === 0) {
      errors.push({
        taskIndex: taskNo,
        message: `Task ${taskNo} ("${task.title || "Untitled"}") needs at least one step.`,
      });
      return;
    }
    steps.forEach((step, si) => {
      if (isPlaceholder(step.label)) {
        errors.push({
          taskIndex: taskNo,
          stepIndex: si + 1,
          message: `Task ${taskNo}, step ${si + 1} needs a label.`,
        });
      }
    });
  });

  return { ok: errors.length === 0, errors };
}

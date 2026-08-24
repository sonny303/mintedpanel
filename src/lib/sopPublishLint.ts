// E4.2 F4.2.1 (PM round-4) — minimum-content publish lint.
// Publish (and the wizard's Review step) rejects an SOP that is empty or a
// placeholder so a payer can never flip to Ready on a hollow template:
//   - at least one task,
//   - every task has at least one step,
//   - no blank or default "New step"/"New task" labels,
//   - E1.7b F1.7b.5 (TE-16): every draft-email step has ≥1 To recipient, every
//     literal recipient is a valid email address, and every token recipient is
//     an email-valued token (source validity, not value — an authored
//     provider.email is valid before generation).
//   - BITE-SOP-TT-01: every Auto-fill (extension_fill) task has ≥1 online_form
//     step with a non-empty portalKey (so Workbench/form readiness can bind).
//   - Payer PDF: every authored payer-form step has a form uploaded (a
//     `payerForm` pointer with a non-empty familyId) — tagged
//     `rule: "payer_form_missing"` so the wizard's initial Create can defer
//     just this one rule (a brand-new template has no id yet for the form's
//     FK to attach to) while every other rule, and this rule on every publish
//     thereafter, stays a hard blocker.
// Pure; enforced in the wizard — the only publish surface.

import type { SOPTaskDefinition } from "@/types";
import { resolveExecutionType } from "@/lib/executionTypes";
import { isEmailValuedToken } from "@/lib/sopResolver";
import { isValidEmail } from "@/lib/contactValidation";
import { normalizePortalKey } from "@/lib/tokenFormat";

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
  /**
   * `"payer_form_missing"` tags the one rule a brand-new template can never
   * satisfy on its FIRST save: `payer_forms.template_id` is a real FK, so the
   * form cannot be uploaded before the template row exists. The wizard's
   * initial Create is the one caller allowed to defer this specific rule
   * (create anyway, land the author back in the now-real template to
   * upload); every other rule, and every rule on every publish after that
   * first create, stays a hard blocker. Untagged for every other rule.
   */
  rule?: "payer_form_missing";
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
      const stepNo = si + 1;
      if (isPlaceholder(step.label)) {
        errors.push({
          taskIndex: taskNo,
          stepIndex: stepNo,
          message: `Task ${taskNo}, step ${stepNo} needs a label.`,
        });
      }
      // E1.7b F1.7b.5 (TE-16) — a draft-email step needs ≥1 To recipient; every
      // literal recipient must be a valid address and every token recipient an
      // email-valued token. This validates recipient SOURCE, not value: an
      // authored provider.email token is valid at publish even though its value
      // is unknown until generation (AQ1). Legacy immutable versions are never
      // re-linted — this only runs on a new publish's authored content.
      if (step.stepType === "draft_email") {
        const to = step.emailTemplate?.to ?? [];
        const cc = step.emailTemplate?.cc ?? [];
        if (to.length === 0) {
          errors.push({
            taskIndex: taskNo,
            stepIndex: stepNo,
            message: `Task ${taskNo}, step ${stepNo} (draft email) needs at least one "To" recipient.`,
          });
        }
        for (const r of [...to, ...cc]) {
          if (r.source === "literal" && !isValidEmail(r.address)) {
            errors.push({
              taskIndex: taskNo,
              stepIndex: stepNo,
              message: `Task ${taskNo}, step ${stepNo} has an invalid recipient email address ("${r.address}").`,
            });
          } else if (r.source === "token" && !isEmailValuedToken(r.token)) {
            errors.push({
              taskIndex: taskNo,
              stepIndex: stepNo,
              message: `Task ${taskNo}, step ${stepNo} recipient token "${r.token}" is not an email field.`,
            });
          }
        }
      }
      // Payer PDF — an action that promises the coordinator a payer form must
      // actually carry one. `payerForm` present with an empty familyId is the
      // authored "file not chosen yet" state; publishing it would generate a
      // checklist item with nothing to download. A legacy "pdf" step (no
      // payerForm key) is a plain step and is not linted.
      if (step.stepType === "pdf" && step.payerForm !== undefined) {
        if (!step.payerForm.familyId) {
          errors.push({
            taskIndex: taskNo,
            stepIndex: stepNo,
            message: `Task ${taskNo}, step ${stepNo} (payer PDF) needs a form uploaded.`,
            rule: "payer_form_missing",
          });
        }
      }
    });

    // BITE-SOP-TT-01 — Auto-fill requires ≥1 online_form step with a portal.
    // Hard-blocks publish the same way draft-email To does: without a linked
    // portal the extension cannot tee up and form readiness is a lie.
    if (resolveExecutionType(task.executionType) === "extension_fill") {
      const onlineFormIndexes: number[] = [];
      steps.forEach((step, si) => {
        if (step.stepType === "online_form") onlineFormIndexes.push(si);
      });
      if (onlineFormIndexes.length === 0) {
        errors.push({
          taskIndex: taskNo,
          message: `Task ${taskNo} (Auto-fill) needs at least one online form step.`,
        });
      } else {
        for (const si of onlineFormIndexes) {
          if (normalizePortalKey(steps[si].portalKey)) continue;
          const stepNo = si + 1;
          errors.push({
            taskIndex: taskNo,
            stepIndex: stepNo,
            message: `Task ${taskNo}, step ${stepNo} (online form) needs a portal.`,
          });
        }
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

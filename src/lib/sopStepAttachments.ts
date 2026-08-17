// ASD (Active Submission Drawer rebuild) — the pure rules for attaching/
// detaching a file on a SOP step's requiredArtifacts checklist. Mirrors
// sopStepCompletion.ts: pure, caller supplies the clock/ids, the service
// layer writes the resulting sop_content patch. Two rules matter enough to
// state explicitly:
//
//   1. ATTACH APPENDS, never replaces (D-ASD-5) — a second file under one
//      artifact name sits alongside the first; `stepArtifactRows` in
//      documents.ts is what renders every attachment, newest first.
//   2. Attaching/detaching NEVER touches step completion or task status
//      (D-ASD-6). `planStepCompletion`/`stepCompletionPatch` are a separate
//      concern this module deliberately does not call — Required Documents
//      and readiness read `provider_documents` directly, never sop_content,
//      so the vault stays the single source of truth for "do we have this
//      credential" regardless of what a step's checklist shows.
//
// Detach unlinks only — it is not a delete. The underlying `provider_documents`
// row (and the file in Storage) is untouched; detaching is reachable through
// this module alone.
import type { SOPStep, SOPStepAttachment } from "@/types";

export type StepAttachmentPlan =
  | { ok: true; nextSteps: SOPStep[] }
  | { ok: false; reason: "step_not_found" }
  | { ok: false; reason: "attachment_not_found" };

/** Append one attachment to a step's checklist. Always succeeds if the step
 * exists — an artifact name with no matching requiredArtifacts entry still
 * attaches (it renders as an orphan, per stepArtifactRows; a name that
 * genuinely doesn't belong is a template-authoring problem, not something
 * this write should silently reject). */
export function planAttachStepArtifact(
  steps: readonly SOPStep[],
  stepId: string,
  attachment: SOPStepAttachment,
): StepAttachmentPlan {
  const target = steps.find((step) => step.id === stepId);
  if (!target) return { ok: false, reason: "step_not_found" };

  const nextSteps: SOPStep[] = steps.map((step) =>
    step.id === stepId ? { ...step, attachments: [...(step.attachments ?? []), attachment] } : step,
  );
  return { ok: true, nextSteps };
}

/** Remove one attachment by documentId. Unlinks only — never deletes the
 * vault document. A documentId not present on the step is a no-op failure
 * (nothing to detach), not silently ignored. */
export function planDetachStepArtifact(
  steps: readonly SOPStep[],
  stepId: string,
  documentId: string,
): StepAttachmentPlan {
  const target = steps.find((step) => step.id === stepId);
  if (!target) return { ok: false, reason: "step_not_found" };
  const attachments = target.attachments ?? [];
  if (!attachments.some((a) => a.documentId === documentId)) {
    return { ok: false, reason: "attachment_not_found" };
  }

  const nextSteps: SOPStep[] = steps.map((step) =>
    step.id === stepId
      ? { ...step, attachments: attachments.filter((a) => a.documentId !== documentId) }
      : step,
  );
  return { ok: true, nextSteps };
}

/** The task-row patch a plan implies: sop_content only. Deliberately does NOT
 * touch status/completed_date — see the module header (D-ASD-6). */
export function stepAttachmentPatch(
  plan: Extract<StepAttachmentPlan, { ok: true }>,
): Record<string, unknown> {
  return { sop_content: plan.nextSteps };
}

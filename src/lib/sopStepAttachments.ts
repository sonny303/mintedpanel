// TS-163 — the pure rules for attaching/detaching a file on one SOP step's
// requiredArtifacts checklist, shared by the browser write path
// (src/services/tasks.ts attachStepArtifact/detachStepArtifact). Mirrors
// sopStepCompletion.ts exactly: pure planner + a thin service that re-reads
// the task, plans, and PATCHes sop_content as one write. Pure — the caller
// supplies the actor and the clock; nothing here touches Supabase.
import type { SOPStep, SOPStepAttachment } from "@/types";

export type StepAttachmentPlan =
  { ok: true; nextSteps: SOPStep[] } | { ok: false; reason: "not_found" };

/** Attach `attachment` to `stepId`'s attachments array. Appends rather than
 * replacing by artifact name — a re-upload for the same artifact keeps the
 * prior attachment alongside the new one; the caller (StepArtifactsPanel)
 * is responsible for calling `detachStepArtifact` first on an explicit
 * replace so history isn't silently doubled. */
export function planAttachStepArtifact(
  steps: readonly SOPStep[],
  stepId: string,
  attachment: SOPStepAttachment,
): StepAttachmentPlan {
  const target = steps.find((step) => step.id === stepId);
  if (!target) return { ok: false, reason: "not_found" };

  const nextSteps: SOPStep[] = steps.map((step) =>
    step.id === stepId ? { ...step, attachments: [...(step.attachments ?? []), attachment] } : step,
  );
  return { ok: true, nextSteps };
}

/** Remove one attachment by documentId. A no-op removal (id not present)
 * still succeeds — the caller may be clearing a stale reference. */
export function planDetachStepArtifact(
  steps: readonly SOPStep[],
  stepId: string,
  documentId: string,
): StepAttachmentPlan {
  const target = steps.find((step) => step.id === stepId);
  if (!target) return { ok: false, reason: "not_found" };

  const nextSteps: SOPStep[] = steps.map((step) =>
    step.id === stepId
      ? {
          ...step,
          attachments: (step.attachments ?? []).filter((a) => a.documentId !== documentId),
        }
      : step,
  );
  return { ok: true, nextSteps };
}

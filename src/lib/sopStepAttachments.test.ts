import { describe, it, expect } from "vitest";
import {
  planAttachStepArtifact,
  planDetachStepArtifact,
  stepAttachmentPatch,
} from "./sopStepAttachments";
import type { SOPStep, SOPStepAttachment } from "@/types";

function step(id: string, attachments?: SOPStepAttachment[]): SOPStep {
  return { id, order: 1, label: `Step ${id}`, isCompleted: false, attachments } as SOPStep;
}

function attachment(documentId: string, artifactName = "W-9"): SOPStepAttachment {
  return {
    documentId,
    artifactName,
    fileName: `${documentId}.pdf`,
    uploadedAt: "2026-08-17T10:00:00.000Z",
    uploadedBy: "u1",
    kind: "w9",
  };
}

describe("planAttachStepArtifact", () => {
  it("appends an attachment to the named step", () => {
    const plan = planAttachStepArtifact([step("a"), step("b")], "a", attachment("doc-1"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const a = plan.nextSteps.find((s) => s.id === "a");
    expect(a?.attachments).toEqual([attachment("doc-1")]);
    // Untouched steps are carried through unchanged.
    expect(plan.nextSteps.find((s) => s.id === "b")?.attachments).toBeUndefined();
  });

  it("appends alongside an existing attachment — never replaces (D-ASD-5)", () => {
    const existing = attachment("doc-1");
    const plan = planAttachStepArtifact([step("a", [existing])], "a", attachment("doc-2"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps[0].attachments).toEqual([existing, attachment("doc-2")]);
  });

  it("attaches even when the artifact name has no requiredArtifacts entry (orphan, allowed)", () => {
    const plan = planAttachStepArtifact([step("a")], "a", attachment("doc-1", "Unlisted Thing"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps[0].attachments).toEqual([attachment("doc-1", "Unlisted Thing")]);
  });

  it("returns step_not_found for an unknown step id", () => {
    expect(planAttachStepArtifact([step("a")], "zzz", attachment("doc-1"))).toEqual({
      ok: false,
      reason: "step_not_found",
    });
  });
});

describe("planDetachStepArtifact", () => {
  it("removes the named attachment by documentId — unlinks, does not touch other attachments", () => {
    const keep = attachment("doc-2");
    const plan = planDetachStepArtifact([step("a", [attachment("doc-1"), keep])], "a", "doc-1");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps[0].attachments).toEqual([keep]);
  });

  it("returns attachment_not_found when the documentId isn't on the step", () => {
    const plan = planDetachStepArtifact([step("a", [attachment("doc-1")])], "a", "doc-999");
    expect(plan).toEqual({ ok: false, reason: "attachment_not_found" });
  });

  it("returns attachment_not_found for a step with no attachments at all", () => {
    const plan = planDetachStepArtifact([step("a")], "a", "doc-1");
    expect(plan).toEqual({ ok: false, reason: "attachment_not_found" });
  });

  it("returns step_not_found for an unknown step id", () => {
    expect(planDetachStepArtifact([step("a", [attachment("doc-1")])], "zzz", "doc-1")).toEqual({
      ok: false,
      reason: "step_not_found",
    });
  });
});

describe("stepAttachmentPatch", () => {
  it("returns ONLY sop_content — never status/completed_date (D-ASD-6)", () => {
    const plan = planAttachStepArtifact([step("a")], "a", attachment("doc-1"));
    if (!plan.ok) throw new Error("expected ok");
    const patch = stepAttachmentPatch(plan);
    expect(patch).toEqual({ sop_content: plan.nextSteps });
    expect(Object.keys(patch)).toEqual(["sop_content"]);
    expect(patch.status).toBeUndefined();
    expect(patch.completed_date).toBeUndefined();
  });

  it("same contract on a detach plan", () => {
    const plan = planDetachStepArtifact([step("a", [attachment("doc-1")])], "a", "doc-1");
    if (!plan.ok) throw new Error("expected ok");
    const patch = stepAttachmentPatch(plan);
    expect(patch).toEqual({ sop_content: plan.nextSteps });
    expect(Object.keys(patch)).toEqual(["sop_content"]);
  });
});

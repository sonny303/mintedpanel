import { describe, expect, it } from "vitest";
import { planAttachStepArtifact, planDetachStepArtifact } from "./sopStepAttachments";
import type { SOPStep, SOPStepAttachment } from "@/types";

function step(id: string, attachments?: SOPStepAttachment[]): SOPStep {
  return {
    id,
    order: 1,
    label: `Step ${id}`,
    isCompleted: false,
    requiredArtifacts: ["Submission confirmation PDF"],
    attachments,
  } as SOPStep;
}

function attachment(
  documentId: string,
  artifactName = "Submission confirmation PDF",
): SOPStepAttachment {
  return {
    documentId,
    artifactName,
    fileName: "confirmation.pdf",
    uploadedAt: "2026-08-16T10:00:00.000Z",
    uploadedBy: "u1",
    kind: "filled_form",
  };
}

describe("planAttachStepArtifact", () => {
  it("appends to an empty attachments array", () => {
    const plan = planAttachStepArtifact([step("a")], "a", attachment("d1"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps[0].attachments).toEqual([attachment("d1")]);
  });

  it("appends alongside an existing attachment rather than replacing it", () => {
    const plan = planAttachStepArtifact([step("a", [attachment("d1")])], "a", attachment("d2"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps[0].attachments?.map((a) => a.documentId)).toEqual(["d1", "d2"]);
  });

  it("leaves other steps untouched", () => {
    const plan = planAttachStepArtifact([step("a"), step("b")], "a", attachment("d1"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps.find((s) => s.id === "b")?.attachments).toBeUndefined();
  });

  it("returns not_found for an unknown step id", () => {
    expect(planAttachStepArtifact([step("a")], "zzz", attachment("d1"))).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("planDetachStepArtifact", () => {
  it("removes the matching attachment by documentId", () => {
    const plan = planDetachStepArtifact(
      [step("a", [attachment("d1"), attachment("d2")])],
      "a",
      "d1",
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps[0].attachments?.map((a) => a.documentId)).toEqual(["d2"]);
  });

  it("is a harmless no-op when the documentId isn't present", () => {
    const plan = planDetachStepArtifact([step("a", [attachment("d1")])], "a", "missing");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.nextSteps[0].attachments?.map((a) => a.documentId)).toEqual(["d1"]);
  });

  it("returns not_found for an unknown step id", () => {
    expect(planDetachStepArtifact([step("a")], "zzz", "d1")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

import { describe, expect, it } from "vitest";
import { portalKeyConflicts, type EditableStep, type EditableTask } from "./editableTemplate";

function step(partial: Partial<EditableStep>): EditableStep {
  return {
    id: "s",
    label: "",
    detail: "",
    stepType: "online_form",
    emailTemplate: { subject: "", body: "" },
    dataFields: [],
    portalKey: "",
    ...partial,
  };
}

function task(steps: EditableStep[], title = "Task"): EditableTask {
  return { id: "t", title, description: "", dueOffsetDays: 0, steps };
}

describe("portalKeyConflicts", () => {
  it("passes when at most one distinct portal key per task", () => {
    expect(
      portalKeyConflicts([
        task([step({ portalKey: "bcbs_ks_enrollment" }), step({ portalKey: "" })]),
        task([step({})]),
      ]),
    ).toEqual([]);
  });

  it("treats case/whitespace variants of the same key as one portal", () => {
    expect(
      portalKeyConflicts([
        task([
          step({ portalKey: "BCBS_KS_Enrollment " }),
          step({ portalKey: "bcbs_ks_enrollment" }),
        ]),
      ]),
    ).toEqual([]);
  });

  it("flags a task whose steps carry two different portal keys", () => {
    const out = portalKeyConflicts([
      task([step({ portalKey: "availity" }), step({ portalKey: "bcbs_ks_enrollment" })], "Enroll"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].taskIdx).toBe(0);
    expect(out[0].title).toBe("Enroll");
    expect(out[0].keys.sort()).toEqual(["availity", "bcbs_ks_enrollment"]);
  });

  it("ignores portal keys on non-online_form steps", () => {
    expect(
      portalKeyConflicts([
        task([
          step({ portalKey: "availity" }),
          step({ portalKey: "bcbs_ks_enrollment", stepType: "draft_email" }),
        ]),
      ]),
    ).toEqual([]);
  });
});

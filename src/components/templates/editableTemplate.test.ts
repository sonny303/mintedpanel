// E1.7b — the wizard's editable round-trip must carry the step-shape
// extension (fax/phone/mail step types, turnaround/cadence day counts,
// required artifacts) or authoring would silently drop what resolution was
// taught to keep. fromEditable omits unset optional fields so stored jsonb
// stays minimal, exactly like portalKey.
import { describe, expect, it } from "vitest";
import { fromEditable, portalKeyConflicts, taskPortalKeys, toEditable } from "./editableTemplate";
import type { SOPTaskDefinition } from "@/types";

// Already in the writer's normalized form (detail/dataFields always present)
// so the first round-trip is the identity.
const DEFS: SOPTaskDefinition[] = [
  {
    title: "Submit BCBS-KS enrollment",
    description: "Portal submission",
    sortOrder: 0,
    dueOffsetDays: 5,
    steps: [
      {
        label: "Fill the BCBS-KS enrollment portal",
        detail: "",
        stepType: "online_form",
        portalKey: "bcbs_ks_enrollment",
        requiredArtifacts: ["Portal confirmation number"],
        dataFields: [{ label: "Type 1 NPI", token: "provider.npi" }],
      },
      {
        label: "Fax the W-9 if the portal upload fails",
        detail: "",
        stepType: "fax",
        dataFields: [],
      },
    ],
  },
  {
    title: "Follow up until BCBS-KS approves",
    description: "",
    sortOrder: 1,
    dueOffsetDays: 60,
    steps: [
      {
        label: "Status call to BCBS-KS provider relations",
        detail: "",
        stepType: "phone",
        expectedTurnaroundDays: 60,
        followUpEveryDays: 14,
        dataFields: [],
      },
      {
        label: "Mail the countersigned contract",
        detail: "",
        stepType: "mail",
        dataFields: [],
      },
    ],
  },
];

describe("editableTemplate round-trip (E1.7b step shape)", () => {
  it("round-trips the extended step fields through toEditable → fromEditable", () => {
    const out = fromEditable(toEditable(DEFS));
    expect(out).toEqual(DEFS);
  });

  it("is a fixed point (normalizing twice changes nothing)", () => {
    const once = fromEditable(toEditable(DEFS));
    const twice = fromEditable(toEditable(once));
    expect(twice).toEqual(once);
  });

  it("omits unset cadence fields and empty artifact lists on write", () => {
    const out = fromEditable(
      toEditable([{ title: "T", steps: [{ label: "Plain", stepType: "online_form" }] }]),
    );
    const step = out[0].steps[0];
    expect("expectedTurnaroundDays" in step).toBe(false);
    expect("followUpEveryDays" in step).toBe(false);
    expect("requiredArtifacts" in step).toBe(false);
  });

  it("drops blank artifact rows and trims the rest", () => {
    const editable = toEditable([{ title: "T", steps: [{ label: "S" }] }]);
    editable[0].steps[0].requiredArtifacts = ["  Submission PDF  ", "", "   "];
    const step = fromEditable(editable)[0].steps[0];
    expect(step.requiredArtifacts).toEqual(["Submission PDF"]);
  });
});

// One portal per task: the extension closes exactly one task per portal
// submission, so a task must resolve to a single portal or the close-out target
// is ambiguous. Build tasks through toEditable (the real wizard shape) so these
// helpers can't drift from the editable interface.
function onlineFormStep(portalKey: string): SOPTaskDefinition["steps"][number] {
  return { label: "Fill the portal", stepType: "online_form", portalKey };
}

describe("portalKeyConflicts (one portal per task)", () => {
  it("allows two steps in one task carrying the same normalized portal key", () => {
    const tasks = toEditable([
      { title: "Enroll", steps: [onlineFormStep("availity"), onlineFormStep("availity")] },
    ]);
    expect(portalKeyConflicts(tasks)).toEqual([]);
  });

  it("treats case/whitespace variants of a key as one portal", () => {
    const tasks = toEditable([
      {
        title: "Enroll",
        steps: [onlineFormStep("BCBS_KS_Enrollment "), onlineFormStep("bcbs_ks_enrollment")],
      },
    ]);
    expect(portalKeyConflicts(tasks)).toEqual([]);
  });

  it("flags a task whose online-form steps carry two distinct portal keys", () => {
    const tasks = toEditable([
      {
        title: "Enroll",
        steps: [onlineFormStep("availity"), onlineFormStep("bcbs_ks_enrollment")],
      },
    ]);
    const out = portalKeyConflicts(tasks);
    expect(out).toHaveLength(1);
    expect(out[0].taskIdx).toBe(0);
    expect(out[0].title).toBe("Enroll");
    expect([...out[0].keys].sort()).toEqual(["availity", "bcbs_ks_enrollment"]);
  });

  it("does not flag distinct portals used across different tasks", () => {
    const tasks = toEditable([
      { title: "Availity task", steps: [onlineFormStep("availity")] },
      { title: "BCBS task", steps: [onlineFormStep("bcbs_ks_enrollment")] },
    ]);
    expect(portalKeyConflicts(tasks)).toEqual([]);
  });

  it("ignores portal keys carried on non-online-form steps", () => {
    const tasks = toEditable([
      {
        title: "Enroll",
        steps: [
          onlineFormStep("availity"),
          { label: "Draft the email", stepType: "draft_email", portalKey: "bcbs_ks_enrollment" },
        ],
      },
    ]);
    expect(portalKeyConflicts(tasks)).toEqual([]);
  });

  it("stays backward compatible with legacy steps that have no portal key", () => {
    const tasks = toEditable([
      {
        title: "Legacy",
        steps: [{ label: "Online step", stepType: "online_form" }, onlineFormStep("availity")],
      },
    ]);
    expect(portalKeyConflicts(tasks)).toEqual([]);
  });
});

describe("taskPortalKeys", () => {
  it("returns the distinct normalized online-form keys of a task", () => {
    const [task] = toEditable([
      {
        title: "Enroll",
        steps: [
          onlineFormStep(" Availity "),
          onlineFormStep("availity"),
          onlineFormStep("bcbs_ks_enrollment"),
        ],
      },
    ]);
    expect([...taskPortalKeys(task)].sort()).toEqual(["availity", "bcbs_ks_enrollment"]);
  });

  it("is empty for legacy steps without portal keys", () => {
    const [task] = toEditable([{ title: "T", steps: [{ label: "S", stepType: "online_form" }] }]);
    expect(taskPortalKeys(task)).toEqual([]);
  });
});

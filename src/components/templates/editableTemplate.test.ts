// E1.7b — the wizard's editable round-trip must carry the step-shape
// extension (fax/phone/mail step types, turnaround/cadence day counts,
// required artifacts) or authoring would silently drop what resolution was
// taught to keep. fromEditable omits unset optional fields so stored jsonb
// stays minimal, exactly like portalKey.
import { describe, expect, it } from "vitest";
import {
  actionNamePatch,
  createActionFromPreset,
  executionTypeForActionMode,
  fromEditable,
  isCollapsedAction,
  portalKeyConflicts,
  taskPortalKeys,
  toEditable,
} from "./editableTemplate";
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

// E1.7b F1.7b.5 (TE-15) — draft-email recipients survive toEditable∘fromEditable,
// are written ONLY for draft_email steps, keep their source, and drop blanks.
const DEFS_EMAIL: SOPTaskDefinition[] = [
  {
    title: "Apply to Optum",
    description: "",
    sortOrder: 0,
    dueOffsetDays: 0,
    steps: [
      {
        label: "Draft the Optum application email",
        detail: "",
        stepType: "draft_email",
        emailTemplate: {
          subject: "Application for {{provider.firstName}}",
          body: "Please enroll {{provider.firstName}}.",
          to: [{ source: "literal", address: "network_PhysicalHealth@optum.com" }],
          cc: [{ source: "token", token: "provider.email" }],
        },
        dataFields: [],
      },
    ],
  },
];

describe("editableTemplate draft-email recipients (E1.7b F1.7b.5)", () => {
  it("round-trips literal + token To/CC through toEditable → fromEditable", () => {
    expect(fromEditable(toEditable(DEFS_EMAIL))).toEqual(DEFS_EMAIL);
  });

  it("omits empty to/cc so a recipient-less draft_email step stays minimal", () => {
    const out = fromEditable(
      toEditable([
        {
          title: "T",
          steps: [
            {
              label: "Legacy email",
              stepType: "draft_email",
              emailTemplate: { subject: "s", body: "b" },
            },
          ],
        },
      ]),
    );
    const step = out[0].steps[0];
    expect("to" in step.emailTemplate!).toBe(false);
    expect("cc" in step.emailTemplate!).toBe(false);
  });

  it("drops a blank literal recipient row and preserves source for token rows", () => {
    const editable = toEditable(DEFS_EMAIL);
    // Add a blank literal To row (a half-filled UI row) and a token row whose
    // stale address field must NOT leak into storage.
    editable[0].steps[0].emailTemplate.to.push({
      id: "x",
      source: "literal",
      address: "   ",
      token: "provider.email",
    });
    editable[0].steps[0].emailTemplate.cc[0].address = "stale-should-be-ignored@x.com";
    const step = fromEditable(editable)[0].steps[0];
    expect(step.emailTemplate?.to).toEqual([
      { source: "literal", address: "network_PhysicalHealth@optum.com" },
    ]);
    // Token CC keeps only { source, token } — the stale address never versions.
    expect(step.emailTemplate?.cc).toEqual([{ source: "token", token: "provider.email" }]);
  });

  it("never writes recipients for a non-draft_email step", () => {
    const editable = toEditable(DEFS_EMAIL);
    editable[0].steps[0].stepType = "online_form";
    const step = fromEditable(editable)[0].steps[0];
    expect(step.emailTemplate).toBeUndefined();
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

describe("collapsed Action row helpers (BITE-SOP-TT-03)", () => {
  it("treats zero- and one-step actions as collapsed", () => {
    const [one] = toEditable([{ title: "Fill portal", steps: [onlineFormStep("availity")] }]);
    const [empty] = toEditable([{ title: "Empty", steps: [] }]);
    const [multi] = toEditable([
      { title: "Multi", steps: [onlineFormStep("a"), { label: "Call", stepType: "phone" }] },
    ]);
    expect(isCollapsedAction(one)).toBe(true);
    expect(isCollapsedAction(empty)).toBe(true);
    expect(isCollapsedAction(multi)).toBe(false);
  });

  it("syncs the sole step label from the action name", () => {
    const [task] = toEditable([
      { title: "Old name", steps: [{ label: "Old name", stepType: "online_form" }] },
    ]);
    const patch = actionNamePatch(task, "Fill BCBS KS portal");
    expect(patch.title).toBe("Fill BCBS KS portal");
    expect(patch.steps).toHaveLength(1);
    expect(patch.steps?.[0].label).toBe("Fill BCBS KS portal");
    // Multi-step keeps independent step labels.
    const [multi] = toEditable([
      {
        title: "Packet",
        steps: [
          { label: "Call", stepType: "phone" },
          { label: "Fax", stepType: "fax" },
        ],
      },
    ]);
    expect(actionNamePatch(multi, "Renamed")).toEqual({ title: "Renamed" });
  });

  it("maps Portal form Mode to Auto-fill and channel Modes to Manual", () => {
    expect(executionTypeForActionMode("online_form")).toBe("extension_fill");
    expect(executionTypeForActionMode("draft_email")).toBe("manual");
    expect(executionTypeForActionMode("phone")).toBe("manual");
    expect(executionTypeForActionMode("fax")).toBe("manual");
    expect(executionTypeForActionMode("mail")).toBe("manual");
    expect(executionTypeForActionMode("pdf")).toBe("manual");
  });
});

describe("action presets (BITE-SOP-TT-04)", () => {
  it("seeds Portal / Auto-fill with extension_fill and one online_form step", () => {
    const action = createActionFromPreset("portal_fill", 14);
    expect(action.title).toBe("Fill online form");
    expect(action.dueOffsetDays).toBe(14);
    expect(action.executionType).toBe("extension_fill");
    expect(action.steps).toHaveLength(1);
    expect(action.steps[0]).toMatchObject({
      label: "Fill online form",
      stepType: "online_form",
      portalKey: "",
      detail: "",
    });
    expect(action.steps[0].emailTemplate.to).toEqual([]);
    expect(isCollapsedAction(action)).toBe(true);
  });

  it("seeds Draft email with Manual, draft_email, and one empty To row", () => {
    const action = createActionFromPreset("draft_email", 0);
    expect(action.title).toBe("Draft email");
    expect(action.executionType).toBe("manual");
    expect(action.steps).toHaveLength(1);
    const [step] = action.steps;
    expect(step.stepType).toBe("draft_email");
    expect(step.label).toBe("Draft email");
    expect(step.emailTemplate.to).toHaveLength(1);
    expect(step.emailTemplate.to[0]).toMatchObject({
      source: "literal",
      address: "",
    });
    expect(step.emailTemplate.cc).toEqual([]);
    expect(step.emailTemplate.subject).toBe("");
    expect(step.emailTemplate.body).toBe("");
    // Round-trip drops the blank To until filled — publish lint still requires ≥1 valid To.
    const [stored] = fromEditable([action]);
    expect(stored.executionType).toBeUndefined();
    expect(stored.steps[0].emailTemplate).toEqual({ subject: "", body: "" });
  });

  it("seeds Phone / Fax / Mail as Manual + matching stepType", () => {
    for (const [preset, stepType, title] of [
      ["phone", "phone", "Phone call"],
      ["fax", "fax", "Fax"],
      ["mail", "mail", "Mail"],
    ] as const) {
      const action = createActionFromPreset(preset, 7);
      expect(action.title).toBe(title);
      expect(action.executionType).toBe("manual");
      expect(action.steps).toHaveLength(1);
      expect(action.steps[0].stepType).toBe(stepType);
      expect(action.steps[0].label).toBe(title);
      expect(action.steps[0].portalKey).toBe("");
    }
  });

  it("assigns distinct ids per seed so React keys never collide", () => {
    const a = createActionFromPreset("portal_fill", 0);
    const b = createActionFromPreset("portal_fill", 0);
    expect(a.id).not.toBe(b.id);
    expect(a.steps[0].id).not.toBe(b.steps[0].id);
  });
});

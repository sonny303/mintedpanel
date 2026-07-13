// E1.7b — the wizard's editable round-trip must carry the step-shape
// extension (fax/phone/mail step types, turnaround/cadence day counts,
// required artifacts) or authoring would silently drop what resolution was
// taught to keep. fromEditable omits unset optional fields so stored jsonb
// stays minimal, exactly like portalKey.
import { describe, expect, it } from "vitest";
import { fromEditable, toEditable } from "./editableTemplate";
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

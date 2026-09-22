import { describe, expect, it } from "vitest";
import {
  isPortalHiddenFromPickers,
  listPortalStepReferences,
  portalDisplayName,
  portalsForPicker,
  unlinkPortalKeyFromTasks,
  withHiddenPortalPrefix,
  PORTAL_HIDDEN_PREFIX,
} from "@/lib/portalRetirement";
import type { Portal, SOPTemplate } from "@/types";

function portal(over: Partial<Portal> = {}): Portal {
  return {
    id: "p1",
    orgId: null,
    portalKey: "aetna_enroll",
    name: "Aetna enroll",
    payerId: "payer-1",
    formUrl: "https://example.com",
    isVerified: false,
    lastVerifiedAt: null,
    provenAt: null,
    urlChangedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function template(over: Partial<SOPTemplate> = {}): SOPTemplate {
  return {
    id: "t1",
    orgId: null,
    name: "Commercial",
    groupId: null,
    state: "CO",
    states: ["CO"],
    specialty: null,
    payerId: "payer-1",
    taskDefinitions: [
      {
        title: "Submit",
        steps: [{ label: "Online form", stepType: "online_form", portalKey: "aetna_enroll" }],
      },
    ],
    isArchived: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as SOPTemplate;
}

describe("portalRetirement", () => {
  it("prefixes and detects hidden portals", () => {
    const p = portal({ name: withHiddenPortalPrefix("Aetna enroll") });
    expect(isPortalHiddenFromPickers(p)).toBe(true);
    expect(portalDisplayName(p)).toBe("Aetna enroll");
    expect(p.name.startsWith(PORTAL_HIDDEN_PREFIX)).toBe(true);
  });

  it("filters hidden portals from pickers unless selected", () => {
    const live = portal({ id: "1", name: "Live" });
    const hidden = portal({
      id: "2",
      portalKey: "typo",
      name: withHiddenPortalPrefix("Typo"),
    });
    expect(portalsForPicker([live, hidden], null).map((p) => p.id)).toEqual(["1"]);
    expect(portalsForPicker([live, hidden], "typo").map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("lists and unlinks step references", () => {
    const refs = listPortalStepReferences([template()], "aetna_enroll");
    expect(refs).toHaveLength(1);
    expect(refs[0].taskLabel).toBe("Submit");
    const { next, changed } = unlinkPortalKeyFromTasks(template().taskDefinitions, "aetna_enroll");
    expect(changed).toBe(true);
    expect(next[0].steps[0].portalKey).toBe("");
  });
});

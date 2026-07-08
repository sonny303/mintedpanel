import { describe, it, expect } from "vitest";
import { countStepsByPortalKey } from "./portalReferences";
import type { SOPTemplate, SOPTaskDefinition } from "@/types";

function tmpl(id: string, taskDefinitions: SOPTaskDefinition[], archived = false): SOPTemplate {
  return {
    id,
    orgId: "org-1",
    name: id,
    groupId: null,
    state: null,
    specialty: null,
    payerId: null,
    taskDefinitions,
    isArchived: archived,
    archived,
    createdAt: "2026-07-08T00:00:00Z",
    updatedAt: "2026-07-08T00:00:00Z",
  };
}

function task(steps: SOPTaskDefinition["steps"]): SOPTaskDefinition {
  return { title: "T", steps };
}

describe("countStepsByPortalKey", () => {
  it("counts every online_form step carrying a portalKey, aggregating across templates", () => {
    const templates = [
      tmpl("a", [
        task([
          { label: "s1", stepType: "online_form", portalKey: "availity" },
          { label: "s2", stepType: "online_form", portalKey: "availity" },
        ]),
      ]),
      tmpl("b", [task([{ label: "s3", stepType: "online_form", portalKey: "caqh" }])]),
    ];
    const counts = countStepsByPortalKey(templates);
    expect(counts.get("availity")).toBe(2);
    expect(counts.get("caqh")).toBe(1);
  });

  it("normalizes keys so editor casing/whitespace collides on one entry", () => {
    const counts = countStepsByPortalKey([
      tmpl("a", [
        task([
          { label: "s1", stepType: "online_form", portalKey: " Availity " },
          { label: "s2", stepType: "online_form", portalKey: "availity" },
        ]),
      ]),
    ]);
    expect(counts.get("availity")).toBe(2);
    expect([...counts.keys()]).toEqual(["availity"]);
  });

  it("ignores steps with no portalKey", () => {
    const counts = countStepsByPortalKey([
      tmpl("a", [
        task([
          { label: "s1", stepType: "online_form" },
          { label: "s2", stepType: "draft_email" },
        ]),
      ]),
    ]);
    expect(counts.size).toBe(0);
  });

  it("excludes archived templates (they generate no cases)", () => {
    const counts = countStepsByPortalKey([
      tmpl("a", [task([{ label: "s1", stepType: "online_form", portalKey: "availity" }])], true),
    ]);
    expect(counts.get("availity")).toBeUndefined();
  });

  it("returns an empty map for no templates", () => {
    expect(countStepsByPortalKey([]).size).toBe(0);
  });
});

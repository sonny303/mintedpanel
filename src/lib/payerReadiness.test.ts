import { describe, expect, it } from "vitest";
import type { SOPTemplate } from "@/types";
import { FALLBACK_SOP_TEMPLATE_ID } from "./pickTemplate";
import { buildPayerReadiness, readinessSummary } from "./payerReadiness";

function tpl(
  over: Partial<Omit<SOPTemplate, "orgId">> & { id: string; orgId?: string | null },
): SOPTemplate {
  return {
    orgId: "org1",
    name: over.name ?? "T",
    groupId: null,
    state: null,
    specialty: null,
    payerId: null,
    taskDefinitions: [],
    isArchived: false,
    archived: false,
    createdAt: "",
    updatedAt: "",
    currentVersion: 1,
    ...over,
  } as unknown as SOPTemplate;
}

const names: Record<string, string> = { pay1: "Aetna", pay2: "BCBS" };
const payerName = (id: string) => names[id] ?? id;

const fallback = tpl({ id: FALLBACK_SOP_TEMPLATE_ID, name: "Generic", orgId: null, payerId: null });

describe("buildPayerReadiness", () => {
  it("Ready when a payer-specific SOP resolves for every underlying target", () => {
    const templates = [
      fallback,
      tpl({ id: "t-aetna-nc", payerId: "pay1", state: "NC", groupId: null }),
    ];
    const rows = buildPayerReadiness({
      targets: [{ payerId: "pay1", groupId: "g1", state: "NC" }],
      templates,
      payerName,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].ready).toBe(true);
    expect(rows[0].resolvedTemplateId).toBe("t-aetna-nc");
    expect(rows[0].matchKey.groupId).toBeNull();
  });

  it("Needs SOP when only the fallback resolves", () => {
    const rows = buildPayerReadiness({
      targets: [{ payerId: "pay2", groupId: "g1", state: "NC" }],
      templates: [fallback],
      payerName,
    });
    expect(rows[0].ready).toBe(false);
    expect(rows[0].resolvedTemplateId).toBeNull();
    // creation link carries the uncovered group's match key
    expect(rows[0].matchKey).toEqual({ payerId: "pay2", state: "NC", groupId: "g1" });
  });

  it("aggregate is Needs SOP if ANY underlying group target is uncovered", () => {
    // A group-specific SOP (t-g1) covers ONLY its own group under the
    // deterministic precedence — it never leaks onto another group (g2), so the
    // g2 target falls back to the generic fallback and the aggregate is Needs SOP.
    const templates = [fallback, tpl({ id: "t-g1", payerId: "pay1", state: "NC", groupId: "g1" })];
    const rows = buildPayerReadiness({
      targets: [
        { payerId: "pay1", groupId: "g1", state: "NC" }, // covered by t-g1
        { payerId: "pay1", groupId: "g2", state: "NC" }, // uncovered — t-g1 is g1-only
      ],
      templates,
      payerName,
    });
    expect(rows[0].ready).toBe(false);
    expect(rows[0].coveredCount).toBe(1);
    expect(rows[0].totalCount).toBe(2);
    // The creation link points at the first uncovered group.
    expect(rows[0].matchKey.groupId).toBe("g2");
  });

  it("an any-group (null groupId) payer SOP covers every group target", () => {
    // Contrast: an any-group SOP legitimately covers both g1 and g2.
    const templates = [fallback, tpl({ id: "t-any", payerId: "pay1", state: "NC", groupId: null })];
    const rows = buildPayerReadiness({
      targets: [
        { payerId: "pay1", groupId: "g1", state: "NC" },
        { payerId: "pay1", groupId: "g2", state: "NC" },
      ],
      templates,
      payerName,
    });
    expect(rows[0].ready).toBe(true);
    expect(rows[0].coveredCount).toBe(2);
  });

  it("flags extension_fill SOPs for form readiness (TE-16)", () => {
    const templates = [
      fallback,
      tpl({
        id: "t-form",
        payerId: "pay1",
        state: "NC",
        groupId: null,
        taskDefinitions: [
          { title: "Submit", executionType: "extension_fill", steps: [{ label: "x" }] },
        ] as never,
      }),
    ];
    const rows = buildPayerReadiness({
      targets: [{ payerId: "pay1", groupId: "g1", state: "NC" }],
      templates,
      payerName,
    });
    expect(rows[0].hasExtensionFill).toBe(true);
  });

  it("flags online_form-only SOPs for form follow-up (BITE-SOP-TT-01)", () => {
    const templates = [
      fallback,
      tpl({
        id: "t-of",
        payerId: "pay1",
        state: "NC",
        groupId: null,
        taskDefinitions: [
          {
            title: "Submit",
            executionType: "manual",
            steps: [{ label: "Fill", stepType: "online_form", portalKey: "availity" }],
          },
        ] as never,
      }),
    ];
    const rows = buildPayerReadiness({
      targets: [{ payerId: "pay1", groupId: "g1", state: "NC" }],
      templates,
      payerName,
    });
    expect(rows[0].hasExtensionFill).toBe(true);
  });

  it("does not flag fax-only manual SOPs for form follow-up", () => {
    const templates = [
      fallback,
      tpl({
        id: "t-fax",
        payerId: "pay1",
        state: "NC",
        groupId: null,
        taskDefinitions: [
          {
            title: "Fax packet",
            executionType: "manual",
            steps: [{ label: "Fax", stepType: "fax" }],
          },
        ] as never,
      }),
    ];
    const rows = buildPayerReadiness({
      targets: [{ payerId: "pay1", groupId: "g1", state: "NC" }],
      templates,
      payerName,
    });
    expect(rows[0].hasExtensionFill).toBe(false);
  });

  it("summarizes ready vs needs-sop", () => {
    const templates = [fallback, tpl({ id: "t1", payerId: "pay1", state: "NC" })];
    const rows = buildPayerReadiness({
      targets: [
        { payerId: "pay1", groupId: "g1", state: "NC" },
        { payerId: "pay2", groupId: "g1", state: "NC" },
      ],
      templates,
      payerName,
    });
    expect(readinessSummary(rows)).toEqual({ total: 2, ready: 1, needsSop: 1 });
  });
});

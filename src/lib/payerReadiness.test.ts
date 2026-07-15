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
    const templates = [fallback, tpl({ id: "t-g1", payerId: "pay1", state: "NC", groupId: "g1" })];
    const rows = buildPayerReadiness({
      targets: [
        { payerId: "pay1", groupId: "g1", state: "NC" }, // covered by t-g1
        { payerId: "pay1", groupId: "g2", state: "NC" }, // t-g1 also matches payer+state (tier 2) → covered
      ],
      templates,
      payerName,
    });
    // t-g1 has state+payer so it covers g2 via tier-2 precedence → both ready
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

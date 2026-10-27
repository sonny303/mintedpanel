import { describe, expect, it } from "vitest";
import type { SOPTemplate } from "@/types";
import type { ProviderReadinessFacts } from "./enrollmentReadiness";
import type { GenerationPreviewRow } from "./generationPreview";
import { evaluateGeneration, resolveRowTemplate } from "./generationGating";
import { previewRowKey } from "./generationPreview";
import { pickTemplate, resolutionTier } from "./pickTemplate";
import { templateProvenance } from "./sopStamp";

function row(over: Partial<GenerationPreviewRow>): GenerationPreviewRow {
  return {
    providerId: "p1",
    groupId: "g1",
    payerId: "pay1",
    state: "NC",
    providerName: "Riggins, Tim",
    groupName: "Dillon",
    payerName: "Aetna",
    disposition: "proposed",
    reason: "",
    existingCase: null,
    exclusion: null,
    ...over,
  };
}

function facts(over: Partial<ProviderReadinessFacts>): ProviderReadinessFacts {
  return {
    providerId: "p1",
    providerName: "Riggins, Tim",
    npiPresent: true,
    caqhIdPresent: true,
    caqhLastAttestedDate: "2026-06-01",
    dobPresent: true,
    ssnLast4Present: true,
    ...over,
  };
}

function tpl(required: string[]): SOPTemplate {
  return {
    id: "t-aetna-nc",
    orgId: "org1",
    name: "Aetna NC",
    groupId: null,
    state: "NC",
    specialty: null,
    payerId: "pay1",
    taskDefinitions: [],
    isArchived: false,
    archived: false,
    caseType: "enrollment",
    createdAt: "",
    updatedAt: "",
    currentVersion: 1,
    requiredProfileAttributes: required,
  };
}

describe("evaluateGeneration (TE-13 gating)", () => {
  it("withholds a proposed case when equal-priority templates would stamp different tasks", () => {
    const first = tpl([]);
    const second = { ...tpl([]), id: "second" };
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [second, first],
      factsById: new Map([["p1", facts({})]]),
    });
    expect(res.confirmable).toHaveLength(0);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.gated).toHaveLength(0);
    expect(res.unmatched).toHaveLength(0);
  });

  it("gates a proposed provider missing a required attribute (TS-96)", () => {
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [tpl(["caqh_id"])],
      factsById: new Map([["p1", facts({ caqhIdPresent: false })]]),
    });
    expect(res.confirmable).toHaveLength(0);
    expect(res.gated).toHaveLength(1);
    expect(res.gated[0].unmet[0].key).toBe("caqh_id");
    expect(res.unmatched).toHaveLength(0);
  });

  it("passes a provider who satisfies the requirement", () => {
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [tpl(["caqh_id"])],
      factsById: new Map([["p1", facts({})]]),
    });
    expect(res.confirmable).toHaveLength(1);
    expect(res.gated).toHaveLength(0);
  });

  it("holds proposed rows when only a different-purpose SOP exists", () => {
    const contract = { ...tpl([]), caseType: "contract" as const };
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [contract],
      factsById: new Map([["p1", facts({})]]),
    });
    expect(res.confirmable).toHaveLength(0);
    expect(res.unmatched).toEqual([row({})]);
    expect(res.ambiguous).toHaveLength(0);
  });

  it("no required attributes → always confirmable", () => {
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [tpl([])],
      factsById: new Map([["p1", facts({ caqhIdPresent: false })]]),
    });
    expect(res.confirmable).toHaveLength(1);
  });

  it("only gates proposed rows (existing/excluded untouched)", () => {
    const res = evaluateGeneration({
      rows: [row({ disposition: "existing" }), row({ disposition: "excluded" })],
      templates: [tpl(["caqh_id"])],
      factsById: new Map([["p1", facts({ caqhIdPresent: false })]]),
    });
    expect(res.confirmable).toHaveLength(0);
    expect(res.gated).toHaveLength(0);
  });
});

// The gating layer, the task-level provenance stamp, and the generation-run-row
// tier ALL resolve their SOP through the SAME `pickTemplate` — proving there is
// one resolver and one tier per candidate (no divergence between what generation
// gates on, what a task is stamped with, and what the run row records).
describe("SOP resolution consistency (gating / task stamp / run-row tier)", () => {
  function orgTpl(over: Partial<SOPTemplate>): SOPTemplate {
    return {
      ...tpl([]),
      id: over.id ?? "org",
      orgId: "org1",
      ...over,
    };
  }
  function globalTpl(over: Partial<SOPTemplate>): SOPTemplate {
    return {
      ...tpl([]),
      id: over.id ?? "global",
      ...over,
      ...({ orgId: null } as unknown as Partial<SOPTemplate>),
    };
  }
  const fallback = globalTpl({ id: "fb", payerId: null, state: null, groupId: null });

  it("gates against the org override (not a different-group or global SOP) — the pickTemplate winner", () => {
    const orgExact = orgTpl({
      id: "org-g1",
      groupId: "g1",
      requiredProfileAttributes: ["caqh_id"],
    });
    const globalAny = globalTpl({ id: "gp-any", groupId: null, requiredProfileAttributes: [] });
    const otherGroup = orgTpl({ id: "org-g2", groupId: "g2", requiredProfileAttributes: [] });
    const templates = [globalAny, otherGroup, fallback, orgExact];

    // The org exact-group SOP (org-g1) is the deterministic winner; its
    // caqh_id requirement gates the provider — proving gating used it and not
    // the requirement-free global/different-group candidates.
    const res = evaluateGeneration({
      rows: [row({ groupId: "g1" })],
      templates,
      factsById: new Map([["p1", facts({ caqhIdPresent: false })]]),
    });
    expect(res.gated).toHaveLength(1);
    expect(res.gated[0].unmet[0].key).toBe("caqh_id");

    // The same selection drives the task-stamp provenance AND the run-row tier.
    const selected = pickTemplate(templates, "pay1", "NC", "g1", "enrollment");
    expect(selected?.id).toBe("org-g1");
    expect(templateProvenance(selected).sopResolutionTier).toBe("organization");
    expect(templateProvenance(selected).sopResolutionTier).toBe(resolutionTier(selected!));
  });

  it("a fallback-only payer resolves the generic fallback for gating AND the provenance tier", () => {
    const templates = [fallback];
    // The fallback carries no required attributes → confirmable.
    const res = evaluateGeneration({
      rows: [row({ payerId: "pay-unknown", groupId: "g1" })],
      templates,
      factsById: new Map([["p1", facts({ caqhIdPresent: false })]]),
    });
    expect(res.confirmable).toHaveLength(1);

    const selected = pickTemplate(templates, "pay-unknown", "NC", "g1", "enrollment");
    expect(selected?.id).toBe("fb");
    expect(templateProvenance(selected).sopResolutionTier).toBe("generic_fallback");
  });
});

describe("tied SOPs — the operator's choice (brief 2026-10-27)", () => {
  const first = tpl([]);
  const second = { ...tpl(["npi"]), id: "second", name: "Aetna NC (new)" };
  const key = previewRowKey(row({}));

  it("resolves a tie to the chosen SOP and gates against THAT SOP", () => {
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [first, second],
      factsById: new Map([["p1", facts({ npiPresent: false })]]),
      templateChoices: new Map([[key, "second"]]),
    });
    expect(res.ambiguous).toHaveLength(0);
    expect(res.confirmable).toHaveLength(0);
    expect(res.gated.map((g) => g.unmet.map((u) => u.key))).toEqual([["npi"]]);
  });

  it("makes the row confirmable when the chosen SOP's gate passes", () => {
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [first, second],
      factsById: new Map([["p1", facts({})]]),
      templateChoices: new Map([[key, first.id]]),
    });
    expect(res.confirmable).toHaveLength(1);
    expect(res.ambiguous).toHaveLength(0);
  });

  it("ignores a choice outside the tied set", () => {
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [first, second],
      factsById: new Map([["p1", facts({})]]),
      templateChoices: new Map([[key, "some-other-sop"]]),
    });
    expect(res.ambiguous).toHaveLength(1);
    expect(resolveRowTemplate([first, second], row({}), new Map([[key, "x"]])).template).toBe(null);
  });

  it("never needs a choice for a sole top-ranked SOP", () => {
    expect(resolveRowTemplate([first], row({})).template?.id).toBe(first.id);
    expect(resolveRowTemplate([], row({})).template).toBeNull();
  });
});

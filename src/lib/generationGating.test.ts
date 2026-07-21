import { describe, expect, it } from "vitest";
import type { SOPTemplate } from "@/types";
import type { ProviderReadinessFacts } from "./enrollmentReadiness";
import type { GenerationPreviewRow } from "./generationPreview";
import { evaluateGeneration } from "./generationGating";
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
    homeAddressPresent: true,
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
    createdAt: "",
    updatedAt: "",
    currentVersion: 1,
    requiredProfileAttributes: required,
  };
}

describe("evaluateGeneration (TE-13 gating)", () => {
  it("gates a proposed provider missing a required attribute (TS-96)", () => {
    const res = evaluateGeneration({
      rows: [row({})],
      templates: [tpl(["caqh_id"])],
      factsById: new Map([["p1", facts({ caqhIdPresent: false })]]),
    });
    expect(res.confirmable).toHaveLength(0);
    expect(res.gated).toHaveLength(1);
    expect(res.gated[0].unmet[0].key).toBe("caqh_id");
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
    const selected = pickTemplate(templates, "pay1", "NC", "g1");
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

    const selected = pickTemplate(templates, "pay-unknown", "NC", "g1");
    expect(selected?.id).toBe("fb");
    expect(templateProvenance(selected).sopResolutionTier).toBe("generic_fallback");
  });
});

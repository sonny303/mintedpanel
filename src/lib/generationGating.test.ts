import { describe, expect, it } from "vitest";
import type { SOPTemplate } from "@/types";
import type { ProviderReadinessFacts } from "./enrollmentReadiness";
import type { GenerationPreviewRow } from "./generationPreview";
import { evaluateGeneration } from "./generationGating";

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
    malpracticeCoverageEnd: "2027-01-01",
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

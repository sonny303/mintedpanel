import { describe, expect, it } from "vitest";

import {
  buildPayerReadinessFunnel,
  sopOnlineFormNeeds,
  type FunnelPortalInput,
  type FunnelSopInput,
} from "@/lib/payerReadinessFunnel";
import type { PortalFieldMap, SOPTaskDefinition } from "@/types";

const PAYER = { id: "payer-1", name: "Acme Health" };

const onlineFormDefs: SOPTaskDefinition[] = [
  {
    title: "Submit enrollment",
    steps: [{ label: "Fill the portal form", stepType: "online_form", portalKey: "Acme_Portal" }],
  },
];

const faxOnlyDefs: SOPTaskDefinition[] = [
  { title: "Fax the packet", steps: [{ label: "Fax it", stepType: "fax" }] },
];

function sop(overrides: Partial<FunnelSopInput> = {}): FunnelSopInput {
  return {
    id: "sop-1",
    orgId: null,
    payerId: PAYER.id,
    state: "NC",
    archived: false,
    taskDefinitions: onlineFormDefs,
    ...overrides,
  };
}

function portal(overrides: Partial<FunnelPortalInput> = {}): FunnelPortalInput {
  return {
    id: "portal-1",
    orgId: null,
    portalKey: "acme_portal",
    name: "Acme Portal",
    payerId: PAYER.id,
    isVerified: false,
    provenAt: null,
    ...overrides,
  };
}

function fieldMap(overrides: Partial<PortalFieldMap> & { id: string }): PortalFieldMap {
  return {
    orgId: null,
    portalKey: "acme_portal",
    urlPattern: null,
    pageStep: null,
    mapType: "web",
    selector: "#field",
    selectorFallbacks: null,
    source: "token",
    token: "provider.npi",
    hardcodedValue: null,
    transform: null,
    fieldType: "text",
    notes: null,
    status: "approved",
    fieldLabel: null,
    formSection: null,
    confidence: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function build(input: {
  sops?: FunnelSopInput[];
  portals?: FunnelPortalInput[];
  fieldMaps?: PortalFieldMap[];
  driftByPortal?: ReadonlyMap<string, PortalFieldMap[]>;
}) {
  return buildPayerReadinessFunnel({
    payers: [PAYER],
    sops: input.sops ?? [],
    portals: input.portals ?? [],
    fieldMaps: input.fieldMaps ?? [],
    driftByPortal: input.driftByPortal,
  })[0];
}

describe("sopOnlineFormNeeds", () => {
  it("finds online_form steps and normalizes their portal keys", () => {
    expect(sopOnlineFormNeeds(onlineFormDefs)).toEqual({
      hasOnlineForm: true,
      portalKeys: ["acme_portal"],
    });
    expect(sopOnlineFormNeeds(faxOnlyDefs)).toEqual({ hasOnlineForm: false, portalKeys: [] });
  });

  it("tolerates malformed jsonb", () => {
    expect(sopOnlineFormNeeds([{ title: "x", steps: undefined } as never])).toEqual({
      hasOnlineForm: false,
      portalKeys: [],
    });
  });
});

describe("buildPayerReadinessFunnel Ready = checklist SOP", () => {
  it("no global SOP → author_sop, not started", () => {
    const row = build({});
    expect(row.nextAction).toBe("author_sop");
    expect(row.sopPublished).toBe(false);
    expect(row.started).toBe(false);
    expect(row.ready).toBe(false);
    expect(row.formSuggestion).toBeNull();
  });

  it("org-scoped and archived SOPs never count as published", () => {
    const row = build({
      sops: [sop({ orgId: "org-1" }), sop({ id: "sop-2", archived: true })],
    });
    expect(row.sopPublished).toBe(false);
    expect(row.nextAction).toBe("author_sop");
  });

  it("empty taskDefinitions do not count as a published checklist", () => {
    const row = build({ sops: [sop({ taskDefinitions: [] })] });
    expect(row.sopPublished).toBe(false);
    expect(row.nextAction).toBe("author_sop");
  });

  it("SOP with an online form but no portal → ready + register_portal suggestion", () => {
    const row = build({ sops: [sop()] });
    expect(row.needsPortal).toBe(true);
    expect(row.formState).toBe("none");
    expect(row.nextAction).toBe("ready");
    expect(row.ready).toBe(true);
    expect(row.formSuggestion).toBe("register_portal");
    expect(row.readyNote).toMatch(/autofill portal not registered/i);
    expect(row.started).toBe(true);
  });

  it("portal registered, nothing approved → ready + train_mappings suggestion", () => {
    const row = build({
      sops: [sop()],
      portals: [portal()],
      fieldMaps: [fieldMap({ id: "m1", status: "proposed" })],
    });
    expect(row.formState).toBe("registered");
    expect(row.nextAction).toBe("ready");
    expect(row.formSuggestion).toBe("train_mappings");
    expect(row.portalKey).toBe("acme_portal");
  });

  it("trained but not proven → ready + run_dry_test suggestion", () => {
    const row = build({
      sops: [sop()],
      portals: [portal()],
      fieldMaps: [fieldMap({ id: "m1" })],
    });
    expect(row.formState).toBe("trained");
    expect(row.nextAction).toBe("ready");
    expect(row.formSuggestion).toBe("run_dry_test");
  });

  it("carries the first global SOP head id for editor deep-links", () => {
    const row = build({ sops: [sop()] });
    expect(row.sopTemplateId).toBe("sop-1");
    expect(build({}).sopTemplateId).toBeNull();
  });

  it("proven with no drift → ready, no form suggestion", () => {
    const row = build({
      sops: [sop()],
      portals: [portal({ provenAt: "2026-07-19T00:00:00Z" })],
      fieldMaps: [fieldMap({ id: "m1" })],
    });
    expect(row.formState).toBe("proven");
    expect(row.nextAction).toBe("ready");
    expect(row.ready).toBe(true);
    expect(row.formSuggestion).toBeNull();
    expect(row.readyNote).toBeNull();
  });

  it("drift is a soft suggestion — Ready stays true", () => {
    const broken = fieldMap({ id: "m1" });
    const row = build({
      sops: [sop()],
      portals: [portal({ provenAt: "2026-07-19T00:00:00Z" })],
      fieldMaps: [broken],
      driftByPortal: new Map([["acme_portal", [broken]]]),
    });
    expect(row.driftCount).toBe(1);
    expect(row.nextAction).toBe("ready");
    expect(row.ready).toBe(true);
    expect(row.formSuggestion).toBe("repair_drift");
    expect(row.readyNote).toMatch(/unrepaired drift/i);
  });

  it("no online form step → ready with the no-portal note", () => {
    const row = build({ sops: [sop({ taskDefinitions: faxOnlyDefs })] });
    expect(row.needsPortal).toBe(false);
    expect(row.nextAction).toBe("ready");
    expect(row.ready).toBe(true);
    expect(row.formSuggestion).toBeNull();
    expect(row.readyNote).toMatch(/no portal required/i);
  });

  it("Auto-fill without online_form still needs form follow-up (BITE-SOP-TT-01)", () => {
    const defs: SOPTaskDefinition[] = [
      {
        title: "Submit",
        executionType: "extension_fill",
        steps: [{ label: "Call payer", stepType: "phone" }],
      },
    ];
    const row = build({ sops: [sop({ taskDefinitions: defs })] });
    expect(row.needsPortal).toBe(true);
    expect(row.nextAction).toBe("ready");
    expect(row.formSuggestion).toBe("register_portal");
  });

  it("a portal matches by SOP step key even without a payer link", () => {
    const row = build({
      sops: [sop()],
      portals: [portal({ payerId: null })],
    });
    expect(row.formState).toBe("registered");
    expect(row.portalKey).toBe("acme_portal");
    expect(row.nextAction).toBe("ready");
  });

  it("rows sort by payer name", () => {
    const rows = buildPayerReadinessFunnel({
      payers: [
        { id: "b", name: "Bravo" },
        { id: "a", name: "Alpha" },
      ],
      sops: [],
      portals: [],
      fieldMaps: [],
    });
    expect(rows.map((r) => r.payerName)).toEqual(["Alpha", "Bravo"]);
  });
});

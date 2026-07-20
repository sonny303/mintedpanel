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

describe("buildPayerReadinessFunnel ladder", () => {
  it("no global SOP → author_sop, not started", () => {
    const row = build({});
    expect(row.nextAction).toBe("author_sop");
    expect(row.sopPublished).toBe(false);
    expect(row.started).toBe(false);
    expect(row.ready).toBe(false);
  });

  it("org-scoped and archived SOPs never count as published", () => {
    const row = build({
      sops: [sop({ orgId: "org-1" }), sop({ id: "sop-2", archived: true })],
    });
    expect(row.sopPublished).toBe(false);
    expect(row.nextAction).toBe("author_sop");
  });

  it("SOP with an online form but no portal → register_portal", () => {
    const row = build({ sops: [sop()] });
    expect(row.needsPortal).toBe(true);
    expect(row.formState).toBe("none");
    expect(row.nextAction).toBe("register_portal");
    expect(row.started).toBe(true);
  });

  it("portal registered, nothing approved → train_mappings", () => {
    const row = build({
      sops: [sop()],
      portals: [portal()],
      fieldMaps: [fieldMap({ id: "m1", status: "proposed" })],
    });
    expect(row.formState).toBe("registered");
    expect(row.nextAction).toBe("train_mappings");
    expect(row.portalKey).toBe("acme_portal");
  });

  it("trained but not proven → run_dry_test", () => {
    const row = build({
      sops: [sop()],
      portals: [portal()],
      fieldMaps: [fieldMap({ id: "m1" })],
    });
    expect(row.formState).toBe("trained");
    expect(row.nextAction).toBe("run_dry_test");
  });

  it("carries the first global SOP head id for editor deep-links", () => {
    const row = build({ sops: [sop()] });
    expect(row.sopTemplateId).toBe("sop-1");
    expect(build({}).sopTemplateId).toBeNull();
  });

  it("proven with no drift → ready", () => {
    const row = build({
      sops: [sop()],
      portals: [portal({ provenAt: "2026-07-19T00:00:00Z" })],
      fieldMaps: [fieldMap({ id: "m1" })],
    });
    expect(row.formState).toBe("proven");
    expect(row.nextAction).toBe("ready");
    expect(row.ready).toBe(true);
    expect(row.readyNote).toBeNull();
  });

  it("drift outranks the dry test and readiness → repair_drift", () => {
    const broken = fieldMap({ id: "m1" });
    const row = build({
      sops: [sop()],
      portals: [portal({ provenAt: "2026-07-19T00:00:00Z" })],
      fieldMaps: [broken],
      driftByPortal: new Map([["acme_portal", [broken]]]),
    });
    expect(row.driftCount).toBe(1);
    expect(row.nextAction).toBe("repair_drift");
    expect(row.ready).toBe(false);
  });

  it("no online form step → ready with the no-portal note", () => {
    const row = build({ sops: [sop({ taskDefinitions: faxOnlyDefs })] });
    expect(row.needsPortal).toBe(false);
    expect(row.nextAction).toBe("ready");
    expect(row.ready).toBe(true);
    expect(row.readyNote).toMatch(/no portal required/i);
  });

  it("a portal matches by SOP step key even without a payer link", () => {
    const row = build({
      sops: [sop()],
      portals: [portal({ payerId: null })],
    });
    expect(row.formState).toBe("registered");
    expect(row.portalKey).toBe("acme_portal");
  });

  it("rows sort by payer name", () => {
    const rows = buildPayerReadinessFunnel({
      payers: [
        { id: "z", name: "Zeta" },
        { id: "a", name: "Alpha" },
      ],
      sops: [],
      portals: [],
      fieldMaps: [],
    });
    expect(rows.map((r) => r.payerName)).toEqual(["Alpha", "Zeta"]);
  });
});

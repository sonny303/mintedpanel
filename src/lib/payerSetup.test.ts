// E4.2 unified payer setup — the per-payer funnel derivation. Pins the
// acceptance-critical branches: a zero-target payer is VISIBLE, dimensions are
// separate (never one collapsed badge), and the dominant next action follows
// the locked 8-step priority order.
import { describe, expect, it } from "vitest";
import {
  buildPayerSetupRows,
  resolutionIdSource,
  summarizePayerSetup,
  type PayerSetupInputs,
  type SetupReadinessRow,
} from "./payerSetup";
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type {
  FillSession,
  OrgPayerAssignment,
  OrgPayerSetting,
  Payer,
  Portal,
  PortalFieldMap,
} from "@/types";

function payer(over: Partial<Payer> = {}): Payer {
  return {
    id: "payer-1",
    orgId: null,
    name: "Aetna",
    isActive: true,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  } as Payer;
}

function assignment(over: Partial<OrgPayerAssignment> = {}): OrgPayerAssignment {
  return {
    id: "assign-1",
    orgId: "org-1",
    payerId: "payer-1",
    starter: false,
    status: "active",
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function readinessRow(over: Partial<SetupReadinessRow> = {}): SetupReadinessRow {
  return {
    payerId: "payer-1",
    state: "NC",
    ready: true,
    coveredCount: 1,
    totalCount: 1,
    resolvedTemplateId: null,
    hasExtensionFill: false,
    blockedCount: 0,
    matchKey: { payerId: "payer-1", state: "NC", groupId: null },
    ...over,
  };
}

function portal(over: Partial<Portal> = {}): Portal {
  return {
    id: "portal-1",
    orgId: "org-1",
    portalKey: "aetna_enroll",
    name: "Aetna Enrollment",
    payerId: "payer-1",
    formUrl: "https://portal.example/enroll",
    isVerified: false,
    lastVerifiedAt: null,
    urlChangedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  } as Portal;
}

function fieldMap(over: Partial<PortalFieldMap> = {}): PortalFieldMap {
  return {
    id: `map-${Math.abs(JSON.stringify(over).length)}`,
    orgId: "org-1",
    portalKey: "aetna_enroll",
    urlPattern: null,
    pageStep: null,
    mapType: "web",
    selector: "#field",
    selectorFallbacks: null,
    source: "token",
    token: "provider.firstName",
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
    ...over,
  } as PortalFieldMap;
}

function testFill(
  over: Partial<
    Pick<FillSession, "portalKey" | "isTest" | "fieldsFilled" | "fieldsSkipped" | "startedAt">
  > = {},
): PayerSetupInputs["fills"][number] {
  return {
    portalKey: "aetna_enroll",
    isTest: true,
    fieldsFilled: 8,
    fieldsSkipped: null,
    startedAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

function inputs(over: Partial<PayerSetupInputs> = {}): PayerSetupInputs {
  return {
    payers: [payer()],
    assignments: [assignment()],
    readinessRows: [],
    templates: [],
    portals: [],
    fieldMaps: [],
    fills: [],
    orgSettings: [],
    ...over,
  };
}

const orgSetting = (over: Partial<OrgPayerSetting> = {}): OrgPayerSetting => ({
  id: "set-1",
  orgId: "org-1",
  payerId: "payer-1",
  resolutionIdLabel: "Provider PIN",
  resolutionIdExpected: true,
  updatedBy: null,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

describe("row inclusion (the setup list starts from assignments, not targets)", () => {
  it("a just-selected catalog payer with ZERO targets appears, scope not configured", () => {
    const rows = buildPayerSetupRows(inputs());
    expect(rows).toHaveLength(1);
    expect(rows[0].scope.activeTargets).toBe(0);
    expect(rows[0].sop).toEqual({ kind: "no_scope" });
    expect(rows[0].nextAction).toEqual({ kind: "configure_scope" });
    expect(rows[0].generation.status).toBe("blocked");
  });

  it("archived subscriptions and unassigned catalog payers are excluded", () => {
    const rows = buildPayerSetupRows(
      inputs({
        payers: [payer(), payer({ id: "payer-2", name: "UHC" })],
        assignments: [assignment({ status: "archived" })],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("an unassigned org-scoped row is excluded — inclusion is subscription-only since the legacy cutover close-out", () => {
    const rows = buildPayerSetupRows(
      inputs({ payers: [payer({ orgId: "org-1", payerSlug: null })], assignments: [] }),
    );
    expect(rows).toEqual([]);
  });

  it("the Pre-Credentialing sentinel is excluded even when assigned", () => {
    const rows = buildPayerSetupRows(
      inputs({
        payers: [payer({ id: "payer-3", name: PRE_CRED_PAYER_NAME })],
        assignments: [assignment({ payerId: "payer-3" })],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("rows sort by payer name", () => {
    const rows = buildPayerSetupRows(
      inputs({
        payers: [payer({ id: "b", name: "Zeta" }), payer({ id: "a", name: "Alpha" })],
        assignments: [assignment({ payerId: "a" }), assignment({ id: "x", payerId: "b" })],
      }),
    );
    expect(rows.map((r) => r.payer.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("dimensions stay separate", () => {
  it("partial SOP coverage reads needs_sop with covered/total and the first uncovered match key", () => {
    const rows = buildPayerSetupRows(
      inputs({
        readinessRows: [
          readinessRow({ state: "NC", ready: true, coveredCount: 2, totalCount: 2 }),
          readinessRow({
            state: "SC",
            ready: false,
            coveredCount: 0,
            totalCount: 1,
            matchKey: { payerId: "payer-1", state: "SC", groupId: "grp-1" },
          }),
        ],
      }),
    );
    expect(rows[0].scope).toEqual({ activeTargets: 3, states: ["NC", "SC"] });
    expect(rows[0].sop).toEqual({
      kind: "needs_sop",
      covered: 2,
      total: 3,
      matchKey: { payerId: "payer-1", state: "SC", groupId: "grp-1" },
    });
    expect(rows[0].generation).toEqual({
      status: "warning",
      reasons: ["Generic fallback SOP would be used"],
    });
    expect(rows[0].nextAction).toEqual({
      kind: "create_sop",
      matchKey: { payerId: "payer-1", state: "SC", groupId: "grp-1" },
    });
  });

  it("form is not_applicable without an extension_fill SOP", () => {
    const rows = buildPayerSetupRows(inputs({ readinessRows: [readinessRow()] }));
    expect(rows[0].form).toEqual({ kind: "not_applicable" });
  });

  it("a covered row carries the resolved template's tier (org override vs global payer SOP)", () => {
    const orgTemplate = {
      id: "tpl-org",
      orgId: "org-1",
      payerId: "payer-1",
      state: "NC",
      groupId: null,
    } as never;
    const covered = buildPayerSetupRows(
      inputs({
        readinessRows: [readinessRow({ resolvedTemplateId: "tpl-org" })],
        templates: [orgTemplate],
      }),
    );
    expect(covered[0].sop).toEqual({ kind: "covered", covered: 1, total: 1, tier: "organization" });
    expect(covered[0].stateRows[0].sopTier).toBe("organization");

    const globalTemplate = {
      id: "tpl-global",
      orgId: null,
      payerId: "payer-1",
      state: "NC",
      groupId: null,
    } as never;
    const global = buildPayerSetupRows(
      inputs({
        readinessRows: [readinessRow({ resolvedTemplateId: "tpl-global" })],
        templates: [globalTemplate],
      }),
    );
    expect(global[0].sop).toEqual({ kind: "covered", covered: 1, total: 1, tier: "global_payer" });
  });

  it("extension_fill SOP with no registered portal reads unregistered", () => {
    const rows = buildPayerSetupRows(
      inputs({ readinessRows: [readinessRow({ hasExtensionFill: true })] }),
    );
    expect(rows[0].form).toEqual({ kind: "unregistered" });
    expect(rows[0].nextAction).toEqual({ kind: "register_portal" });
  });

  it("a registered portal with zero captured maps asks for capture", () => {
    const rows = buildPayerSetupRows(
      inputs({
        readinessRows: [readinessRow({ hasExtensionFill: true })],
        portals: [portal()],
      }),
    );
    expect(rows[0].form).toEqual({ kind: "capture", portalKey: "aetna_enroll" });
    expect(rows[0].nextAction).toEqual({
      kind: "train_mappings",
      mode: "capture",
      portalKey: "aetna_enroll",
    });
  });

  it("partial mapping coverage reads training with the e4-3a unlinked count", () => {
    const rows = buildPayerSetupRows(
      inputs({
        readinessRows: [readinessRow({ hasExtensionFill: true })],
        portals: [portal()],
        fieldMaps: [
          fieldMap({ id: "m1", status: "approved" }),
          fieldMap({ id: "m2", status: "proposed" }),
          // Approved but unlinked (no token/value) — the e4-3a "needs value" gap.
          fieldMap({ id: "m3", status: "approved", token: null, source: "token" }),
        ],
      }),
    );
    expect(rows[0].form).toEqual({
      kind: "training",
      portalKey: "aetna_enroll",
      approved: 2,
      total: 3,
      unlinked: 1,
    });
    expect(rows[0].nextAction).toEqual({
      kind: "train_mappings",
      mode: "train",
      portalKey: "aetna_enroll",
    });
  });

  it("complete mappings with no dry run ask for the form dry test", () => {
    const rows = buildPayerSetupRows(
      inputs({
        readinessRows: [readinessRow({ hasExtensionFill: true })],
        portals: [portal()],
        fieldMaps: [fieldMap()],
      }),
    );
    expect(rows[0].form).toEqual({ kind: "dry_run_pending", portalKey: "aetna_enroll" });
    expect(rows[0].nextAction).toEqual({ kind: "run_dry_test" });
  });

  it("the latest is_test fill supplies the dry-run status; real fills never do", () => {
    const rows = buildPayerSetupRows(
      inputs({
        readinessRows: [readinessRow({ hasExtensionFill: true })],
        portals: [portal()],
        fieldMaps: [fieldMap()],
        fills: [
          testFill({ isTest: false, fieldsFilled: 99 }),
          testFill({ startedAt: "2026-07-09T00:00:00Z", fieldsFilled: 3 }),
          testFill({
            startedAt: "2026-07-11T00:00:00Z",
            fieldsFilled: 7,
            fieldsSkipped: [
              { selector: "#a", label: "A", reason: "unmapped" },
              { selector: "#b", label: "B", reason: "empty_token" },
            ],
          }),
        ],
        orgSettings: [orgSetting()],
      }),
    );
    expect(rows[0].form).toEqual({
      kind: "tested",
      portalKey: "aetna_enroll",
      filled: 7,
      gaps: 2,
    });
    expect(rows[0].nextAction).toEqual({ kind: "review_generation" });
    expect(rows[0].generation.status).toBe("ready");
  });
});

describe("next-action priority", () => {
  it("blockers outrank form setup and the review step", () => {
    const rows = buildPayerSetupRows(
      inputs({
        readinessRows: [readinessRow({ hasExtensionFill: true, blockedCount: 2 })],
      }),
    );
    expect(rows[0].blockedCount).toBe(2);
    expect(rows[0].nextAction).toEqual({ kind: "resolve_blockers", count: 2 });
    expect(rows[0].generation).toEqual({
      status: "warning",
      reasons: ["2 providers blocked by missing profile data"],
    });
  });

  it("a generic resolution ID is the step before review; an org or Minted label clears it", () => {
    const base = {
      readinessRows: [readinessRow()],
    };
    const generic = buildPayerSetupRows(inputs(base));
    expect(generic[0].resolutionId).toBe("generic");
    expect(generic[0].nextAction).toEqual({ kind: "configure_resolution_id" });

    const viaOrg = buildPayerSetupRows(inputs({ ...base, orgSettings: [orgSetting()] }));
    expect(viaOrg[0].resolutionId).toBe("org");
    expect(viaOrg[0].nextAction).toEqual({ kind: "review_generation" });

    const viaMinted = buildPayerSetupRows(
      inputs({ ...base, payers: [payer({ resolutionIdLabel: "Provider ID" })] }),
    );
    expect(viaMinted[0].resolutionId).toBe("minted");
    expect(viaMinted[0].nextAction).toEqual({ kind: "review_generation" });
  });
});

describe("resolutionIdSource", () => {
  it("walks org setting → Minted label → generic", () => {
    expect(resolutionIdSource(payer(), orgSetting())).toBe("org");
    expect(resolutionIdSource(payer({ resolutionIdLabel: "PIN" }), null)).toBe("minted");
    expect(
      resolutionIdSource(
        payer({ resolutionIdLabel: "  " }),
        orgSetting({ resolutionIdLabel: null }),
      ),
    ).toBe("generic");
  });
});

describe("summary", () => {
  it("counts generation-ready rows", () => {
    const rows = buildPayerSetupRows(
      inputs({
        payers: [payer(), payer({ id: "payer-2", name: "UHC" })],
        assignments: [assignment(), assignment({ id: "a2", payerId: "payer-2" })],
        readinessRows: [readinessRow()],
        orgSettings: [orgSetting()],
      }),
    );
    expect(summarizePayerSetup(rows)).toEqual({ total: 2, generationReady: 1 });
  });
});

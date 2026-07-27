import { describe, expect, it } from "vitest";
import type { FunnelRow } from "@/lib/payerReadinessFunnel";
import type { ActiveOrgPayer } from "@/lib/payerSetup";
import {
  DEFAULT_PAYER_SETUP_FILTERS,
  buildPayerSetupRows,
  countPayerSetupKpis,
  filterPayerSetupRows,
  paginateRows,
  payerSetupKindOptions,
  payerSetupStateOptions,
  type PayerSetupViewRow,
} from "@/lib/payerSetupView";
import type { Payer, PayerKind } from "@/types";

function payer(
  id: string,
  name: string,
  over: Partial<Payer> & { states?: string[]; payerKind?: PayerKind } = {},
): ActiveOrgPayer {
  return {
    payer: {
      id,
      orgId: null,
      name,
      isActive: true,
      avgDecisionDays: null,
      createdAt: "2026-07-12T00:00:00Z",
      payerKind: "commercial",
      states: ["NC"],
      ...over,
    } as Payer,
    assignment: null,
  };
}

function funnel(payerId: string, over: Partial<FunnelRow> = {}): FunnelRow {
  return {
    payerId,
    payerName: payerId,
    sopPublished: false,
    sopCount: 0,
    needsPortal: false,
    formState: "none",
    portalKey: null,
    sopTemplateId: null,
    driftCount: 0,
    nextAction: "author_sop",
    ready: false,
    readyNote: null,
    started: false,
    ...over,
  };
}

const AETNA = payer("p-aetna", "Aetna (CVS Health)", { states: ["AZ", "CA", "CO", "NY"] });
const UHC = payer("p-uhc", "UnitedHealthcare", { states: ["AZ", "CO", "NM"] });
const BANNER = payer("p-banner", "Banner Health Plans", {
  states: ["AZ"],
  payerKind: "medicare_advantage",
});
const SELECT = payer("p-select", "SelectHealth (Intermountain)", { states: ["CO", "UT"] });
const ANTHEM_ARCHIVED = payer("p-anthem", "Anthem Legacy CO", {
  states: ["CO"],
  archivedAt: "2026-07-25T00:00:00Z",
});

const FUNNEL: FunnelRow[] = [
  // Published + proven form → fully quiet.
  funnel("p-aetna", {
    sopPublished: true,
    needsPortal: true,
    formState: "proven",
    nextAction: "ready",
    ready: true,
  }),
  // Published + trained-but-unproven form → Form not proven.
  funnel("p-uhc", {
    sopPublished: true,
    needsPortal: true,
    formState: "trained",
    nextAction: "run_dry_test",
  }),
  // No published template → Needs template.
  funnel("p-banner"),
  // Published + proven but drifted → Drift detected (still counts as proven).
  funnel("p-select", {
    sopPublished: true,
    needsPortal: true,
    formState: "proven",
    driftCount: 3,
    nextAction: "repair_drift",
  }),
];

const ROWS = buildPayerSetupRows([AETNA, UHC, BANNER, SELECT, ANTHEM_ARCHIVED], FUNNEL);

function names(rows: readonly PayerSetupViewRow[]): string[] {
  return rows.map((row) => row.name);
}

describe("buildPayerSetupRows", () => {
  it("projects funnel facts into the screen vocabulary", () => {
    const byId = new Map(ROWS.map((row) => [row.payerId, row]));
    expect(byId.get("p-aetna")).toMatchObject({
      templateStatus: "published",
      formNotProven: false,
      driftCount: 0,
      archived: false,
    });
    expect(byId.get("p-uhc")).toMatchObject({ templateStatus: "published", formNotProven: true });
    expect(byId.get("p-banner")).toMatchObject({
      templateStatus: "needs_template",
      formNotProven: false,
    });
    expect(byId.get("p-select")).toMatchObject({
      templateStatus: "published",
      formNotProven: false,
      driftCount: 3,
    });
  });

  it("an archived payer carries no funnel row and stays quiet", () => {
    const anthem = ROWS.find((row) => row.payerId === "p-anthem");
    expect(anthem).toMatchObject({
      archived: true,
      templateStatus: "needs_template",
      formNotProven: false,
      driftCount: 0,
    });
  });

  it("defaults kind to commercial and states to empty", () => {
    const bare = buildPayerSetupRows(
      [payer("p-bare", "Bare Payer", { states: undefined, payerKind: undefined })],
      [],
    );
    expect(bare[0]).toMatchObject({ kind: "commercial", states: [] });
  });

  it("a published template with no online-form need is never Form not proven", () => {
    const rows = buildPayerSetupRows(
      [payer("p-x", "X")],
      [
        funnel("p-x", {
          sopPublished: true,
          needsPortal: false,
          formState: "none",
          nextAction: "ready",
        }),
      ],
    );
    expect(rows[0].formNotProven).toBe(false);
  });
});

describe("countPayerSetupKpis", () => {
  it("counts active rows only — the archived row inflates nothing", () => {
    expect(countPayerSetupKpis(ROWS)).toEqual({
      all: 4,
      needsTemplate: 1,
      formNotProven: 1,
      drift: 1,
    });
  });
});

describe("filterPayerSetupRows", () => {
  it("default filters hide archived rows and pass everything else", () => {
    expect(names(filterPayerSetupRows(ROWS, DEFAULT_PAYER_SETUP_FILTERS))).toEqual([
      "Aetna (CVS Health)",
      "UnitedHealthcare",
      "Banner Health Plans",
      "SelectHealth (Intermountain)",
    ]);
  });

  it("each KPI narrows to its own set", () => {
    const base = DEFAULT_PAYER_SETUP_FILTERS;
    expect(names(filterPayerSetupRows(ROWS, { ...base, kpi: "needs_template" }))).toEqual([
      "Banner Health Plans",
    ]);
    expect(names(filterPayerSetupRows(ROWS, { ...base, kpi: "form_not_proven" }))).toEqual([
      "UnitedHealthcare",
    ]);
    expect(names(filterPayerSetupRows(ROWS, { ...base, kpi: "drift" }))).toEqual([
      "SelectHealth (Intermountain)",
    ]);
  });

  it("archived rows appear with Show archived and BYPASS the KPI filter", () => {
    const rows = filterPayerSetupRows(ROWS, {
      ...DEFAULT_PAYER_SETUP_FILTERS,
      kpi: "drift",
      showArchived: true,
    });
    expect(names(rows)).toEqual(["SelectHealth (Intermountain)", "Anthem Legacy CO"]);
  });

  it("search matches the name only, case-insensitive", () => {
    const rows = filterPayerSetupRows(ROWS, {
      ...DEFAULT_PAYER_SETUP_FILTERS,
      search: "  united ",
    });
    expect(names(rows)).toEqual(["UnitedHealthcare"]);
  });

  it("state and kind filters narrow, and also apply to archived rows", () => {
    const co = filterPayerSetupRows(ROWS, {
      ...DEFAULT_PAYER_SETUP_FILTERS,
      state: "CO",
      showArchived: true,
    });
    expect(names(co)).toEqual([
      "Aetna (CVS Health)",
      "UnitedHealthcare",
      "SelectHealth (Intermountain)",
      "Anthem Legacy CO",
    ]);
    const ma = filterPayerSetupRows(ROWS, {
      ...DEFAULT_PAYER_SETUP_FILTERS,
      kind: "medicare_advantage",
    });
    expect(names(ma)).toEqual(["Banner Health Plans"]);
  });

  it("can filter to none while the org still has payers", () => {
    const rows = filterPayerSetupRows(ROWS, {
      ...DEFAULT_PAYER_SETUP_FILTERS,
      search: "no such payer",
    });
    expect(rows).toEqual([]);
  });
});

describe("filter options", () => {
  it("state options are the sorted union across all rows, archived included", () => {
    expect(payerSetupStateOptions(ROWS)).toEqual(["AZ", "CA", "CO", "NM", "NY", "UT"]);
  });

  it("kind options are the kinds present, ordered by label", () => {
    expect(payerSetupKindOptions(ROWS)).toEqual(["commercial", "medicare_advantage"]);
  });
});

describe("paginateRows", () => {
  const rows = Array.from({ length: 12 }, (_, i) => i + 1);

  it("slices the requested page with an honest range", () => {
    expect(paginateRows(rows, 1, 10)).toMatchObject({
      pageRows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      page: 1,
      totalPages: 2,
      from: 1,
      to: 10,
    });
    expect(paginateRows(rows, 2, 10)).toMatchObject({ pageRows: [11, 12], from: 11, to: 12 });
  });

  it("clamps an out-of-range page instead of stranding the pager", () => {
    expect(paginateRows(rows, 9, 10)).toMatchObject({ page: 2, pageRows: [11, 12] });
    expect(paginateRows(rows, 0, 10)).toMatchObject({ page: 1 });
  });

  it("an empty set is one empty page with a 0–0 range", () => {
    expect(paginateRows([], 3, 5)).toMatchObject({
      pageRows: [],
      page: 1,
      totalPages: 1,
      from: 0,
      to: 0,
    });
  });
});

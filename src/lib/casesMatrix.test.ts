import { describe, expect, it } from "vitest";
import { buildCasesMatrix, type CasesMatrixInput } from "./casesMatrix";
import type { CaseStatus } from "./caseStatus";

const today = "2026-08-25";
let sequence = 0;

function input(overrides: Partial<CasesMatrixInput> = {}): CasesMatrixInput {
  sequence += 1;
  return {
    today,
    providers: [
      {
        id: "provider-1",
        firstName: "Ada",
        lastName: "Lovelace",
        status: "onboarding",
        referenceOnly: false,
        verificationState: "verified",
      },
    ],
    cases: [
      {
        id: `case-${sequence}`,
        providerId: "provider-1",
        groupId: "group-1",
        payerId: "payer-1",
        state: "WI",
        caseStatus: "in_progress",
        confirmedEffectiveDate: null,
        createdAt: "2026-08-20T00:00:00Z",
      },
    ],
    payers: [{ id: "payer-1", name: "Aetna" }],
    groups: [{ id: "group-1", name: "BEST PT" }],
    targets: [{ payerId: "payer-1", groupId: "group-1", state: "WI", status: "active" }],
    tasks: [],
    followUps: new Map(),
    exclusions: [],
    ...overrides,
  };
}

function section(result: ReturnType<typeof buildCasesMatrix>) {
  expect(result.sections).toHaveLength(1);
  return result.sections[0];
}

function caseCell(result: ReturnType<typeof buildCasesMatrix>, payerId = "payer-1") {
  const cell = section(result).rows[0].cells[payerId];
  expect(cell.kind).toBe("case");
  if (cell.kind !== "case") throw new Error("expected a case cell");
  return cell;
}

describe("buildCasesMatrix", () => {
  it("1. includes a provider in every group/state section where they hold a case", () => {
    const result = buildCasesMatrix(
      input({
        cases: [
          {
            id: "wi",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-1",
            state: "WI",
            caseStatus: "in_progress",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
          {
            id: "ak",
            providerId: "provider-1",
            groupId: "group-2",
            payerId: "payer-1",
            state: "AK",
            caseStatus: "approved",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
        ],
        groups: [
          { id: "group-1", name: "BEST PT" },
          { id: "group-2", name: "Mowery PT" },
        ],
        targets: [
          { payerId: "payer-1", groupId: "group-1", state: "WI", status: "active" },
          { payerId: "payer-1", groupId: "group-2", state: "AK", status: "active" },
        ],
      }),
    );
    expect(result.sections.map((s) => [s.groupId, s.state])).toEqual([
      ["group-2", "AK"],
      ["group-1", "WI"],
    ]);
    expect(result.sections.every((s) => s.rows[0].providerId === "provider-1")).toBe(true);
  });

  it("2. drops an all-approved provider from every section, including denied cells", () => {
    const result = buildCasesMatrix(
      input({
        cases: [
          {
            id: "approved",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-1",
            state: "WI",
            caseStatus: "approved",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
          {
            id: "denied",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-2",
            state: "WI",
            caseStatus: "denied",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
        ],
        payers: [
          { id: "payer-1", name: "Aetna" },
          { id: "payer-2", name: "BCBS" },
        ],
      }),
    );
    expect(result.sections).toEqual([]);
    expect(result.eligibleProviderCount).toBe(0);
  });

  it("3. keeps a provider approved in one state when another state is open", () => {
    const result = buildCasesMatrix(
      input({
        cases: [
          {
            id: "wi",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-1",
            state: "WI",
            caseStatus: "approved",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
          {
            id: "ak",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-1",
            state: "AK",
            caseStatus: "in_progress",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
        ],
        targets: [
          { payerId: "payer-1", groupId: "group-1", state: "WI", status: "active" },
          { payerId: "payer-1", groupId: "group-1", state: "AK", status: "active" },
        ],
      }),
    );
    expect(result.sections).toHaveLength(2);
  });

  it("4. excludes terminated, reference-only, test, and pending-verification providers", () => {
    const baseProvider = input().providers[0];
    const providers = [
      baseProvider,
      { ...baseProvider, id: "terminated", status: "terminated" as const },
      { ...baseProvider, id: "reference", referenceOnly: true },
      { ...baseProvider, id: "test", isTestProvider: true },
      { ...baseProvider, id: "pending", verificationState: "pending_verification" as const },
    ];
    const cases = providers.map((provider) => ({
      id: provider.id,
      providerId: provider.id,
      groupId: "group-1",
      payerId: "payer-1",
      state: "WI",
      caseStatus: "in_progress" as CaseStatus,
      confirmedEffectiveDate: null,
      createdAt: "2026-08-20T00:00:00Z",
    }));
    const result = buildCasesMatrix(input({ providers, cases }));
    expect(result.sections[0].rows.map((row) => row.providerId)).toEqual(["provider-1"]);
  });

  it("5. keeps two same-target groups in separate sections with one case per cell", () => {
    const result = buildCasesMatrix(
      input({
        cases: [
          {
            id: "g1",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-1",
            state: "WI",
            caseStatus: "in_progress",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
          {
            id: "g2",
            providerId: "provider-1",
            groupId: "group-2",
            payerId: "payer-1",
            state: "WI",
            caseStatus: "in_progress",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
        ],
        groups: [
          { id: "group-1", name: "Group One" },
          { id: "group-2", name: "Group Two" },
        ],
        targets: [
          { payerId: "payer-1", groupId: "group-1", state: "WI", status: "active" },
          { payerId: "payer-1", groupId: "group-2", state: "WI", status: "active" },
        ],
      }),
    );
    expect(result.sections).toHaveLength(2);
    expect(result.sections.map((s) => s.rows[0].cells["payer-1"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "case", case: expect.objectContaining({ id: "g1" }) }),
        expect.objectContaining({ kind: "case", case: expect.objectContaining({ id: "g2" }) }),
      ]),
    );
  });

  it("6. adds a payer with a case but no active target as a column", () => {
    const result = buildCasesMatrix(
      input({
        cases: [
          ...input().cases,
          {
            id: "orphan",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-2",
            state: "WI",
            caseStatus: "denied",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
        ],
        payers: [
          { id: "payer-1", name: "Aetna" },
          { id: "payer-2", name: "BCBS" },
        ],
      }),
    );
    expect(section(result).columns.map((column) => column.payerId)).toEqual([
      "payer-1",
      "payer-2",
    ]);
  });

  it("7. matches a legacy NULL-group case with the three-part key", () => {
    const result = buildCasesMatrix(
      input({
        cases: [
          {
            id: "section-case",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-2",
            state: "WI",
            caseStatus: "in_progress",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
          {
            id: "legacy",
            providerId: "provider-1",
            groupId: null,
            payerId: "payer-1",
            state: "WI",
            caseStatus: "approved",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
        ],
        payers: [
          { id: "payer-1", name: "Aetna" },
          { id: "payer-2", name: "BCBS" },
        ],
      }),
    );
    expect(caseCell(result, "payer-1").case.id).toBe("legacy");
  });

  it("8. marks due-today and blocked overdue tasks red", () => {
    const base = input();
    const result = buildCasesMatrix(
      {
        ...base,
        tasks: [
          { caseId: base.cases[0].id, status: "not_started", dueDate: today },
          { caseId: base.cases[0].id, status: "blocked", dueDate: "2026-08-24" },
        ],
      },
    );
    expect(caseCell(result).hasOverdueTask).toBe(true);
  });

  it("9. never marks an approved cell urgent", () => {
    const base = input();
    const result = buildCasesMatrix(
      {
        ...base,
        cases: [
          base.cases[0],
          {
            ...base.cases[0],
            id: "open",
            payerId: "payer-2",
            caseStatus: "in_progress",
          },
          {
            ...base.cases[0],
            id: "approved",
            caseStatus: "approved",
            createdAt: "2026-07-01T00:00:00Z",
          },
        ],
        payers: [
          { id: "payer-1", name: "Aetna" },
          { id: "payer-2", name: "BCBS" },
        ],
        tasks: [{ caseId: "approved", status: "blocked", dueDate: "2026-08-01" }],
      },
    );
    const cell = caseCell(result, "payer-1");
    expect(cell.hasOverdueTask).toBe(false);
    expect(cell.stale).toBeNull();
  });

  it("10. suppresses urgency dots on a dimmed status cell", () => {
    const base = input();
    const result = buildCasesMatrix(
      {
        ...base,
        cases: [
          base.cases[0],
          {
            id: "denied",
            providerId: "provider-1",
            groupId: "group-1",
            payerId: "payer-2",
            state: "WI",
            caseStatus: "denied",
            confirmedEffectiveDate: null,
            createdAt: "2026-07-01T00:00:00Z",
          },
        ],
        payers: [
            { id: "payer-1", name: "Aetna" },
          { id: "payer-2", name: "BCBS" },
        ],
        filters: { kpi: "total", state: "all", status: "in_progress", search: "" },
        tasks: [{ caseId: "denied", status: "blocked", dueDate: "2026-08-01" }],
      },
    );
    const cell = section(result).rows[0].cells["payer-2"];
    expect(cell.kind).toBe("case");
    if (cell.kind !== "case") throw new Error("expected a case cell");
    expect(cell.dimmed).toBe(true);
    expect(cell.hasOverdueTask).toBe(false);
    expect(cell.stale).toBeNull();
  });

  it("11. carries the correct generation context on a gap cell", () => {
    const base = input();
    const result = buildCasesMatrix(
      {
        ...base,
        cases: [
          base.cases[0],
          {
            id: "other-section",
            providerId: "provider-1",
            groupId: "group-2",
            payerId: "payer-2",
            state: "AK",
            caseStatus: "in_progress",
            confirmedEffectiveDate: null,
            createdAt: "2026-08-20T00:00:00Z",
          },
        ],
        groups: [
          { id: "group-1", name: "Group One" },
          { id: "group-2", name: "Group Two" },
        ],
        payers: [
          { id: "payer-1", name: "Aetna" },
          { id: "payer-2", name: "BCBS" },
        ],
        targets: [
          { payerId: "payer-1", groupId: "group-1", state: "WI", status: "active" },
          { payerId: "payer-2", groupId: "group-1", state: "WI", status: "active" },
          { payerId: "payer-2", groupId: "group-2", state: "AK", status: "active" },
        ],
      },
    );
    const wi = result.sections.find((candidate) => candidate.state === "WI");
    const gap = wi?.rows[0].cells["payer-2"];
    expect(gap).toEqual({
      kind: "gap",
      dimmed: false,
      isActiveTarget: true,
      generation: {
        providerId: "provider-1",
        payerId: "payer-2",
        groupId: "group-1",
        state: "WI",
      },
    });
  });
});

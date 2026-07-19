// E6.2 F6.2.3 — the fulfillment board composition: ONE row per targeted payer,
// pills derived through the E6.0 rollup (never set), facts count toward Active,
// excluded combinations stay visible on their rows, archived payers stop
// counting, and cross-group cases never leak into another group's board
// (TS-122 multi-group honesty).
import { describe, expect, it } from "vitest";
import {
  buildPayerBoard,
  type BoardCaseInput,
  type PayerBoardInput,
} from "@/lib/payerNetworkBoard";
import type { GenerationPreviewRow } from "@/lib/generationPreview";
import type { CaseGenerationExclusion, EnrollmentFact, PayerNetworkTarget } from "@/types";

const target = (payerId: string, state = "NC", status: "active" | "archived" = "active") =>
  ({
    id: `t-${payerId}-${state}-${status}`,
    orgId: "org1",
    payerId,
    groupId: "g1",
    state,
    status,
    createdAt: "2026-06-01T00:00:00Z",
  }) satisfies PayerNetworkTarget;

const caseRow = (overrides: Partial<BoardCaseInput>): BoardCaseInput => ({
  id: "c1",
  providerId: "prov1",
  groupId: "g1",
  payerId: "pay1",
  state: "NC",
  caseStatus: "in_progress",
  approvedDate: null,
  ...overrides,
});

const fact = (overrides: Partial<EnrollmentFact>): EnrollmentFact => ({
  id: "f1",
  orgId: "org1",
  providerId: "prov1",
  groupId: "g1",
  payerId: "pay1",
  state: "NC",
  effectiveDate: "2025-03-01",
  source: "migration",
  expiredAt: null,
  expiredBy: null,
  createdBy: null,
  createdAt: "2026-06-15T00:00:00Z",
  ...overrides,
});

const candidate = (payerId: string, providerId = "prov1"): GenerationPreviewRow => ({
  providerId,
  groupId: "g1",
  payerId,
  state: "NC",
  providerName: "Dr. Chen",
  groupName: "Outer Banks Rehab Group",
  payerName: payerId,
  disposition: "proposed",
  reason: "",
  existingCase: null,
  exclusion: null,
});

function board(overrides: Partial<PayerBoardInput>): ReturnType<typeof buildPayerBoard> {
  return buildPayerBoard({
    groupId: "g1",
    targets: [],
    cases: [],
    facts: [],
    exclusions: [],
    candidates: [],
    payers: [
      { id: "pay1", name: "Aetna" },
      { id: "pay2", name: "Cigna" },
    ],
    providers: [{ id: "prov1", name: "Dr. Chen" }],
    ...overrides,
  });
}

describe("buildPayerBoard", () => {
  it("day 1: every targeted payer renders one Targeted row; the board accounts for all of them", () => {
    const result = board({
      targets: [target("pay1"), target("pay1", "CO"), target("pay2")],
    });
    expect(result.targetedPayerCount).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => [r.payerName, r.fulfillment])).toEqual([
      ["Aetna", "targeted"],
      ["Cigna", "targeted"],
    ]);
    expect(result.rows[0].targetStates).toEqual(["CO", "NC"]);
  });

  it("an open case flips its payer row to In Progress with the open-case count", () => {
    const result = board({
      targets: [target("pay1")],
      cases: [caseRow({})],
    });
    expect(result.rows[0].fulfillment).toBe("in_progress");
    expect(result.rows[0].openCount).toBe(1);
  });

  it("an approved case OR a live enrollment fact reads Active — a fact with zero cases is honest Active", () => {
    const approved = board({
      targets: [target("pay1")],
      cases: [caseRow({ caseStatus: "approved", approvedDate: "2026-07-10" })],
    });
    expect(approved.rows[0].fulfillment).toBe("active");
    expect(approved.rows[0].activeSince).toBe("2026-07-10");

    const viaFact = board({ targets: [target("pay1")], facts: [fact({})] });
    expect(viaFact.rows[0].fulfillment).toBe("active");
    expect(viaFact.rows[0].factCount).toBe(1);
    expect(viaFact.rows[0].openCount).toBe(0);
    expect(viaFact.rows[0].activeSince).toBe("2025-03-01");
  });

  it("an EXPIRED fact reverts its row (derived live, no board-side writes)", () => {
    const result = board({
      targets: [target("pay1")],
      facts: [fact({ expiredAt: "2026-07-18T00:00:00Z" })],
    });
    expect(result.rows[0].fulfillment).toBe("targeted");
    expect(result.rows[0].factCount).toBe(0);
  });

  it("denied-only pairs carry the denial marker and the drill-down keeps the denial history beneath the case", () => {
    const denials = new Map([["c1", [{ reasonLabel: "Panel closed", date: "2026-07-10" }]]]);
    const result = board({
      targets: [target("pay1")],
      cases: [caseRow({ caseStatus: "denied" })],
      denialsByCase: denials,
    });
    expect(result.rows[0].hasDenial).toBe(true);
    const cell = result.rows[0].providers[0].cells[0];
    expect(cell.kind).toBe("case");
    expect(cell.denials).toEqual([{ reasonLabel: "Panel closed", date: "2026-07-10" }]);
  });

  it("excluded combinations stay visible on their payer rows with reason", () => {
    const exclusion: CaseGenerationExclusion = {
      id: "x1",
      orgId: "org1",
      providerId: "prov1",
      groupId: "g1",
      payerId: "pay1",
      state: "NC",
      reason: "panel_closed",
      note: null,
      status: "active",
      createdBy: "u1",
      createdAt: "2026-07-01T00:00:00Z",
      voidedBy: null,
      voidedAt: null,
    };
    const result = board({ targets: [target("pay1")], exclusions: [exclusion] });
    expect(result.rows[0].excluded).toEqual([
      {
        exclusionId: "x1",
        providerId: "prov1",
        providerName: "Dr. Chen",
        state: "NC",
        reason: "panel_closed",
        note: null,
      },
    ]);
    expect(result.rows[0].providers[0].cells[0].kind).toBe("excluded");
  });

  it("candidates render as awaiting-generation cells and count on the row", () => {
    const result = board({ targets: [target("pay1")], candidates: [candidate("pay1")] });
    expect(result.rows[0].candidateCount).toBe(1);
    expect(result.rows[0].providers[0].cells[0].kind).toBe("candidate");
  });

  it("archived payers stop counting (TS-124: removal archives, board drops the row)", () => {
    const result = board({ targets: [target("pay1", "NC", "archived"), target("pay2")] });
    expect(result.targetedPayerCount).toBe(1);
    expect(result.rows.map((r) => r.payerId)).toEqual(["pay2"]);
  });

  it("cross-group evidence never leaks: another group's case and a legacy NULL-group case don't join (TS-122)", () => {
    const result = board({
      targets: [target("pay1")],
      cases: [
        caseRow({ id: "other-group", groupId: "g2", caseStatus: "approved" }),
        caseRow({ id: "legacy", groupId: null, caseStatus: "approved" }),
      ],
    });
    expect(result.rows[0].fulfillment).toBe("targeted");
    expect(result.rows[0].providers).toEqual([]);
  });
});

// E6.0 F6.0.5 — unit tests for the derived rollups: group × payer fulfillment
// (most-advanced-case-wins, enrollment-fact Active, the denial marker and its
// TS-116 reapply revert, TS-118 reactivity-by-derivation), provider
// "x of y approved" progress, and the denial rollup rows/pivots.
import { describe, expect, it } from "vitest";
import {
  buildDenialRows,
  groupDenialsByPayer,
  groupDenialsByProvider,
  groupPayerFulfillment,
  providerCaseProgress,
  type DenialInfo,
  type FulfillmentCaseRow,
  type FulfillmentTarget,
} from "./caseRollups";

const target = (groupId: string, payerId: string, state = "NC"): FulfillmentTarget => ({
  groupId,
  payerId,
  state,
});

const caseRow = (
  groupId: string | null,
  payerId: string,
  status: FulfillmentCaseRow["status"],
  state = "NC",
): FulfillmentCaseRow => ({ groupId, payerId, state, status });

describe("groupPayerFulfillment", () => {
  it("a target with no case is Targeted", () => {
    const rows = groupPayerFulfillment([target("g1", "p1")], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].fulfillment).toBe("targeted");
    expect(rows[0].targetStates).toEqual(["NC"]);
  });

  it("an open case moves the pair to In Progress", () => {
    const rows = groupPayerFulfillment([target("g1", "p1")], [caseRow("g1", "p1", "submitted")]);
    expect(rows[0].fulfillment).toBe("in_progress");
    expect(rows[0].openCount).toBe(1);
  });

  it("one Approved case wins over open siblings (most-advanced-case-wins)", () => {
    const rows = groupPayerFulfillment(
      [target("g1", "p1", "NC"), target("g1", "p1", "SC")],
      [caseRow("g1", "p1", "approved", "NC"), caseRow("g1", "p1", "in_progress", "SC")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fulfillment).toBe("active");
    expect(rows[0].targetStates).toEqual(["NC", "SC"]);
  });

  it("an enrollment fact makes the pair Active with zero cases", () => {
    const rows = groupPayerFulfillment(
      [target("g1", "p1")],
      [],
      [{ groupId: "g1", payerId: "p1" }],
    );
    expect(rows[0].fulfillment).toBe("active");
  });

  it("a denied-only pair reverts to Targeted with the denial marker", () => {
    const rows = groupPayerFulfillment([target("g1", "p1")], [caseRow("g1", "p1", "denied")]);
    expect(rows[0].fulfillment).toBe("targeted");
    expect(rows[0].hasDenial).toBe(true);
  });

  it("reapply clears the marker: a reopened case makes the pair In Progress (TS-116)", () => {
    // The denied case went back to in_progress (the SAME case, reapplied).
    const rows = groupPayerFulfillment([target("g1", "p1")], [caseRow("g1", "p1", "in_progress")]);
    expect(rows[0].fulfillment).toBe("in_progress");
    expect(rows[0].hasDenial).toBe(false);
  });

  it("an approval suppresses the denial marker", () => {
    const rows = groupPayerFulfillment(
      [target("g1", "p1", "NC"), target("g1", "p1", "SC")],
      [caseRow("g1", "p1", "approved", "NC"), caseRow("g1", "p1", "denied", "SC")],
    );
    expect(rows[0].fulfillment).toBe("active");
    expect(rows[0].hasDenial).toBe(false);
  });

  it("Not Pursuing keeps the pair Targeted without a denial marker", () => {
    const rows = groupPayerFulfillment([target("g1", "p1")], [caseRow("g1", "p1", "not_pursuing")]);
    expect(rows[0].fulfillment).toBe("targeted");
    expect(rows[0].hasDenial).toBe(false);
  });

  it("legacy NULL-group cases never join a board row", () => {
    const rows = groupPayerFulfillment([target("g1", "p1")], [caseRow(null, "p1", "approved")]);
    expect(rows[0].fulfillment).toBe("targeted");
  });

  it("a cased pair with no target still appears (the case is real work)", () => {
    const rows = groupPayerFulfillment([], [caseRow("g1", "p1", "in_progress")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].fulfillment).toBe("in_progress");
    expect(rows[0].targetStates).toEqual([]);
  });

  it("derivation is pure: flipping one case status flips the row (TS-118)", () => {
    const targets = [target("g1", "p1")];
    const before = groupPayerFulfillment(targets, [caseRow("g1", "p1", "in_review")]);
    const after = groupPayerFulfillment(targets, [caseRow("g1", "p1", "approved")]);
    expect(before[0].fulfillment).toBe("in_progress");
    expect(after[0].fulfillment).toBe("active");
  });

  it("rows sort deterministically by group then payer", () => {
    const rows = groupPayerFulfillment(
      [target("g2", "p1"), target("g1", "p2"), target("g1", "p1")],
      [],
    );
    expect(rows.map((r) => `${r.groupId}|${r.payerId}`)).toEqual(["g1|p1", "g1|p2", "g2|p1"]);
  });
});

describe("providerCaseProgress", () => {
  it("counts x of y approved per provider", () => {
    const progress = providerCaseProgress([
      { providerId: "pr1", status: "approved" },
      { providerId: "pr1", status: "in_progress" },
      { providerId: "pr1", status: "denied" },
      { providerId: "pr2", status: "approved" },
    ]);
    expect(progress.get("pr1")).toEqual({ approved: 1, total: 3 });
    expect(progress.get("pr2")).toEqual({ approved: 1, total: 1 });
  });

  it("Not Pursuing opt-outs leave the denominator", () => {
    const progress = providerCaseProgress([
      { providerId: "pr1", status: "approved" },
      { providerId: "pr1", status: "not_pursuing" },
    ]);
    expect(progress.get("pr1")).toEqual({ approved: 1, total: 1 });
  });

  it("a provider with no cases has no row", () => {
    expect(providerCaseProgress([]).size).toBe(0);
  });
});

describe("denial rollup", () => {
  const cases = [
    { id: "c1", providerId: "pr1", payerId: "p1", state: "NC", status: "denied" as const },
    { id: "c2", providerId: "pr1", payerId: "p2", state: "NC", status: "approved" as const },
    { id: "c3", providerId: "pr2", payerId: "p1", state: "SC", status: "denied" as const },
  ];
  const info = new Map<string, DenialInfo>([
    ["c1", { reasonLabel: "Panel closed", deniedAt: "2026-07-01T00:00:00Z" }],
  ]);

  it("rolls up currently-Denied cases as standing, with reason + date where known", () => {
    const rows = buildDenialRows(cases, info);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      caseId: "c1",
      reasonLabel: "Panel closed",
      cycleState: "standing",
    });
    expect(rows[1]).toMatchObject({ caseId: "c3", reasonLabel: null, cycleState: "standing" });
  });

  it("a reapplied case (back to In Progress) stays with cycleState reapplied (F6.6.3)", () => {
    const reapplied = cases.map((c) =>
      c.id === "c1" ? { ...c, status: "in_progress" as const } : c,
    );
    const rows = buildDenialRows(reapplied, info);
    expect(rows.map((r) => r.caseId)).toEqual(["c1", "c3"]);
    expect(rows[0]).toMatchObject({
      cycleState: "reapplied",
      currentStatus: "in_progress",
      reasonLabel: "Panel closed",
    });
  });

  it("a never-denied case with no denial history never joins the rollup", () => {
    // c2 is approved with no denial entry — absent from info, absent from rows.
    expect(buildDenialRows(cases, info).map((r) => r.caseId)).not.toContain("c2");
  });

  it("pivots provider-first and payer-first", () => {
    const rows = buildDenialRows(cases, info);
    const byProvider = groupDenialsByProvider(rows);
    expect([...byProvider.keys()]).toEqual(["pr1", "pr2"]);
    const byPayer = groupDenialsByPayer(rows);
    expect(byPayer.get("p1")?.map((r) => r.caseId)).toEqual(["c1", "c3"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  describeEmptyExpansion,
  expandTargets,
  newExpansionRows,
  planAttach,
  type ExpansionInput,
} from "@/lib/payerExpansion";

const groups = [
  { id: "g1", name: "Group One", isActive: true },
  { id: "g2", name: "Group Two", isActive: true },
];

const facilities = [
  { groupId: "g1", state: "NC", isActive: true },
  { groupId: "g2", state: "NC", isActive: true },
  { groupId: "g2", state: "NC", isActive: true },
  { groupId: "g2", state: "KS", isActive: true },
];

describe("expandTargets", () => {
  it("expands to group×state rows intersected with the payer's states", () => {
    const rows = expandTargets({ payerStates: ["NC"], groups, facilities });
    expect(rows).toEqual([
      {
        groupId: "g1",
        groupName: "Group One",
        state: "NC",
        facilityCount: 1,
        reason: "1 facility in NC",
      },
      {
        groupId: "g2",
        groupName: "Group Two",
        state: "NC",
        facilityCount: 2,
        reason: "2 facilities in NC",
      },
    ]);
  });

  it("keeps only the operating-state overlap for a single-state payer", () => {
    const rows = expandTargets({ payerStates: ["KS"], groups, facilities });
    expect(rows).toEqual([
      {
        groupId: "g2",
        groupName: "Group Two",
        state: "KS",
        facilityCount: 1,
        reason: "1 facility in KS",
      },
    ]);
  });

  it("treats missing payer-state metadata (null/undefined/empty) as no constraint", () => {
    for (const payerStates of [null, undefined, [] as string[]]) {
      const rows = expandTargets({ payerStates, groups, facilities });
      expect(rows.map((r) => `${r.groupId} ${r.state}`)).toEqual(["g1 NC", "g2 KS", "g2 NC"]);
    }
  });

  it("ignores inactive groups, inactive facilities, and group/state-less facilities", () => {
    const rows = expandTargets({
      payerStates: null,
      groups: [...groups, { id: "g3", name: "Soft Deleted", isActive: false }],
      facilities: [
        ...facilities,
        { groupId: "g3", state: "NC", isActive: true },
        { groupId: "g1", state: "SC", isActive: false },
        { groupId: null, state: "NC", isActive: true },
        { groupId: "g1", state: null, isActive: true },
      ],
    });
    expect(rows.map((r) => `${r.groupId} ${r.state}`)).toEqual(["g1 NC", "g2 KS", "g2 NC"]);
  });

  it("yields an empty expansion when the payer operates in none of the groups' states", () => {
    expect(expandTargets({ payerStates: ["TX"], groups, facilities })).toEqual([]);
  });
});

describe("describeEmptyExpansion", () => {
  it("explains a disjoint payer when the groups do have facility states", () => {
    const input: ExpansionInput = { payerStates: ["TX"], groups, facilities };
    expect(describeEmptyExpansion("BCBS-TX", input)).toBe(
      "BCBS-TX doesn't operate in any state where your groups have facilities, so there is nothing to target.",
    );
  });

  it("points at missing facilities when no group has a stateful active facility", () => {
    const input: ExpansionInput = { payerStates: ["NC"], groups, facilities: [] };
    expect(describeEmptyExpansion("BCBS-NC", input)).toBe(
      "No group has an active facility with a state yet — add facilities first, then attach payers.",
    );
  });
});

describe("planAttach", () => {
  const expansion = expandTargets({ payerStates: ["NC", "KS"], groups, facilities });

  it("marks unmatched rows new and checked by default", () => {
    const plan = planAttach(expansion, []);
    expect(plan.every((r) => r.kind === "new" && r.defaultChecked && r.targetId === null)).toBe(
      true,
    );
  });

  it("locks already-active rows and pre-unchecks previously archived rows (F1.5.3)", () => {
    const plan = planAttach(expansion, [
      { id: "t1", groupId: "g1", state: "NC", status: "active" },
      { id: "t2", groupId: "g2", state: "KS", status: "archived" },
    ]);
    const byKey = new Map(plan.map((r) => [`${r.groupId} ${r.state}`, r]));
    expect(byKey.get("g1 NC")).toMatchObject({
      kind: "active",
      targetId: "t1",
      defaultChecked: true,
    });
    expect(byKey.get("g2 KS")).toMatchObject({
      kind: "archived",
      targetId: "t2",
      defaultChecked: false,
    });
    expect(byKey.get("g2 NC")).toMatchObject({ kind: "new", defaultChecked: true });
  });
});

describe("newExpansionRows (TE-7 diff)", () => {
  it("returns only derived rows with no target row of any status", () => {
    const expansion = expandTargets({ payerStates: ["NC", "KS"], groups, facilities });
    const fresh = newExpansionRows(expansion, [
      { id: "t1", groupId: "g1", state: "NC", status: "active" },
      { id: "t2", groupId: "g2", state: "NC", status: "archived" },
    ]);
    expect(fresh.map((r) => `${r.groupId} ${r.state}`)).toEqual(["g2 KS"]);
  });

  it("is empty when every derived row already has a target — no dirty flag needed", () => {
    const expansion = expandTargets({ payerStates: ["NC"], groups, facilities });
    const fresh = newExpansionRows(expansion, [
      { id: "t1", groupId: "g1", state: "NC", status: "active" },
      { id: "t2", groupId: "g2", state: "NC", status: "active" },
    ]);
    expect(fresh).toEqual([]);
  });
});

// E1.3 TE-10 — assignment invariants: ≥1 assignment (last-removal blocked),
// exactly one primary, and the demote-before-promote sync plan.
import { describe, expect, it } from "vitest";
import {
  attachProviderGroups,
  indexProviderGroups,
  LAST_ASSIGNMENT_MESSAGE,
  ONE_PRIMARY_MESSAGE,
  planAssignmentSync,
  type ProviderGroupMembershipRow,
  validateGroupAssignments,
} from "./groupAssignments";

describe("validateGroupAssignments", () => {
  it("blocks removing the last assignment", () => {
    expect(validateGroupAssignments([])).toBe(LAST_ASSIGNMENT_MESSAGE);
  });

  it("requires exactly one primary", () => {
    expect(validateGroupAssignments([{ groupId: "a", isPrimary: false }])).toBe(
      ONE_PRIMARY_MESSAGE,
    );
    expect(
      validateGroupAssignments([
        { groupId: "a", isPrimary: true },
        { groupId: "b", isPrimary: true },
      ]),
    ).toBe(ONE_PRIMARY_MESSAGE);
    expect(
      validateGroupAssignments([
        { groupId: "a", isPrimary: true },
        { groupId: "b", isPrimary: false },
      ]),
    ).toBeNull();
  });

  it("rejects duplicate groups", () => {
    expect(
      validateGroupAssignments([
        { groupId: "a", isPrimary: true },
        { groupId: "a", isPrimary: false },
      ]),
    ).toMatch(/only once/);
  });
});

describe("planAssignmentSync", () => {
  it("plans inserts for a brand-new provider", () => {
    const plan = planAssignmentSync(
      [
        { groupId: "a", isPrimary: true },
        { groupId: "b", isPrimary: false },
      ],
      [],
    );
    expect(plan.inserts.map((i) => i.groupId)).toEqual(["a", "b"]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.demoteIds).toEqual([]);
    expect(plan.promoteId).toBeNull();
    expect(plan.primaryGroupId).toBe("a");
  });

  it("plans a primary swap as demote-then-promote (index-safe order)", () => {
    const plan = planAssignmentSync(
      [
        { groupId: "a", isPrimary: false },
        { groupId: "b", isPrimary: true },
      ],
      [
        { id: "row-a", groupId: "a", isPrimary: true },
        { id: "row-b", groupId: "b", isPrimary: false },
      ],
    );
    expect(plan.demoteIds).toEqual(["row-a"]);
    expect(plan.promoteId).toBe("row-b");
    expect(plan.inserts).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("plans removals and keeps the survivor primary", () => {
    const plan = planAssignmentSync(
      [{ groupId: "a", isPrimary: true }],
      [
        { id: "row-a", groupId: "a", isPrimary: true },
        { id: "row-b", groupId: "b", isPrimary: false },
      ],
    );
    expect(plan.deleteIds).toEqual(["row-b"]);
    expect(plan.demoteIds).toEqual([]);
    expect(plan.promoteId).toBeNull();
  });

  it("throws on an invalid target set (last-removal / no-primary)", () => {
    expect(() => planAssignmentSync([], [{ id: "r", groupId: "a", isPrimary: true }])).toThrow(
      LAST_ASSIGNMENT_MESSAGE,
    );
    expect(() => planAssignmentSync([{ groupId: "a", isPrimary: false }], [])).toThrow(
      ONE_PRIMARY_MESSAGE,
    );
  });
});

// 2026-08-19 — list-row group names. The extension's provider search shows the
// group beside the name because the same human can work under several.
describe("indexProviderGroups", () => {
  const row = (over: Partial<ProviderGroupMembershipRow> = {}): ProviderGroupMembershipRow => ({
    providerId: "p1",
    groupId: "g1",
    groupName: "Wellspring PT",
    isPrimary: false,
    endDate: null,
    ...over,
  });

  it("keeps every current membership, primary first then A→Z", () => {
    const byProvider = indexProviderGroups([
      row({ groupId: "g2", groupName: "Zenith Ortho" }),
      row({ groupId: "g3", groupName: "Acme Health" }),
      row({ groupId: "g1", groupName: "Wellspring PT", isPrimary: true }),
    ]);
    expect(byProvider.get("p1")?.map((g) => g.name)).toEqual([
      "Wellspring PT",
      "Acme Health",
      "Zenith Ortho",
    ]);
  });

  it("drops ended memberships — a provider who left is not labelled with it", () => {
    const byProvider = indexProviderGroups([
      row({ groupId: "g1", groupName: "Current Group" }),
      row({ groupId: "g2", groupName: "Former Group", endDate: "2026-01-31" }),
    ]);
    expect(byProvider.get("p1")?.map((g) => g.name)).toEqual(["Current Group"]);
  });

  it("drops a membership whose group name didn't resolve", () => {
    // An unreadable group embed yields no name; an unnamed chip is worse than
    // no chip.
    const byProvider = indexProviderGroups([
      row({ groupId: "g1", groupName: null }),
      row({ groupId: "g2", groupName: "   " }),
    ]);
    expect(byProvider.has("p1")).toBe(false);
  });

  it("de-duplicates a group repeated for one provider", () => {
    const byProvider = indexProviderGroups([row(), row()]);
    expect(byProvider.get("p1")).toHaveLength(1);
  });

  it("keeps providers separate", () => {
    const byProvider = indexProviderGroups([
      row({ providerId: "p1", groupName: "One" }),
      row({ providerId: "p2", groupId: "g2", groupName: "Two" }),
    ]);
    expect(byProvider.get("p1")?.[0]?.name).toBe("One");
    expect(byProvider.get("p2")?.[0]?.name).toBe("Two");
  });
});

describe("attachProviderGroups", () => {
  it("gives a group-less provider an EMPTY array, not an absent key", () => {
    // Absent means "not requested" on the wire — a real no-group provider must
    // still be renderable as such.
    const [attached] = attachProviderGroups([{ id: "p9" }], new Map());
    expect(attached?.groups).toEqual([]);
  });

  it("attaches without mutating the source row", () => {
    const source = { id: "p1", lastName: "Jones" };
    const byProvider = indexProviderGroups([
      {
        providerId: "p1",
        groupId: "g1",
        groupName: "Acme",
        isPrimary: true,
        endDate: null,
      },
    ]);
    const [attached] = attachProviderGroups([source], byProvider);
    expect(attached?.groups).toEqual([{ id: "g1", name: "Acme", isPrimary: true }]);
    expect(source).not.toHaveProperty("groups");
  });
});

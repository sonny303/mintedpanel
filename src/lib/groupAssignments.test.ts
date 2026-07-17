// E1.3 TE-10 — assignment invariants: ≥1 assignment (last-removal blocked),
// exactly one primary, and the demote-before-promote sync plan.
import { describe, expect, it } from "vitest";
import {
  LAST_ASSIGNMENT_MESSAGE,
  ONE_PRIMARY_MESSAGE,
  planAssignmentSync,
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

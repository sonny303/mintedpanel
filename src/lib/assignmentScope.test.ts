// E1.4 TE-8 — group-scoped selector, editor invariants (start date required,
// exactly one primary, remove-primary forces re-pick), and the sync plan.
import { describe, expect, it } from "vitest";
import {
  ONE_PRIMARY_ASSIGNMENT_MESSAGE,
  START_DATE_REQUIRED_MESSAGE,
  facilitiesForProviderGroups,
  planFacilityAssignmentSync,
  validateAssignmentDrafts,
} from "./assignmentScope";
import type { Facility } from "@/types";

function facility(over: Partial<Facility>): Facility {
  return {
    id: "f-1",
    orgId: "o-1",
    groupId: "g-1",
    name: "Clinic",
    street: null,
    city: null,
    state: null,
    zip: null,
    isActive: true,
    statusId: null,
    effectiveDate: null,
    referenceOnly: false,
    createdAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

describe("facilitiesForProviderGroups (group-scoped picker)", () => {
  const facilities = [
    facility({ id: "f-a", groupId: "g-1", name: "Group 1 Clinic" }),
    facility({ id: "f-b", groupId: "g-2", name: "Group 2 Clinic A" }),
    facility({ id: "f-c", groupId: "g-2", name: "Group 2 Clinic B" }),
    facility({ id: "f-d", groupId: null, name: "Ungrouped" }),
    facility({ id: "f-e", groupId: "g-1", name: "Inactive", isActive: false }),
  ];

  it("offers only the provider's groups' active facilities", () => {
    expect(facilitiesForProviderGroups(["g-1"], facilities).map((f) => f.id)).toEqual(["f-a"]);
    expect(facilitiesForProviderGroups(["g-2"], facilities).map((f) => f.id)).toEqual([
      "f-b",
      "f-c",
    ]);
    expect(facilitiesForProviderGroups(["g-1", "g-2"], facilities)).toHaveLength(3);
  });

  it("never offers ungrouped or inactive facilities, and none for no groups", () => {
    const offered = facilitiesForProviderGroups(["g-1", "g-2"], facilities).map((f) => f.id);
    expect(offered).not.toContain("f-d");
    expect(offered).not.toContain("f-e");
    expect(facilitiesForProviderGroups([], facilities)).toEqual([]);
  });
});

describe("validateAssignmentDrafts", () => {
  it("requires a start date on every assignment", () => {
    expect(validateAssignmentDrafts([{ facilityId: "f-a", startDate: "", isPrimary: true }])).toBe(
      START_DATE_REQUIRED_MESSAGE,
    );
  });

  it("requires exactly one primary when any assignments exist", () => {
    expect(
      validateAssignmentDrafts([{ facilityId: "f-a", startDate: "2026-01-01", isPrimary: false }]),
    ).toBe(ONE_PRIMARY_ASSIGNMENT_MESSAGE);
    expect(
      validateAssignmentDrafts([
        { facilityId: "f-a", startDate: "2026-01-01", isPrimary: true },
        { facilityId: "f-b", startDate: "2026-02-01", isPrimary: true },
      ]),
    ).toBe(ONE_PRIMARY_ASSIGNMENT_MESSAGE);
    expect(
      validateAssignmentDrafts([
        { facilityId: "f-a", startDate: "2026-01-01", isPrimary: true },
        { facilityId: "f-b", startDate: "2026-02-01", isPrimary: false },
      ]),
    ).toBeNull();
  });

  it("an empty set is valid (the wizard reflects the gap as progress)", () => {
    expect(validateAssignmentDrafts([])).toBeNull();
  });
});

describe("planFacilityAssignmentSync", () => {
  const stored = [
    { id: "row-a", facilityId: "f-a", isPrimary: true, startDate: "2026-01-01" },
    { id: "row-b", facilityId: "f-b", isPrimary: false, startDate: "2026-02-01" },
  ];

  it("plans inserts/updates/deletes and detects a needed primary swap", () => {
    const plan = planFacilityAssignmentSync(
      [
        { facilityId: "f-b", startDate: "2026-02-15", isPrimary: true },
        { facilityId: "f-c", startDate: "2026-03-01", isPrimary: false },
      ],
      stored,
    );
    expect(plan.deleteIds).toEqual(["row-a"]);
    expect(plan.inserts.map((i) => i.facilityId)).toEqual(["f-c"]);
    expect(plan.updates).toEqual([{ id: "row-b", startDate: "2026-02-15" }]);
    expect(plan.primaryFacilityId).toBe("f-b");
    expect(plan.primaryAlreadySet).toBe(false);
  });

  it("recognizes when the stored primary already matches (no swap needed)", () => {
    const plan = planFacilityAssignmentSync(
      [
        { facilityId: "f-a", startDate: "2026-01-01", isPrimary: true },
        { facilityId: "f-b", startDate: "2026-02-01", isPrimary: false },
      ],
      stored,
    );
    expect(plan.primaryAlreadySet).toBe(true);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("removing the primary without re-picking is rejected (re-pick forced)", () => {
    expect(() =>
      planFacilityAssignmentSync(
        [{ facilityId: "f-b", startDate: "2026-02-01", isPrimary: false }],
        stored,
      ),
    ).toThrow(ONE_PRIMARY_ASSIGNMENT_MESSAGE);
  });

  it("clearing every assignment is a pure delete plan", () => {
    const plan = planFacilityAssignmentSync([], stored);
    expect(plan.deleteIds).toEqual(["row-a", "row-b"]);
    expect(plan.primaryFacilityId).toBeNull();
  });
});

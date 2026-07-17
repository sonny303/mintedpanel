// E2.1 TE-9 — the migration's safety-net backfill rule order, pinned as pure
// logic. 20260713150000_case_key_4part.sql mirrors resolveBackfillGroupId
// exactly; a change to either must change both.
import { describe, expect, it } from "vitest";
import {
  resolveBackfillGroupId,
  type BackfillAssignmentInput,
  type BackfillFacilityInput,
} from "./caseKeyBackfill";

const facilities: BackfillFacilityInput[] = [
  { id: "fac-grouped", groupId: "g-facility" },
  { id: "fac-ungrouped", groupId: null },
];

const assignments: BackfillAssignmentInput[] = [
  { providerId: "multi", groupId: "g-a", isPrimary: false },
  { providerId: "multi", groupId: "g-primary", isPrimary: true },
  { providerId: "sole", groupId: "g-sole", isPrimary: false },
  { providerId: "multi-none-primary", groupId: "g-x", isPrimary: false },
  { providerId: "multi-none-primary", groupId: "g-y", isPrimary: false },
];

describe("resolveBackfillGroupId (TE-1 rule order)", () => {
  it("(a) facility lineage wins over every assignment rule", () => {
    expect(
      resolveBackfillGroupId(
        { providerId: "multi", facilityId: "fac-grouped", groupId: null },
        facilities,
        assignments,
      ),
    ).toBe("g-facility");
  });

  it("(a) skips an ungrouped facility and falls through to (b)/(c)", () => {
    expect(
      resolveBackfillGroupId(
        { providerId: "sole", facilityId: "fac-ungrouped", groupId: null },
        facilities,
        assignments,
      ),
    ).toBe("g-sole");
  });

  it("(b) a sole assignment resolves even when it is not primary", () => {
    expect(
      resolveBackfillGroupId(
        { providerId: "sole", facilityId: null, groupId: null },
        facilities,
        assignments,
      ),
    ).toBe("g-sole");
  });

  it("(c) among several assignments, the primary one resolves", () => {
    expect(
      resolveBackfillGroupId(
        { providerId: "multi", facilityId: null, groupId: null },
        facilities,
        assignments,
      ),
    ).toBe("g-primary");
  });

  it("(d) several assignments with no primary stay NULL (3-part rule binds)", () => {
    expect(
      resolveBackfillGroupId(
        { providerId: "multi-none-primary", facilityId: null, groupId: null },
        facilities,
        assignments,
      ),
    ).toBeNull();
  });

  it("(d) no facility and no assignments stays NULL", () => {
    expect(
      resolveBackfillGroupId(
        { providerId: "unknown", facilityId: null, groupId: null },
        facilities,
        assignments,
      ),
    ).toBeNull();
  });

  it("never rewrites a case that already carries a group", () => {
    expect(
      resolveBackfillGroupId(
        { providerId: "multi", facilityId: "fac-grouped", groupId: "g-already" },
        facilities,
        assignments,
      ),
    ).toBe("g-already");
  });
});

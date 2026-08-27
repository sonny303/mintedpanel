import { describe, expect, it } from "vitest";
import {
  caseFacilityOptions,
  facilitiesForCaseProvider,
  isEligibleCaseFacility,
  pickNextPrimaryCaseFacility,
  resolveCaseFacilityId,
  type CaseFacilityAssignmentRef,
  type CaseFacilityRef,
} from "./caseFacility";
import type { Facility, FacilityAssignment } from "@/types";

function fac(over: Partial<CaseFacilityRef> & { id: string }): CaseFacilityRef {
  return {
    groupId: "g-1",
    isActive: true,
    ...over,
  };
}

function asn(
  over: Partial<CaseFacilityAssignmentRef> & { facilityId: string },
): CaseFacilityAssignmentRef {
  return {
    providerId: "p-1",
    isPrimary: false,
    ...over,
  };
}

describe("resolveCaseFacilityId", () => {
  it("returns null when the case has no group", () => {
    expect(
      resolveCaseFacilityId(
        "p-1",
        null,
        [asn({ facilityId: "f-1", isPrimary: true })],
        [fac({ id: "f-1" })],
      ),
    ).toBeNull();
  });

  it("returns null when the provider has no assignment under the group", () => {
    expect(
      resolveCaseFacilityId(
        "p-1",
        "g-1",
        [asn({ facilityId: "f-other", providerId: "p-2" })],
        [fac({ id: "f-other", groupId: "g-1" }), fac({ id: "f-1", groupId: "g-2" })],
      ),
    ).toBeNull();
  });

  it("stamps the sole active facility under the group", () => {
    expect(
      resolveCaseFacilityId(
        "p-1",
        "g-1",
        [asn({ facilityId: "f-1" }), asn({ facilityId: "f-2", providerId: "p-1" })],
        [
          fac({ id: "f-1", groupId: "g-1" }),
          fac({ id: "f-2", groupId: "g-2" }), // different group — ignored
        ],
      ),
    ).toBe("f-1");
  });

  it("stamps the primary when several facilities sit under the group", () => {
    expect(
      resolveCaseFacilityId(
        "p-1",
        "g-1",
        [
          asn({ facilityId: "f-a", isPrimary: false }),
          asn({ facilityId: "f-b", isPrimary: true }),
          asn({ facilityId: "f-c", isPrimary: false }),
        ],
        [
          fac({ id: "f-a", groupId: "g-1" }),
          fac({ id: "f-b", groupId: "g-1" }),
          fac({ id: "f-c", groupId: "g-1" }),
        ],
      ),
    ).toBe("f-b");
  });

  it("returns null when several facilities exist and none is primary", () => {
    expect(
      resolveCaseFacilityId(
        "p-1",
        "g-1",
        [asn({ facilityId: "f-a" }), asn({ facilityId: "f-b" })],
        [fac({ id: "f-a" }), fac({ id: "f-b" })],
      ),
    ).toBeNull();
  });

  it("ignores inactive facilities when stamping", () => {
    expect(
      resolveCaseFacilityId(
        "p-1",
        "g-1",
        [asn({ facilityId: "f-dead", isPrimary: true }), asn({ facilityId: "f-live" })],
        [fac({ id: "f-dead", isActive: false }), fac({ id: "f-live" })],
      ),
    ).toBe("f-live");
  });

  it("returns null when only inactive facilities remain", () => {
    expect(
      resolveCaseFacilityId(
        "p-1",
        "g-1",
        [asn({ facilityId: "f-dead", isPrimary: true })],
        [fac({ id: "f-dead", isActive: false })],
      ),
    ).toBeNull();
  });
});

describe("facilitiesForCaseProvider / eligibility", () => {
  it("lists only assigned active facilities for the case group", () => {
    expect(
      facilitiesForCaseProvider(
        "p-1",
        "g-1",
        [asn({ facilityId: "f-1" }), asn({ facilityId: "f-2" })],
        [
          fac({ id: "f-1", groupId: "g-1" }),
          fac({ id: "f-2", groupId: "g-2" }),
          fac({ id: "f-3", groupId: "g-1" }), // not assigned
        ],
      ),
    ).toEqual(["f-1"]);
  });

  it("can include an inactive current id for the editor", () => {
    expect(
      facilitiesForCaseProvider(
        "p-1",
        "g-1",
        [asn({ facilityId: "f-dead" })],
        [fac({ id: "f-dead", isActive: false })],
        { includeInactiveIds: new Set(["f-dead"]) },
      ),
    ).toEqual(["f-dead"]);
  });

  it("treats null facilityId as eligible (clear)", () => {
    expect(isEligibleCaseFacility(null, "p-1", "g-1", [], [])).toBe(true);
  });

  it("rejects a facility outside the provider×group set", () => {
    expect(
      isEligibleCaseFacility(
        "f-x",
        "p-1",
        "g-1",
        [asn({ facilityId: "f-1" })],
        [fac({ id: "f-1" }), fac({ id: "f-x", groupId: "g-2" })],
      ),
    ).toBe(false);
  });
});

describe("caseFacilityOptions", () => {
  it("returns Facility rows sorted by name, including inactive current", () => {
    const facilities: Facility[] = [
      {
        id: "f-b",
        orgId: "o",
        groupId: "g-1",
        name: "Beta",
        street: null,
        city: null,
        state: null,
        zip: null,
        isActive: true,
        statusId: null,
        effectiveDate: null,
        referenceOnly: false,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "f-a",
        orgId: "o",
        groupId: "g-1",
        name: "Alpha",
        street: null,
        city: null,
        state: null,
        zip: null,
        isActive: false,
        statusId: null,
        effectiveDate: null,
        referenceOnly: false,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const assignments: FacilityAssignment[] = [
      {
        id: "a1",
        orgId: "o",
        providerId: "p-1",
        facilityId: "f-a",
        isPrimary: true,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "a2",
        orgId: "o",
        providerId: "p-1",
        facilityId: "f-b",
        isPrimary: false,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const opts = caseFacilityOptions("p-1", "g-1", assignments, facilities, "f-a");
    expect(opts.map((f) => f.id)).toEqual(["f-a", "f-b"]);
  });
});

describe("pickNextPrimaryCaseFacility", () => {
  it("returns null when no locations remain", () => {
    expect(pickNextPrimaryCaseFacility([])).toBeNull();
  });

  it("promotes the sole remaining location", () => {
    expect(pickNextPrimaryCaseFacility([{ facilityId: "f-1", facilityName: "Alpha" }])).toBe("f-1");
  });

  it("promotes alphabetically by name, not insertion order", () => {
    expect(
      pickNextPrimaryCaseFacility([
        { facilityId: "f-z", facilityName: "Zeta Clinic" },
        { facilityId: "f-a", facilityName: "Alpha Clinic" },
        { facilityId: "f-m", facilityName: "Midtown Clinic" },
      ]),
    ).toBe("f-a");
  });

  it("is case-insensitive-ish per localeCompare (matches caseFacilityOptions' sort)", () => {
    expect(
      pickNextPrimaryCaseFacility([
        { facilityId: "f-b", facilityName: "beta" },
        { facilityId: "f-a", facilityName: "Alpha" },
      ]),
    ).toBe("f-a");
  });
});

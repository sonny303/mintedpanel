// E1.1 (Track B) — the case_facilities service contract: addCaseFacility /
// removeCaseFacility / setPrimaryCaseFacility / getCaseFacilities. Same
// module family as cases.ts's setCaseFacility (browser-path: anon client +
// audit helpers) — mock both so the suite drives the query builder and
// observes audit writes, same shape as touches.di.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({
  from: (_table: string): unknown => {
    throw new Error("no fake db installed");
  },
}));
const writeAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (table: string) => holder.from(table) },
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: writeAuditMock,
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  currentUserRole: () => "specialist",
}));

import {
  addCaseFacility,
  getCaseFacilities,
  removeCaseFacility,
  setPrimaryCaseFacility,
} from "./cases";

interface Captured {
  table: string;
  op?: "select" | "insert" | "update" | "delete";
  selectCols?: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

// Chainable fake: select/insert/update/delete/eq return the (thenable)
// builder; single/maybeSingle/a bare await all consume the next queued
// result in call order. Results for a Promise.all() batch are consumed in
// the order the .from() calls are WRITTEN (each call captures synchronously
// at promise-construction time, before any await) — the providerCases.di /
// touches.di precedent.
function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const from = (table: string) => {
    const cap: Captured = { table, filters: [] };
    captures.push(cap);
    const builder: Record<string, unknown> = {
      select(cols: string) {
        if (!cap.op) cap.op = "select";
        cap.selectCols = cols;
        return builder;
      },
      insert(payload: unknown) {
        cap.op = "insert";
        cap.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        cap.op = "update";
        cap.payload = payload;
        return builder;
      },
      delete() {
        cap.op = "delete";
        return builder;
      },
      eq(col: string, val: unknown) {
        cap.filters.push([col, val]);
        return builder;
      },
      maybeSingle: () => Promise.resolve(take()),
      single: () => Promise.resolve(take()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(take()).then(onF, onR),
    };
    return builder;
  };
  return { from, captures };
}

function installDb(results: Array<{ data: unknown; error?: unknown }>) {
  const fake = makeFakeDb(results);
  holder.from = fake.from;
  return fake.captures;
}

beforeEach(() => {
  writeAuditMock.mockReset();
  writeAuditMock.mockResolvedValue(undefined);
});

const CASE_ROW = { id: "case-1", provider_id: "prov-1", group_id: "grp-1" };
const FACILITIES = [
  { id: "fac-1", group_id: "grp-1", is_active: true },
  { id: "fac-2", group_id: "grp-1", is_active: true },
];
const ASSIGNMENTS = [
  { provider_id: "prov-1", facility_id: "fac-1", is_primary: true },
  { provider_id: "prov-1", facility_id: "fac-2", is_primary: false },
];

describe("addCaseFacility", () => {
  it("the first location on a case becomes primary and mirrors credential_cases.facility_id", async () => {
    const captures = installDb([
      { data: CASE_ROW }, // credential_cases read
      { data: FACILITIES }, // facilities
      { data: ASSIGNMENTS }, // provider_facility_assignments
      { data: [] }, // case_facilities existing (empty -> first)
      { data: { id: "cf-1" } }, // insert
      { data: null }, // credential_cases mirror update
    ]);

    await addCaseFacility("case-1", "fac-1");

    expect(captures.map((c) => c.table)).toEqual([
      "credential_cases",
      "facilities",
      "provider_facility_assignments",
      "case_facilities",
      "case_facilities",
      "credential_cases",
    ]);
    const insertCap = captures[4];
    expect(insertCap.op).toBe("insert");
    expect(insertCap.payload).toMatchObject({
      org_id: "org-1",
      case_id: "case-1",
      facility_id: "fac-1",
      is_primary: true,
      created_by: "user-1",
    });
    const mirrorCap = captures[5];
    expect(mirrorCap.op).toBe("update");
    expect(mirrorCap.payload).toMatchObject({ facility_id: "fac-1" });
    expect(mirrorCap.filters).toContainEqual(["id", "case-1"]);

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        entityType: "case_facility",
        entityId: "cf-1",
        after: { caseId: "case-1", facilityId: "fac-1", isPrimary: true },
      }),
    );
  });

  it("a second location is non-primary and does NOT touch the credential_cases mirror", async () => {
    const captures = installDb([
      { data: CASE_ROW },
      { data: FACILITIES },
      { data: ASSIGNMENTS },
      { data: [{ id: "cf-existing", facility_id: "fac-1", is_primary: true }] },
      { data: { id: "cf-2" } },
    ]);

    await addCaseFacility("case-1", "fac-2");

    // No sixth (credential_cases mirror) capture this time.
    expect(captures.map((c) => c.table)).toEqual([
      "credential_cases",
      "facilities",
      "provider_facility_assignments",
      "case_facilities",
      "case_facilities",
    ]);
    expect(captures[4].payload).toMatchObject({ is_primary: false });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        after: { caseId: "case-1", facilityId: "fac-2", isPrimary: false },
      }),
    );
  });

  it("rejects a facility outside the provider's assignments under the case's group", async () => {
    installDb([{ data: CASE_ROW }, { data: FACILITIES }, { data: ASSIGNMENTS }, { data: [] }]);

    await expect(addCaseFacility("case-1", "fac-outside")).rejects.toThrow(
      "Facility must be one of this provider's locations under the case's group.",
    );
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("rejects a facility already attached to the case", async () => {
    installDb([
      { data: CASE_ROW },
      { data: FACILITIES },
      { data: ASSIGNMENTS },
      { data: [{ id: "cf-existing", facility_id: "fac-1", is_primary: true }] },
    ]);

    await expect(addCaseFacility("case-1", "fac-1")).rejects.toThrow(
      "Facility is already a location on this case.",
    );
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("throws when the case is not found in the org", async () => {
    installDb([{ data: null }]);
    await expect(addCaseFacility("case-missing", "fac-1")).rejects.toThrow("Case not found");
  });
});

describe("removeCaseFacility", () => {
  it("removing a non-primary location only deletes the row — no mirror change", async () => {
    const rows = [
      { id: "cf-1", facility_id: "fac-1", is_primary: true, facility: { name: "Alpha" } },
      { id: "cf-2", facility_id: "fac-2", is_primary: false, facility: { name: "Beta" } },
    ];
    const captures = installDb([{ data: rows }, { data: null }]);

    await removeCaseFacility("case-1", "fac-2");

    expect(captures.map((c) => c.table)).toEqual(["case_facilities", "case_facilities"]);
    expect(captures[1].op).toBe("delete");
    expect(captures[1].filters).toContainEqual(["id", "cf-2"]);

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "DELETE",
        entityType: "case_facility",
        entityId: "cf-2",
        before: { caseId: "case-1", facilityId: "fac-2", isPrimary: false },
        after: null,
      }),
    );
  });

  it("removing the primary with other locations remaining auto-promotes the next by name, and updates the mirror", async () => {
    const rows = [
      { id: "cf-1", facility_id: "fac-1", is_primary: true, facility: { name: "Zebra Clinic" } },
      { id: "cf-2", facility_id: "fac-2", is_primary: false, facility: { name: "Alpha Clinic" } },
      { id: "cf-3", facility_id: "fac-3", is_primary: false, facility: { name: "Midtown" } },
    ];
    const captures = installDb([
      { data: rows }, // read
      { data: null }, // delete
      { data: null }, // promote cf-2 (alpha, wins alphabetically)
      { data: null }, // mirror update
    ]);

    await removeCaseFacility("case-1", "fac-1");

    expect(captures.map((c) => `${c.table}:${c.op}`)).toEqual([
      "case_facilities:select",
      "case_facilities:delete",
      "case_facilities:update",
      "credential_cases:update",
    ]);
    const promoteCap = captures[2];
    expect(promoteCap.payload).toMatchObject({ is_primary: true });
    expect(promoteCap.filters).toContainEqual(["facility_id", "fac-2"]);
    const mirrorCap = captures[3];
    expect(mirrorCap.payload).toMatchObject({ facility_id: "fac-2" });

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { caseId: "case-1", facilityId: "fac-1", isPrimary: true },
        after: { promotedFacilityId: "fac-2" },
      }),
    );
  });

  it("removing the case's last location clears the credential_cases mirror to null", async () => {
    const rows = [
      { id: "cf-1", facility_id: "fac-1", is_primary: true, facility: { name: "Alpha" } },
    ];
    const captures = installDb([{ data: rows }, { data: null }, { data: null }]);

    await removeCaseFacility("case-1", "fac-1");

    // delete, then straight to the mirror clear (no promote update — nothing
    // remains to promote).
    expect(captures.map((c) => `${c.table}:${c.op}`)).toEqual([
      "case_facilities:select",
      "case_facilities:delete",
      "credential_cases:update",
    ]);
    expect(captures[2].payload).toMatchObject({ facility_id: null });

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        after: { promotedFacilityId: null },
      }),
    );
  });

  it("throws when the facility isn't one of the case's locations", async () => {
    installDb([{ data: [] }]);
    await expect(removeCaseFacility("case-1", "fac-ghost")).rejects.toThrow(
      "Location not found on this case",
    );
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});

describe("setPrimaryCaseFacility", () => {
  it("re-points primary: demotes the old primary before promoting the target, then updates the mirror", async () => {
    const rows = [
      { id: "cf-1", facility_id: "fac-1", is_primary: true },
      { id: "cf-2", facility_id: "fac-2", is_primary: false },
    ];
    const captures = installDb([
      { data: rows }, // read
      { data: null }, // demote cf-1
      { data: null }, // promote cf-2
      { data: null }, // mirror update
    ]);

    await setPrimaryCaseFacility("case-1", "fac-2");

    expect(captures.map((c) => `${c.table}:${c.op}`)).toEqual([
      "case_facilities:select",
      "case_facilities:update",
      "case_facilities:update",
      "credential_cases:update",
    ]);
    // Demote happens BEFORE promote — the partial-unique-index safety order.
    expect(captures[1].payload).toMatchObject({ is_primary: false });
    expect(captures[1].filters).toContainEqual(["id", "cf-1"]);
    expect(captures[2].payload).toMatchObject({ is_primary: true });
    expect(captures[2].filters).toContainEqual(["id", "cf-2"]);
    expect(captures[3].payload).toMatchObject({ facility_id: "fac-2" });

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "case_facility",
        entityId: "cf-2",
        before: { primaryFacilityId: "fac-1" },
        after: { primaryFacilityId: "fac-2" },
      }),
    );
  });

  it("is a no-op when the target is already primary — no writes, no audit", async () => {
    const rows = [
      { id: "cf-1", facility_id: "fac-1", is_primary: true },
      { id: "cf-2", facility_id: "fac-2", is_primary: false },
    ];
    const captures = installDb([{ data: rows }]);

    await setPrimaryCaseFacility("case-1", "fac-1");

    expect(captures).toHaveLength(1); // only the read
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("throws when facilityId is not one of the case's existing locations (not add-and-promote)", async () => {
    const rows = [{ id: "cf-1", facility_id: "fac-1", is_primary: true }];
    installDb([{ data: rows }]);

    await expect(setPrimaryCaseFacility("case-1", "fac-new")).rejects.toThrow(
      "Facility is not one of this case's locations.",
    );
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("skips the demote step when no row is currently primary (legacy/empty state)", async () => {
    const rows = [{ id: "cf-1", facility_id: "fac-1", is_primary: false }];
    const captures = installDb([
      { data: rows },
      { data: null }, // promote cf-1
      { data: null }, // mirror update
    ]);

    await setPrimaryCaseFacility("case-1", "fac-1");

    expect(captures.map((c) => `${c.table}:${c.op}`)).toEqual([
      "case_facilities:select",
      "case_facilities:update",
      "credential_cases:update",
    ]);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ before: { primaryFacilityId: null } }),
    );
  });
});

describe("getCaseFacilities", () => {
  it("org-scopes the read and sorts the joined rows by facility name", async () => {
    const rows = [
      {
        id: "cf-2",
        org_id: "org-1",
        case_id: "case-1",
        facility_id: "fac-2",
        is_primary: false,
        created_at: "2026-08-01T00:00:00Z",
        created_by: "user-1",
        facility: {
          id: "fac-2",
          name: "Zebra Clinic",
          street: null,
          city: null,
          state: null,
          zip: null,
          is_active: true,
        },
      },
      {
        id: "cf-1",
        org_id: "org-1",
        case_id: "case-1",
        facility_id: "fac-1",
        is_primary: true,
        created_at: "2026-08-01T00:00:00Z",
        created_by: null,
        facility: {
          id: "fac-1",
          name: "Alpha Clinic",
          street: null,
          city: null,
          state: null,
          zip: null,
          is_active: true,
        },
      },
    ];
    const captures = installDb([{ data: rows }]);

    const result = await getCaseFacilities("case-1");

    expect(captures[0].table).toBe("case_facilities");
    expect(captures[0].filters).toContainEqual(["case_id", "case-1"]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures[0].selectCols).not.toContain("*");

    expect(result.map((r) => r.facility.name)).toEqual(["Alpha Clinic", "Zebra Clinic"]);
    expect(result.map((r) => r.id)).toEqual(["cf-1", "cf-2"]);
    expect(result[0].isPrimary).toBe(true);
  });
});

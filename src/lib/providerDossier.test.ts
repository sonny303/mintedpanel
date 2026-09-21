import { describe, expect, it } from "vitest";
import { fmtDate } from "@/lib/format";
import {
  FORBIDDEN_DOSSIER_COLUMNS,
  PROVIDER_DOSSIER_COLUMNS,
  aggregateProviderDossier,
  dossierHeader,
  formatGroupTinsForCopy,
  formatLicensesForCopy,
  isType1Npi,
} from "./providerDossier";

const ORGS = new Map([
  ["org-a", "Kansas PT"],
  ["org-b", "Missouri Rehab"],
]);

function provider(over: Record<string, unknown> = {}) {
  return {
    id: "p-a",
    org_id: "org-a",
    first_name: "Marc",
    last_name: "Ng",
    credentials: "PT",
    npi: "1234567890",
    status: "active",
    organizations: { name: "Kansas PT" },
    state_licenses: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    ...over,
  };
}

function license(over: Record<string, unknown> = {}) {
  return {
    id: "lic-1",
    org_id: "org-a",
    state: "KS",
    license_number: "KS-100",
    license_type: "PT",
    expiration_date: "2027-01-02",
    status: "active",
    verified_status: "verified",
    ...over,
  };
}

describe("isType1Npi", () => {
  it("accepts a 10-digit NPI and rejects anything else", () => {
    expect(isType1Npi("1234567890")).toBe(true);
    expect(isType1Npi("123456789")).toBe(false);
    expect(isType1Npi("12345678901")).toBe(false);
    expect(isType1Npi("123456789A")).toBe(false);
    expect(isType1Npi(null)).toBe(false);
  });
});

describe("PROVIDER_DOSSIER_COLUMNS", () => {
  it("embeds the footprint tables and names no sensitive column", () => {
    expect(PROVIDER_DOSSIER_COLUMNS).toContain("state_licenses(");
    expect(PROVIDER_DOSSIER_COLUMNS).toContain("provider_group_assignments(");
    expect(PROVIDER_DOSSIER_COLUMNS).toContain("provider_groups(");
    expect(PROVIDER_DOSSIER_COLUMNS).toContain("facilities(");
    expect(PROVIDER_DOSSIER_COLUMNS).not.toContain("*");
    for (const column of FORBIDDEN_DOSSIER_COLUMNS) {
      expect(PROVIDER_DOSSIER_COLUMNS).not.toContain(column);
    }
  });
});

describe("aggregateProviderDossier", () => {
  it("collapses one license recorded in two orgs and flags an expiration conflict", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({
          state_licenses: [license()],
          provider_group_assignments: [
            {
              id: "as-a",
              org_id: "org-a",
              is_primary: true,
              provider_groups: {
                id: "g-a",
                name: "Kansas Group",
                npi_type2: "1987654321",
                tin: "11-1111111",
              },
            },
          ],
          provider_facility_assignments: [
            {
              id: "fa-a",
              org_id: "org-a",
              is_primary: true,
              facilities: { id: "f-a", name: "Kansas Clinic", city: "Kansas City", state: "KS" },
            },
          ],
        }),
        provider({
          id: "p-b",
          org_id: "org-b",
          organizations: { name: "Missouri Rehab" },
          state_licenses: [
            license({
              id: "lic-2",
              org_id: "org-b",
              expiration_date: "2026-06-01",
            }),
            license({
              id: "lic-3",
              org_id: "org-b",
              state: "MO",
              license_number: "MO-200",
              expiration_date: "2028-03-04",
            }),
          ],
          provider_group_assignments: [
            {
              id: "as-b",
              org_id: "org-b",
              is_primary: false,
              provider_groups: {
                id: "g-b",
                name: "Missouri Group",
                npi_type2: null,
                tin: "22-2222222",
              },
            },
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    expect(dossier.affiliations.map((row) => row.orgName)).toEqual(["Kansas PT", "Missouri Rehab"]);
    expect(dossier.licenses).toHaveLength(2);
    const kansas = dossier.licenses.find((row) => row.state === "KS");
    expect(kansas?.conflictFields).toEqual(["expiration"]);
    expect(kansas?.expirationDate).toBe("2027-01-02");
    expect(kansas?.sources.map((source) => source.orgName)).toEqual([
      "Kansas PT",
      "Missouri Rehab",
    ]);
    expect(dossier.licenses.find((row) => row.state === "MO")?.conflictFields).toEqual([]);
    expect(dossier.groups.map((row) => row.name)).toEqual(["Kansas Group", "Missouri Group"]);
    expect(dossier.groups.every((row) => row.sharedTin)).toBe(false);
    expect(dossier.facilities.map((row) => row.name)).toEqual(["Kansas Clinic"]);
  });

  it("does not merge licenses that have no number", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({
          state_licenses: [
            license({ id: "lic-1", license_number: null }),
            license({ id: "lic-2", license_number: "  ", org_id: "org-a" }),
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    expect(dossier.licenses).toHaveLength(2);
    expect(dossier.licenses.every((row) => row.conflictFields.length === 0)).toBe(true);
  });

  it("flags a TIN shared by two groups and keeps both rows", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({
          provider_group_assignments: [
            {
              id: "as-a",
              org_id: "org-a",
              is_primary: true,
              provider_groups: {
                id: "g-a",
                name: "Kansas Group",
                npi_type2: null,
                tin: "11-1111111",
              },
            },
          ],
        }),
        provider({
          id: "p-b",
          org_id: "org-b",
          provider_group_assignments: [
            {
              id: "as-b",
              org_id: "org-b",
              is_primary: false,
              provider_groups: {
                id: "g-b",
                name: "Missouri Group",
                npi_type2: null,
                tin: "111111111",
              },
            },
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    expect(dossier.groups).toHaveLength(2);
    expect(dossier.groups.every((row) => row.sharedTin)).toBe(true);
  });

  it("does not flag sharedTin when multiple assignments point to the same group", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({
          provider_group_assignments: [
            {
              id: "as-a1",
              org_id: "org-a",
              is_primary: true,
              provider_groups: {
                id: "g-a",
                name: "Kansas Group",
                npi_type2: null,
                tin: "11-1111111",
              },
            },
            {
              id: "as-a2",
              org_id: "org-a",
              is_primary: false,
              provider_groups: {
                id: "g-a",
                name: "Kansas Group",
                npi_type2: null,
                tin: "11-1111111",
              },
            },
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    expect(dossier.groups).toHaveLength(2);
    expect(dossier.groups.every((row) => row.sharedTin)).toBe(false);
  });

  it("treats an ISO timestamp and a date-only expiration as the same day", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({
          state_licenses: [license({ expiration_date: "2027-01-02T00:00:00Z" })],
        }),
        provider({
          id: "p-b",
          org_id: "org-b",
          state_licenses: [
            license({ id: "lic-2", org_id: "org-b", expiration_date: "2027-01-02" }),
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    const kansas = dossier.licenses.find((row) => row.state === "KS");
    expect(kansas?.conflictFields).toEqual([]);
    expect(kansas?.expirationDate).toBe("2027-01-02");
  });

  it("drops a non-member org and every child hanging off it", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({ state_licenses: [license()] }),
        provider({
          id: "p-x",
          org_id: "org-foreign",
          first_name: "Other",
          last_name: "Person",
          organizations: { name: "Foreign Health" },
          state_licenses: [
            license({ id: "lic-x", org_id: "org-foreign", state: "CA", license_number: "CA-9" }),
          ],
          provider_group_assignments: [
            {
              id: "as-x",
              org_id: "org-foreign",
              is_primary: true,
              provider_groups: {
                id: "g-x",
                name: "Foreign Group",
                npi_type2: null,
                tin: "99-9999999",
              },
            },
          ],
          provider_facility_assignments: [
            {
              id: "fa-x",
              org_id: "org-foreign",
              is_primary: true,
              facilities: { id: "f-x", name: "Foreign Clinic", city: "Austin", state: "TX" },
            },
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    expect(dossier.affiliations.map((row) => row.providerId)).toEqual(["p-a"]);
    expect(dossier.licenses.map((row) => row.state)).toEqual(["KS"]);
    expect(dossier.groups).toEqual([]);
    expect(dossier.facilities).toEqual([]);
  });

  it("ignores a row whose NPI is not the one requested", () => {
    const dossier = aggregateProviderDossier(
      [provider({ npi: "0000000000", state_licenses: [license()] })],
      ORGS,
      "1234567890",
    );
    expect(dossier.affiliations).toEqual([]);
    expect(dossier.licenses).toEqual([]);
  });
});

describe("dossierHeader", () => {
  it("uses the inspected row's name and lists the others", () => {
    const dossier = aggregateProviderDossier(
      [
        provider(),
        provider({
          id: "p-b",
          org_id: "org-b",
          first_name: "Marcus",
          last_name: "Ng",
          credentials: "DPT",
        }),
      ],
      ORGS,
      "1234567890",
    );

    expect(dossierHeader(dossier, "p-b")).toEqual({
      name: "Marcus Ng",
      credentials: "DPT",
      otherNames: ["Marc Ng"],
    });
  });

  it("handles empty affiliations safely without throwing", () => {
    expect(
      dossierHeader(
        {
          npi: "1234567890",
          affiliations: [],
          licenses: [],
          groups: [],
          facilities: [],
        },
        null,
      ),
    ).toEqual({
      name: "Provider",
      credentials: null,
      otherNames: [],
    });
  });
});

describe("copy formatters", () => {
  it("lists every collapsed license and marks a conflict", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({ state_licenses: [license()] }),
        provider({
          id: "p-b",
          org_id: "org-b",
          state_licenses: [
            license({ id: "lic-2", org_id: "org-b", expiration_date: "2026-06-01" }),
            license({
              id: "lic-3",
              org_id: "org-b",
              state: "MO",
              license_number: "MO-200",
              expiration_date: "2028-03-04",
            }),
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    const text = formatLicensesForCopy(dossier.licenses);
    expect(text).toContain("KS");
    expect(text).toContain("KS-100");
    expect(text).toContain(fmtDate("2027-01-02"));
    expect(text).toContain("differs across organizations");
    expect(text).toContain("MO-200");
    expect(text).not.toContain("CA-9");
  });

  it("copies group name, TIN, and org, skipping a group with no TIN", () => {
    const dossier = aggregateProviderDossier(
      [
        provider({
          provider_group_assignments: [
            {
              id: "as-a",
              org_id: "org-a",
              is_primary: true,
              provider_groups: {
                id: "g-a",
                name: "Kansas Group",
                npi_type2: null,
                tin: "11-1111111",
              },
            },
            {
              id: "as-b",
              org_id: "org-a",
              is_primary: false,
              provider_groups: { id: "g-b", name: "No Tin Group", npi_type2: null, tin: null },
            },
          ],
        }),
      ],
      ORGS,
      "1234567890",
    );

    expect(formatGroupTinsForCopy(dossier.groups)).toBe("Kansas Group · 11-1111111 · Kansas PT");
  });
});

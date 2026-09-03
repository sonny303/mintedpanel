import { describe, it, expect } from "vitest";
import {
  buildProviderTokenValues,
  mapPdfFields,
  pdfFillFileStem,
  resolvePdfValues,
} from "./pdfFill";
import type { Facility, FieldDictionaryEntry, Provider, ProviderGroup } from "@/types";
import type { StateLicense } from "@/services/lookups";
import type { InsurancePolicy } from "@/services/orgSettings";

function dictEntry(
  labelNormalized: string,
  token: string,
  status: FieldDictionaryEntry["status"] = "confirmed",
): FieldDictionaryEntry {
  return {
    id: `d-${labelNormalized}`,
    orgId: "org-1",
    labelNormalized,
    token,
    status,
    seenCount: 2,
    decidedAt: null,
    decidedBy: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

describe("mapPdfFields", () => {
  it("normalizes the PDF field name and matches a confirmed dictionary rule", () => {
    const dict = [
      dictEntry("first name", "provider.firstName"),
      dictEntry("tax id number", "group.tin"),
    ];
    // Casing, trailing ":" and "*", and extra whitespace must all normalize away.
    const mappings = mapPdfFields(["First Name:", "  TAX ID   NUMBER *"], dict);
    expect(mappings).toEqual([
      { field: "First Name:", token: "provider.firstName" },
      { field: "  TAX ID   NUMBER *", token: "group.tin" },
    ]);
  });

  it("leaves unmapped fields with a null token", () => {
    const dict = [dictEntry("npi", "provider.npi")];
    const mappings = mapPdfFields(["NPI", "Mystery Field"], dict);
    expect(mappings).toEqual([
      { field: "NPI", token: "provider.npi" },
      { field: "Mystery Field", token: null },
    ]);
  });

  it("ignores suggested and rejected dictionary entries (confirmed only)", () => {
    const dict = [
      dictEntry("first name", "provider.firstName", "suggested"),
      dictEntry("last name", "provider.lastName", "rejected"),
    ];
    expect(mapPdfFields(["First Name", "Last Name"], dict)).toEqual([
      { field: "First Name", token: null },
      { field: "Last Name", token: null },
    ]);
  });
});

describe("resolvePdfValues", () => {
  it("produces fill pairs for mapped fields that have a value", () => {
    const mappings = [
      { field: "First Name", token: "provider.firstName" },
      { field: "NPI", token: "provider.npi" },
    ];
    const { fill, unfilled } = resolvePdfValues(mappings, {
      "provider.firstName": "Jordan",
      "provider.npi": "1003456701",
    });
    expect(fill).toEqual([
      { field: "First Name", value: "Jordan" },
      { field: "NPI", value: "1003456701" },
    ]);
    expect(unfilled).toEqual([]);
  });

  it("reports unmapped fields as unfilled", () => {
    const mappings = [{ field: "Mystery Field", token: null }];
    const { fill, unfilled } = resolvePdfValues(mappings, {});
    expect(fill).toEqual([]);
    expect(unfilled).toEqual([{ field: "Mystery Field", token: null, reason: "unmapped" }]);
  });

  it("reports mapped fields with a missing or empty value, never a blank fill", () => {
    const mappings = [
      { field: "DEA", token: "provider.deaNumber" }, // absent in the value map
      { field: "Suffix", token: "provider.suffix" }, // present but empty string
      { field: "First Name", token: "provider.firstName" },
    ];
    const { fill, unfilled } = resolvePdfValues(mappings, {
      "provider.suffix": "",
      "provider.firstName": "Jordan",
    });
    expect(fill).toEqual([{ field: "First Name", value: "Jordan" }]);
    expect(unfilled).toEqual([
      { field: "DEA", token: "provider.deaNumber", reason: "no_value" },
      { field: "Suffix", token: "provider.suffix", reason: "no_value" },
    ]);
  });
});

describe("buildProviderTokenValues", () => {
  const provider = {
    firstName: "Jordan",
    lastName: "Rivera",
    npi: "1003456701",
    ssnLast4: "1234",
    suffix: null,
    email: "  ",
  } as unknown as Provider;

  const group = { name: "BEST PT", tin: "12-3456789", npiType2: "9876543210" } as ProviderGroup;

  const facility = {
    name: "Riverbend Clinic",
    street: "1 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
  } as Facility;

  const license = {
    state: "TX",
    licenseNumber: "TX-PT-99",
    expirationDate: "2027-12-31",
  } as unknown as StateLicense;

  const groupInsurance = {
    id: "gp-1",
    orgId: "org-1",
    groupId: "g-1",
    insuranceType: "professional_liability",
    coverageLevel: "primary",
    insurerName: "Acme Malpractice",
    policyNumber: "POL-42",
    policyStartDate: "2025-01-01",
    policyEndDate: "2026-12-31",
    notes: null,
  } as InsurancePolicy;

  it("emits bare catalog tokens for non-empty provider/group/facility values", () => {
    const map = buildProviderTokenValues(provider, group, facility);
    expect(map["provider.firstName"]).toBe("Jordan");
    expect(map["provider.npi"]).toBe("1003456701");
    expect(map["provider.ssnLast4"]).toBe("1234");
    expect(map["group.tin"]).toBe("12-3456789");
    expect(map["facility.name"]).toBe("Riverbend Clinic");
    expect(map["facility.address"]).toBe("1 Main St, Austin, TX, 78701");
  });

  it("omits null and whitespace-only values so they resolve to no_value, not a blank fill", () => {
    const map = buildProviderTokenValues(provider, group, facility);
    expect("provider.suffix" in map).toBe(false);
    expect("provider.email" in map).toBe(false);
  });

  it("tolerates null provider/group/facility", () => {
    expect(buildProviderTokenValues(null, null, null)).toEqual({});
  });

  // DYN-TOKEN-05 — license and groupInsurance are caller-chosen child rows.
  it("emits license.* and groupInsurance.* when those rows are passed", () => {
    const map = buildProviderTokenValues(provider, group, facility, license, groupInsurance);
    expect(map["license.licenseNumber"]).toBe("TX-PT-99");
    expect(map["license.state"]).toBe("TX");
    expect(map["groupInsurance.policyNumber"]).toBe("POL-42");
    expect(map["groupInsurance.insurerName"]).toBe("Acme Malpractice");
  });

  it("omits license.* and groupInsurance.* when those rows are null", () => {
    const map = buildProviderTokenValues(provider, group, facility, null, null);
    expect("license.licenseNumber" in map).toBe(false);
    expect("groupInsurance.policyNumber" in map).toBe(false);
  });
});

describe("pdfFillFileStem", () => {
  it("slugifies a step label and falls back to 'form'", () => {
    expect(pdfFillFileStem("Complete CAQH Re-attestation")).toBe("complete-caqh-re-attestation");
    expect(pdfFillFileStem("  ")).toBe("form");
    expect(pdfFillFileStem(null)).toBe("form");
  });
});

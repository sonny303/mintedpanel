import { describe, expect, it } from "vitest";
import { deriveProviderGaps, sortRosterAz, type ProviderGapInputs } from "@/lib/providerGaps";
import type { Provider } from "@/types";

const base = (over: Partial<Provider> = {}) =>
  ({
    id: "pr-1",
    status: "active",
    referenceOnly: false,
    npi: "1093817465",
    caqhId: "16224897",
    caqhLastAttestedDate: "2026-07-01",
    ...over,
  }) as ProviderGapInputs["provider"];

const inputs = (over: Partial<ProviderGapInputs> = {}): ProviderGapInputs => ({
  provider: base(),
  hasFacilityAssignment: true,
  soonestLicenseExpiry: "2027-06-01",
  today: "2026-07-19",
  ...over,
});

describe("deriveProviderGaps", () => {
  it("a clean provider has zero gaps", () => {
    expect(deriveProviderGaps(inputs())).toEqual([]);
  });

  it("no facility assignment is the first, can't-generate gap", () => {
    const gaps = deriveProviderGaps(inputs({ hasFacilityAssignment: false }));
    expect(gaps[0]).toMatchObject({ key: "no_facility", section: "groups-facilities" });
  });

  it("missing NPI and missing CAQH id derive from field presence", () => {
    const gaps = deriveProviderGaps(
      inputs({ provider: base({ npi: null, caqhId: null }) as never }),
    );
    expect(gaps.map((g) => g.key)).toEqual(["missing_npi", "missing_caqh"]);
  });

  it("stale CAQH uses the readiness window (121 days stale, 120 current)", () => {
    const stale = deriveProviderGaps(
      inputs({ provider: base({ caqhLastAttestedDate: "2026-03-20" }), today: "2026-07-19" }),
    );
    expect(stale.map((g) => g.key)).toContain("stale_caqh");
    const current = deriveProviderGaps(
      inputs({ provider: base({ caqhLastAttestedDate: "2026-03-21" }), today: "2026-07-19" }),
    );
    expect(current.map((g) => g.key)).not.toContain("stale_caqh");
  });

  it("a CAQH id with NO attestation date is stale, not missing", () => {
    const gaps = deriveProviderGaps(
      inputs({ provider: base({ caqhLastAttestedDate: null }) as never }),
    );
    expect(gaps.map((g) => g.key)).toEqual(["stale_caqh"]);
  });

  it("license expiry: past → expired; within 90 days → expiring; beyond → clean; dateless → silent", () => {
    expect(
      deriveProviderGaps(inputs({ soonestLicenseExpiry: "2026-07-18" })).map((g) => g.key),
    ).toContain("license_expired");
    expect(
      deriveProviderGaps(inputs({ soonestLicenseExpiry: "2026-10-17" })).map((g) => g.key),
    ).toContain("license_expiring");
    expect(
      deriveProviderGaps(inputs({ soonestLicenseExpiry: "2026-10-18" })).map((g) => g.key),
    ).toEqual([]);
    expect(deriveProviderGaps(inputs({ soonestLicenseExpiry: null }))).toEqual([]);
  });

  it("reference-only and terminated providers never gap", () => {
    expect(
      deriveProviderGaps(
        inputs({
          provider: base({ referenceOnly: true, npi: null } as never),
          hasFacilityAssignment: false,
        }),
      ),
    ).toEqual([]);
    expect(
      deriveProviderGaps(
        inputs({ provider: base({ status: "terminated" }), hasFacilityAssignment: false }),
      ),
    ).toEqual([]);
  });
});

describe("sortRosterAz", () => {
  it("sorts by last name, then first, then id — case-insensitive", () => {
    const rows = [
      { id: "3", firstName: "casey", lastName: "rivera" },
      { id: "2", firstName: "Brooke", lastName: "Ostrander" },
      { id: "1", firstName: "Alex", lastName: "chen" },
      { id: "4", firstName: "Aaron", lastName: "Ostrander" },
    ];
    expect(sortRosterAz(rows).map((r) => r.id)).toEqual(["1", "4", "2", "3"]);
  });
});

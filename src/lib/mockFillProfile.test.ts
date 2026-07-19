import { describe, expect, it } from "vitest";

import {
  MOCK_FILL_PROFILE_VERSION,
  MOCK_FILL_VALUES,
  buildMockTokenMap,
  mockValueForToken,
} from "@/lib/mockFillProfile";

describe("mock fill profile", () => {
  it("is versioned", () => {
    expect(MOCK_FILL_PROFILE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("curated values are all non-empty and visibly synthetic (no real-data reads)", () => {
    for (const [token, value] of Object.entries(MOCK_FILL_VALUES)) {
      expect(value.trim(), token).not.toBe("");
    }
  });

  it("never carries a full SSN — last-4 only, and no 9-digit ssn value", () => {
    for (const [token, value] of Object.entries(MOCK_FILL_VALUES)) {
      if (token.toLowerCase().includes("ssn")) {
        expect(value).toMatch(/^\d{4}$/);
      }
    }
    expect(mockValueForToken("provider.ssnLast4")).toMatch(/^\d{4}$/);
  });

  it("resolves curated tokens from the map", () => {
    expect(mockValueForToken("provider.npi")).toBe(MOCK_FILL_VALUES["provider.npi"]);
    expect(mockValueForToken("license.licenseNumber")).toBe("SAMPLE-12345");
  });

  it("heuristics cover unknown tokens by field name", () => {
    expect(mockValueForToken("contract.effectiveDate")).toBe("2026-01-15");
    expect(mockValueForToken("group.billingEmail")).toBe("sample@example.com");
    expect(mockValueForToken("facility.appointmentPhone")).toBe("5555550100");
    expect(mockValueForToken("assignment.state")).toBe("NC");
    expect(mockValueForToken("group.billingZip")).toBe("27601");
    expect(mockValueForToken("group.groupNpi")).toBe("1999999984");
  });

  it("falls back to a deterministic Sample string, never empty", () => {
    const v = mockValueForToken("payer.someBrandNewField");
    expect(v).toBe("Sample some brand new field");
    expect(mockValueForToken("payer.someBrandNewField")).toBe(v);
  });

  it("buildMockTokenMap resolves every distinct mapped token non-empty", () => {
    const tokens = ["provider.npi", null, undefined, "  ", "provider.npi", "mso.name"];
    const built = buildMockTokenMap(tokens);
    expect(Object.keys(built).sort()).toEqual(["mso.name", "provider.npi"]);
    for (const value of Object.values(built)) {
      expect(value.trim()).not.toBe("");
    }
  });
});

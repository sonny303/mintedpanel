import { describe, expect, it } from "vitest";
import type { Portal } from "@/types";
import { portalMappingResetAvailability, portalMappingResetImpactText } from "./portalMappingReset";

function portal(overrides: Partial<Portal> = {}): Portal {
  return {
    id: "portal-org",
    orgId: "org-a",
    portalKey: "blue-plan-config-a",
    name: "Blue Plan enrollment",
    payerId: "payer-a",
    formUrl: "https://payer.example.test/form",
    isVerified: true,
    lastVerifiedAt: "2026-01-01T00:00:00Z",
    provenAt: "2026-01-01T00:00:00Z",
    caseType: "enrollment",
    mappingGeneration: 3,
    urlChangedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("portalMappingResetAvailability", () => {
  it("permits an org-only reset when no exact-key shared fallback exists", () => {
    expect(
      portalMappingResetAvailability({
        portal: portal(),
        visiblePortals: [portal()],
        activeOrgId: "org-a",
      }),
    ).toEqual({ allowed: true, ownerScope: "organization" });
  });

  it("blocks org-only reset when an exact-key shared fallback exists", () => {
    const selected = portal();
    const sharedFallback = portal({ id: "portal-global", orgId: null });
    expect(
      portalMappingResetAvailability({
        portal: selected,
        visiblePortals: [selected, sharedFallback],
        activeOrgId: "org-a",
      }),
    ).toEqual({ allowed: false, reason: "shared-fallback" });
  });

  it("does not confuse a same-URL sibling with an exact-key fallback", () => {
    const selected = portal();
    const sameUrlSibling = portal({ id: "portal-other", portalKey: "blue-plan-config-b" });
    expect(
      portalMappingResetAvailability({
        portal: selected,
        visiblePortals: [selected, sameUrlSibling],
        activeOrgId: "org-a",
      }),
    ).toEqual({ allowed: true, ownerScope: "organization" });
  });

  it("permits global reset and rejects an org row outside the active org", () => {
    expect(
      portalMappingResetAvailability({
        portal: portal({ id: "portal-global", orgId: null }),
        visiblePortals: [],
        activeOrgId: "org-a",
      }),
    ).toEqual({ allowed: true, ownerScope: "global" });
    expect(
      portalMappingResetAvailability({
        portal: portal({ orgId: "org-b" }),
        visiblePortals: [],
        activeOrgId: "org-a",
      }),
    ).toEqual({ allowed: false, reason: "wrong-organization" });
  });

  it("describes shared impact while preserving org overrides and same-URL siblings", () => {
    const impact = portalMappingResetImpactText(portal({ orgId: null }));
    expect(impact).toContain("exact key");
    expect(impact).toContain("organization overrides remain stored");
    expect(impact).toContain("same-URL siblings");
    expect(impact).not.toContain("payer.example.test");
  });

  it("describes org reset as exact-scope and sibling-safe", () => {
    const impact = portalMappingResetImpactText(portal());
    expect(impact).toContain("Only this organization configuration");
    expect(impact).toContain("Shared configurations");
    expect(impact).toContain("same-URL sibling keys are untouched");
  });
});

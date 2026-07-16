import { describe, it, expect } from "vitest";
import { isUnlinkedFieldMap } from "./portalMappingHealth";
import type { PortalFieldMap } from "@/types";

function map(p: Partial<PortalFieldMap>): PortalFieldMap {
  return {
    id: p.id ?? "m1",
    orgId: p.orgId ?? "org-1",
    portalKey: "bcbs_ks",
    urlPattern: null,
    pageStep: null,
    mapType: "web",
    selector: "label:City",
    selectorFallbacks: null,
    source: p.source ?? "token",
    token: p.token ?? null,
    hardcodedValue: p.hardcodedValue ?? null,
    transform: null,
    fieldType: "text",
    notes: null,
    status: p.status ?? "approved",
    fieldLabel: null,
    formSection: null,
    confidence: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...p,
  };
}

describe("isUnlinkedFieldMap", () => {
  it("is true for an approved token row with no token (approved but unlinked)", () => {
    expect(isUnlinkedFieldMap(map({ status: "approved", source: "token", token: null }))).toBe(
      true,
    );
  });

  it("is true for a proposed row with no token (extension fills proposed, so it blanks)", () => {
    expect(isUnlinkedFieldMap(map({ status: "proposed", source: "token", token: null }))).toBe(
      true,
    );
  });

  it("is false when a token is linked", () => {
    expect(isUnlinkedFieldMap(map({ source: "token", token: "provider.npi" }))).toBe(false);
  });

  it("is false for a hardcoded value", () => {
    expect(
      isUnlinkedFieldMap(map({ source: "hardcoded", token: null, hardcodedValue: "KS" })),
    ).toBe(false);
  });

  it("is true for a hardcoded source with no value (nothing to fill)", () => {
    expect(
      isUnlinkedFieldMap(map({ source: "hardcoded", token: null, hardcodedValue: null })),
    ).toBe(true);
  });

  it("is false for manual and manual_partial (deliberate fill-by-hand, not a gap)", () => {
    // token null on BOTH so the source guard is the only thing keeping them
    // false — otherwise the token==null clause would mask the guard.
    expect(isUnlinkedFieldMap(map({ source: "manual", token: null }))).toBe(false);
    expect(isUnlinkedFieldMap(map({ source: "manual_partial", token: null }))).toBe(false);
  });

  it("is false for a retired row (never filled)", () => {
    expect(isUnlinkedFieldMap(map({ status: "retired", source: "token", token: null }))).toBe(
      false,
    );
  });
});

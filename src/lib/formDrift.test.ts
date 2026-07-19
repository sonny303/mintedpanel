import { describe, expect, it } from "vitest";

import {
  FIELD_NOT_FOUND_REASON,
  brokenMapsForFill,
  buildDriftByPortal,
  latestRealFillPerPortal,
  parseSkippedEntries,
  reportLabelOf,
  totalDriftCount,
} from "@/lib/formDrift";
import type { PortalFieldMap } from "@/types";

function map(overrides: Partial<PortalFieldMap> & { id: string }): PortalFieldMap {
  return {
    orgId: "org-1",
    portalKey: "bcbs_ks_enrollment",
    urlPattern: null,
    pageStep: null,
    mapType: "web",
    selector: "#field",
    selectorFallbacks: null,
    source: "token",
    token: "provider.npi",
    hardcodedValue: null,
    transform: null,
    fieldType: "text",
    notes: null,
    status: "approved",
    fieldLabel: null,
    formSection: null,
    confidence: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const notFound = (label: string, mapId?: string) => ({
  label,
  reason: FIELD_NOT_FOUND_REASON,
  kind: "skipped",
  ...(mapId ? { mapId } : {}),
});

describe("parseSkippedEntries", () => {
  it("returns [] for non-array jsonb", () => {
    expect(parseSkippedEntries(null)).toEqual([]);
    expect(parseSkippedEntries("oops")).toEqual([]);
    expect(parseSkippedEntries({ label: "x", reason: "y" })).toEqual([]);
  });

  it("drops malformed records and defaults kind / nulls bad mapId", () => {
    const parsed = parseSkippedEntries([
      { label: "NPI", reason: FIELD_NOT_FOUND_REASON },
      { label: 42, reason: "nope" },
      { label: "CAQH", reason: "manual", kind: "manual", mapId: 9 },
      null,
    ]);
    expect(parsed).toEqual([
      { label: "NPI", reason: FIELD_NOT_FOUND_REASON, kind: "skipped", mapId: null },
      { label: "CAQH", reason: "manual", kind: "manual", mapId: null },
    ]);
  });
});

describe("reportLabelOf", () => {
  it("strips the label: prefix, else echoes the selector", () => {
    expect(reportLabelOf({ selector: "label:NPI Number" })).toBe("NPI Number");
    expect(reportLabelOf({ selector: "#npi" })).toBe("#npi");
  });
});

describe("latestRealFillPerPortal", () => {
  it("keeps the first (newest) fill per portal and skips dry runs", () => {
    const skip = (label: string) => [{ selector: "#f", label, reason: "unmapped" as const }];
    const fills = [
      { portalKey: "a", fieldsSkipped: skip("test-run"), isTest: true },
      { portalKey: "a", fieldsSkipped: skip("newest-real"), isTest: false },
      { portalKey: "a", fieldsSkipped: skip("older-real"), isTest: false },
      { portalKey: "b", fieldsSkipped: null, isTest: false },
    ];
    expect(latestRealFillPerPortal(fills)).toEqual([
      { portalKey: "a", fieldsSkipped: skip("newest-real") },
      { portalKey: "b", fieldsSkipped: null },
    ]);
  });
});

describe("brokenMapsForFill", () => {
  const m1 = map({ id: "m1", selector: "label:NPI" });
  const m2 = map({ id: "m2", selector: "#caqh", fieldLabel: "CAQH ID" });

  it("joins by reported mapId first", () => {
    const broken = brokenMapsForFill(
      { portalKey: "bcbs_ks_enrollment", fieldsSkipped: [notFound("anything", "m2")] },
      [m1, m2],
    );
    expect(broken.map((m) => m.id)).toEqual(["m2"]);
  });

  it("falls back to the report-label join only without a mapId", () => {
    const broken = brokenMapsForFill(
      { portalKey: "bcbs_ks_enrollment", fieldsSkipped: [notFound("NPI")] },
      [m1, m2],
    );
    expect(broken.map((m) => m.id)).toEqual(["m1"]);
  });

  it("a reported-but-stale mapId raises nothing (no label fallback)", () => {
    const broken = brokenMapsForFill(
      { portalKey: "bcbs_ks_enrollment", fieldsSkipped: [notFound("NPI", "gone")] },
      [m1, m2],
    );
    expect(broken).toEqual([]);
  });

  it("duplicate reports collapse; retired maps never join", () => {
    const retired = map({ id: "m3", selector: "label:Fax", status: "retired" });
    const broken = brokenMapsForFill(
      {
        portalKey: "bcbs_ks_enrollment",
        fieldsSkipped: [notFound("x", "m1"), notFound("y", "m1"), notFound("Fax", "m3")],
      },
      [m1, m2, retired],
    );
    expect(broken.map((m) => m.id)).toEqual(["m1"]);
  });

  it("the dry-run skip shape never matches (no kind:skipped + wrong reason)", () => {
    const broken = brokenMapsForFill(
      {
        portalKey: "bcbs_ks_enrollment",
        fieldsSkipped: [
          { selector: "#caqh", label: "CAQH ID", reason: "unmapped" },
          { selector: "#npi", label: "NPI", reason: "empty_token" },
        ],
      },
      [m1, m2],
    );
    expect(broken).toEqual([]);
  });

  it("only maps on the fill's portal join", () => {
    const other = map({ id: "m4", portalKey: "other_portal", selector: "label:NPI" });
    const broken = brokenMapsForFill(
      { portalKey: "other_portal", fieldsSkipped: [notFound("NPI")] },
      [m1, other],
    );
    expect(broken.map((m) => m.id)).toEqual(["m4"]);
  });
});

describe("buildDriftByPortal / totalDriftCount", () => {
  it("keys drifted portals only and sums the badge count", () => {
    const m1 = map({ id: "m1", selector: "label:NPI" });
    const m2 = map({ id: "m2", portalKey: "portal_b", selector: "label:TIN" });
    const drift = buildDriftByPortal(
      [
        { portalKey: "bcbs_ks_enrollment", fieldsSkipped: [notFound("NPI", "m1")] },
        { portalKey: "portal_b", fieldsSkipped: [notFound("TIN", "m2")] },
        { portalKey: "clean_portal", fieldsSkipped: [] },
      ],
      [m1, m2],
    );
    expect([...drift.keys()].sort()).toEqual(["bcbs_ks_enrollment", "portal_b"]);
    expect(totalDriftCount(drift)).toBe(2);
  });
});

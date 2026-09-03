import { describe, expect, it } from "vitest";

import {
  FIELD_NOT_FOUND_REASON,
  OTHER_PAGE_KIND,
  OTHER_PAGE_REASON,
  brokenMapsForFill,
  buildDriftByPortal,
  isOnPageNotFound,
  isOtherPageSkip,
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

const otherPage = (label: string, mapId?: string) => ({
  label,
  reason: OTHER_PAGE_REASON,
  kind: OTHER_PAGE_KIND,
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
      { label: "DOB", reason: OTHER_PAGE_REASON, kind: OTHER_PAGE_KIND, mapId: "m-dob" },
      null,
    ]);
    expect(parsed).toEqual([
      { label: "NPI", reason: FIELD_NOT_FOUND_REASON, kind: "skipped", mapId: null },
      { label: "CAQH", reason: "manual", kind: "manual", mapId: null },
      {
        label: "DOB",
        reason: OTHER_PAGE_REASON,
        kind: OTHER_PAGE_KIND,
        mapId: "m-dob",
      },
    ]);
  });
});

describe("isOnPageNotFound / isOtherPageSkip", () => {
  it("requires both kind and reason for on-page drift", () => {
    expect(isOnPageNotFound({ kind: "skipped", reason: FIELD_NOT_FOUND_REASON })).toBe(true);
    expect(isOnPageNotFound({ kind: OTHER_PAGE_KIND, reason: FIELD_NOT_FOUND_REASON })).toBe(
      false,
    );
    expect(isOnPageNotFound({ kind: "skipped", reason: OTHER_PAGE_REASON })).toBe(false);
  });

  it("treats either other-page half as an off-page skip", () => {
    expect(isOtherPageSkip({ kind: OTHER_PAGE_KIND, reason: OTHER_PAGE_REASON })).toBe(true);
    expect(isOtherPageSkip({ kind: "skipped", reason: OTHER_PAGE_REASON })).toBe(true);
    expect(isOtherPageSkip({ kind: OTHER_PAGE_KIND, reason: FIELD_NOT_FOUND_REASON })).toBe(true);
    expect(isOtherPageSkip({ kind: "skipped", reason: FIELD_NOT_FOUND_REASON })).toBe(false);
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
      { portalKey: "a", fieldsSkipped: skip("test-run"), isTest: true, startedAt: "2026-07-19" },
      {
        portalKey: "a",
        fieldsSkipped: skip("newest-real"),
        isTest: false,
        startedAt: "2026-07-18",
      },
      { portalKey: "a", fieldsSkipped: skip("older-real"), isTest: false, startedAt: "2026-07-17" },
      { portalKey: "b", fieldsSkipped: null, isTest: false, startedAt: "2026-07-16" },
    ];
    expect(latestRealFillPerPortal(fills)).toEqual([
      { portalKey: "a", fieldsSkipped: skip("newest-real"), startedAt: "2026-07-18" },
      { portalKey: "b", fieldsSkipped: null, startedAt: "2026-07-16" },
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

  it("a mapping edited AFTER the reporting fill is repaired-pending-verification (drops out)", () => {
    const repaired = map({ id: "m1", selector: "label:NPI", updatedAt: "2026-07-19T12:00:00Z" });
    const broken = brokenMapsForFill(
      {
        portalKey: "bcbs_ks_enrollment",
        fieldsSkipped: [notFound("NPI", "m1")],
        startedAt: "2026-07-19T09:00:00Z",
      },
      [repaired],
    );
    expect(broken).toEqual([]);
    // Untouched since the fill → still drifted.
    const stillBroken = brokenMapsForFill(
      {
        portalKey: "bcbs_ks_enrollment",
        fieldsSkipped: [notFound("NPI", "m1")],
        startedAt: "2026-07-19T09:00:00Z",
      },
      [map({ id: "m1", selector: "label:NPI", updatedAt: "2026-07-01T00:00:00Z" })],
    );
    expect(stillBroken.map((m) => m.id)).toEqual(["m1"]);
  });

  it("only maps on the fill's portal join", () => {
    const other = map({ id: "m4", portalKey: "other_portal", selector: "label:NPI" });
    const broken = brokenMapsForFill(
      { portalKey: "other_portal", fieldsSkipped: [notFound("NPI")] },
      [m1, other],
    );
    expect(broken.map((m) => m.id)).toEqual(["m4"]);
  });

  it("an other_page report is not drift, even mixed with a genuine miss", () => {
    const broken = brokenMapsForFill(
      {
        portalKey: "bcbs_ks_enrollment",
        fieldsSkipped: [otherPage("NPI", "m1"), notFound("CAQH ID", "m2")],
      },
      [m1, m2],
    );
    expect(broken.map((m) => m.id)).toEqual(["m2"]);
  });

  it("a partial other_page producer is not drift (kind or reason alone)", () => {
    const broken = brokenMapsForFill(
      {
        portalKey: "bcbs_ks_enrollment",
        fieldsSkipped: [
          { label: "NPI", reason: OTHER_PAGE_REASON, kind: "skipped", mapId: "m1" },
          {
            label: "CAQH ID",
            reason: FIELD_NOT_FOUND_REASON,
            kind: OTHER_PAGE_KIND,
            mapId: "m2",
          },
        ],
      },
      [m1, m2],
    );
    expect(broken).toEqual([]);
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

// --- S6.4: dating a break, and remembering which fields decay ---------------

import { buildDriftReport, fragileMapIds, lastWorkingAt, type FillHistoryEntry } from "./formDrift";

// fields_filled is an int4 COUNT (baseline migration: `fields_filled integer
// NOT NULL`), and fields_skipped is the only per-field record. The first cut of
// these tests passed arrays of selector strings as fieldsFilled, so every
// assertion below was checking a shape the database cannot produce — which is
// exactly how lastWorkingAt shipped returning null for every input. Fixtures
// here mirror the live column types.
const S64_MAP = {
  id: "m-npi",
  portalKey: "availity",
  selector: "#npi",
  fieldLabel: "NPI",
  createdAt: "2026-01-01T00:00:00Z",
} as unknown as PortalFieldMap;

// Reuses the notFound(label, mapId?) helper declared at the top of this file.
const S64_HISTORY: FillHistoryEntry[] = [
  // Newest: the field broke here.
  {
    portalKey: "availity",
    startedAt: "2026-07-20T00:00:00Z",
    fieldsFilled: 4,
    fieldsSkipped: [notFound("#npi", "m-npi")],
  },
  // It last worked here — landed fields, no not-found report for this map.
  {
    portalKey: "availity",
    startedAt: "2026-07-10T00:00:00Z",
    fieldsFilled: 6,
    fieldsSkipped: [],
  },
  {
    portalKey: "availity",
    startedAt: "2026-06-01T00:00:00Z",
    fieldsFilled: 6,
    fieldsSkipped: [],
  },
];

describe("lastWorkingAt (S6.4)", () => {
  it("dates the break from the NEWEST fill that did not report it broken", () => {
    expect(lastWorkingAt(S64_MAP, S64_HISTORY)).toBe("2026-07-10T00:00:00Z");
  });

  it("returns null when every fill reported it broken — a bad mapping, not drift", () => {
    const never: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 3,
        fieldsSkipped: [notFound("#npi", "m-npi")],
      },
    ];
    expect(lastWorkingAt(S64_MAP, never)).toBeNull();
  });

  it("does not count a fill that landed nothing — silence there means nothing", () => {
    const emptyFill: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 0,
        fieldsSkipped: [],
      },
    ];
    expect(lastWorkingAt(S64_MAP, emptyFill)).toBeNull();
  });

  it("does not count a fill that predates the mapping — it wasn't there to work", () => {
    const beforeCreation: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2025-12-01T00:00:00Z",
        fieldsFilled: 6,
        fieldsSkipped: [],
      },
    ];
    expect(lastWorkingAt(S64_MAP, beforeCreation)).toBeNull();
  });

  it("joins a pre-mapId skip report by its label", () => {
    const legacy: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 3,
        fieldsSkipped: [{ kind: "skipped", reason: FIELD_NOT_FOUND_REASON, label: "#npi" }],
      },
    ];
    expect(lastWorkingAt(S64_MAP, legacy)).toBeNull();
  });

  it("ignores a skip for a DIFFERENT reason — only not-found is a break", () => {
    const otherReason: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 3,
        fieldsSkipped: [{ kind: "skipped", reason: "no value", mapId: "m-npi", label: "#npi" }],
      },
    ];
    expect(lastWorkingAt(S64_MAP, otherReason)).toBe("2026-07-20T00:00:00Z");
  });

  it("ignores dry runs — they never touched the live DOM", () => {
    const dryOnly: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-25T00:00:00Z",
        fieldsFilled: 6,
        fieldsSkipped: [],
        isTest: true,
      },
    ];
    expect(lastWorkingAt(S64_MAP, dryOnly)).toBeNull();
  });

  it("ignores fills on a different portal", () => {
    const other: FillHistoryEntry[] = [
      { portalKey: "cigna", startedAt: "2026-07-25T00:00:00Z", fieldsFilled: 6, fieldsSkipped: [] },
    ];
    expect(lastWorkingAt(S64_MAP, other)).toBeNull();
  });

  it("walks past an other_page report instead of treating it as last worked", () => {
    const history: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 4,
        fieldsSkipped: [otherPage("#npi", "m-npi")],
      },
      {
        portalKey: "availity",
        startedAt: "2026-07-10T00:00:00Z",
        fieldsFilled: 6,
        fieldsSkipped: [],
      },
    ];
    expect(lastWorkingAt(S64_MAP, history)).toBe("2026-07-10T00:00:00Z");
  });

  it("returns null when every real fill is other_page — no inferred success", () => {
    const onlyOffPage: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 4,
        fieldsSkipped: [otherPage("#npi", "m-npi")],
      },
    ];
    expect(lastWorkingAt(S64_MAP, onlyOffPage)).toBeNull();
  });

  it("walks past a partial other_page producer (kind overwritten to skipped)", () => {
    const history: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 4,
        fieldsSkipped: [
          { kind: "skipped", reason: OTHER_PAGE_REASON, mapId: "m-npi", label: "#npi" },
        ],
      },
      {
        portalKey: "availity",
        startedAt: "2026-07-01T00:00:00Z",
        fieldsFilled: 5,
        fieldsSkipped: [],
      },
    ];
    expect(lastWorkingAt(S64_MAP, history)).toBe("2026-07-01T00:00:00Z");
  });
});

describe("fragileMapIds / buildDriftReport (S6.4)", () => {
  const brokenFill = {
    portalKey: "availity",
    startedAt: "2026-07-21T00:00:00Z",
    fieldsSkipped: [
      { kind: "skipped", reason: FIELD_NOT_FOUND_REASON, mapId: "m-npi", label: "#npi" },
    ],
  };

  it("marks a mapping fragile once it has broken AND previously worked", () => {
    const fragile = fragileMapIds(S64_HISTORY, [brokenFill], [S64_MAP]);
    expect(fragile.has("m-npi")).toBe(true);
  });

  it("does NOT treat an other_page fill as prior success for fragility", () => {
    const history: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 3,
        fieldsSkipped: [notFound("#npi", "m-npi")],
      },
      {
        portalKey: "availity",
        startedAt: "2026-07-10T00:00:00Z",
        fieldsFilled: 4,
        fieldsSkipped: [otherPage("#npi", "m-npi")],
      },
    ];
    expect(fragileMapIds(history, [brokenFill], [S64_MAP]).has("m-npi")).toBe(false);
  });

  it("does NOT mark a mapping that never worked — that's a bad map, not decay", () => {
    const noHistory: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-20T00:00:00Z",
        fieldsFilled: 3,
        fieldsSkipped: [notFound("#npi", "m-npi")],
      },
    ];
    expect(fragileMapIds(noHistory, [brokenFill], [S64_MAP]).has("m-npi")).toBe(false);
  });

  it("reports portal, field, when it last worked, and the fragile flag", () => {
    const drift = new Map([["availity", [S64_MAP]]]);
    const rows = buildDriftReport(drift, S64_HISTORY, new Set(["m-npi"]));
    expect(rows).toEqual([
      {
        portalKey: "availity",
        mapId: "m-npi",
        field: "NPI",
        lastWorkingAt: "2026-07-10T00:00:00Z",
        knownFragile: true,
      },
    ]);
  });

  it("sorts the longest-broken field first — it's costing the most fills", () => {
    const older = {
      ...S64_MAP,
      id: "m-old",
      selector: "#old",
      fieldLabel: "Old",
    } as PortalFieldMap;
    // The newer fill carried #npi but reported #old not-found, so #old's last
    // success is the older fill — it has been broken longer.
    const history: FillHistoryEntry[] = [
      {
        portalKey: "availity",
        startedAt: "2026-07-10T00:00:00Z",
        fieldsFilled: 5,
        fieldsSkipped: [notFound("#old", "m-old")],
      },
      {
        portalKey: "availity",
        startedAt: "2026-01-01T00:00:00Z",
        fieldsFilled: 5,
        fieldsSkipped: [],
      },
    ];
    const rows = buildDriftReport(new Map([["availity", [S64_MAP, older]]]), history, new Set());
    expect(rows.map((r) => r.mapId)).toEqual(["m-old", "m-npi"]);
  });
});

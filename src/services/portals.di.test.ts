// 3M Slice 6 / D6.4 (F24) — the ghost filter at the SERVICE boundary, where
// both /api registry reads and the browser listPortals path apply it.
//
// The predicate itself is unit-tested in src/lib/portalVisibility.test.ts.
// What this suite pins is the wiring the extension + panel pickers depend on:
// the payer lifecycle columns are really requested (a filter reading columns
// the query never selected would silently drop everything), the shared route
// drops ghosts, the Work route drops GLOBAL ghosts while leaving own-org rows
// alone, and browser listPortals matches that Work rule so SOP/case portal
// selects cannot offer a ghost fill will never recognize.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const browserHolder = vi.hoisted(() => ({
  from: (_table: string): unknown => {
    throw new Error("no fake browser db installed");
  },
}));
const effectiveMapsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (table: string) => browserHolder.from(table) },
}));
vi.mock("@/services/portalFieldMaps", () => ({
  listEffectivePortalMapResolutions: effectiveMapsMock,
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  writeAudit: vi.fn(),
}));

beforeEach(() => {
  effectiveMapsMock.mockReset().mockResolvedValue([]);
});

import { listPortals, listPortalsForApi, listSharedPortals } from "./portals";

type Row = Record<string, unknown>;

interface Captured {
  selected: string;
  filters: Array<{ method: string; args: unknown[] }>;
}

/** A PostgREST-shaped chain that resolves to `rows` when awaited. */
function fakeDb(rows: Row[]): { db: SupabaseClient<Database>; captured: Captured } {
  const captured: Captured = { selected: "", filters: [] };
  const chain: Record<string, unknown> = {};
  for (const method of ["or", "is", "eq", "order"]) {
    chain[method] = (...args: unknown[]) => {
      captured.filters.push({ method, args });
      return chain;
    };
  }
  chain.select = (cols: string) => {
    captured.selected = cols;
    return chain;
  };
  chain.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  const db = { from: () => chain } as unknown as SupabaseClient<Database>;
  return { db, captured };
}

/** Install the same chain shape on the browser supabase mock used by listPortals. */
function installBrowserDb(rows: Row[]): Captured {
  const { db, captured } = fakeDb(rows);
  browserHolder.from = () => db.from("portals");
  return captured;
}

function portalRow(over: Row = {}): Row {
  return {
    id: "portal-1",
    org_id: null,
    portal_key: "live_form",
    name: "Live Form",
    payer_id: "payer-live",
    form_url: "https://example.test/form",
    is_verified: true,
    last_verified_at: "2026-08-30T00:00:00Z",
    proven_at: "2026-08-30T00:00:00Z",
    payers: { name: "Live Payer", status: "active", archived_at: null, merged_into_id: null },
    ...over,
  };
}

const GHOSTS: Row[] = [
  // Registered before its payer existed — nothing can ever join it.
  portalRow({ id: "ghost-nopayer", name: "Orphan Form", payer_id: null, payers: null }),
  portalRow({
    id: "ghost-retired",
    name: "Retired Payer Form",
    payer_id: "payer-retired",
    payers: { name: "Retired Payer", status: "retired", archived_at: null, merged_into_id: null },
  }),
  portalRow({
    id: "ghost-merged",
    name: "Merged Payer Form",
    payer_id: "payer-merged",
    payers: {
      name: "Merged Payer",
      status: "merged",
      archived_at: null,
      merged_into_id: "payer-live",
    },
  }),
  portalRow({
    id: "ghost-archived",
    name: "Archived Payer Form",
    payer_id: "payer-archived",
    payers: {
      name: "Archived Payer",
      status: "active",
      archived_at: "2026-08-01T00:00:00Z",
      merged_into_id: null,
    },
  }),
];

describe("listSharedPortals — GET /api/shared-portals (Train)", () => {
  it("requests the payer lifecycle alongside the display name", async () => {
    const { db, captured } = fakeDb([]);
    await listSharedPortals(db);
    expect(captured.selected).toContain("payers(name, status, archived_at, merged_into_id)");
    // Still global-only: the tier restriction is what makes the org-free
    // route safe, and D6.4 narrows it further rather than replacing it.
    expect(captured.filters).toContainEqual({ method: "is", args: ["org_id", null] });
  });

  it("returns only portals whose payer is live", async () => {
    const { db } = fakeDb([portalRow(), ...GHOSTS]);
    const rows = await listSharedPortals(db);
    expect(rows.map((r) => r.id)).toEqual(["portal-1"]);
    expect(rows[0].payerName).toBe("Live Payer");
  });

  it("returns an empty list rather than ghosts when nothing is workable", async () => {
    const { db } = fakeDb(GHOSTS);
    await expect(listSharedPortals(db)).resolves.toEqual([]);
  });

  it("normalizes and filters an explicit Train/Test target by exact portal key", async () => {
    const { db, captured } = fakeDb([
      portalRow({ id: "contract", portal_key: "aetna_contract", case_type: "contract" }),
    ]);

    const rows = await listSharedPortals(db, { portalKey: " AETNA_CONTRACT " });

    expect(captured.filters).toContainEqual({
      method: "eq",
      args: ["portal_key", "aetna_contract"],
    });
    expect(rows.map(({ portalKey }) => portalKey)).toEqual(["aetna_contract"]);
  });
});

describe("listPortalsForApi — GET /api/portals (Work recognition)", () => {
  it("keeps legacy typed rows visible while hiding separately keyed explicit configurations", async () => {
    const { db, captured } = fakeDb([
      portalRow({
        id: "historical-typed",
        portal_key: "historical_typed",
        case_type: "enrollment",
        requires_explicit_selection: false,
      }),
      portalRow({
        id: "new-explicit",
        portal_key: "new_explicit",
        case_type: "contract",
        requires_explicit_selection: true,
      }),
    ]);

    const rows = await listPortalsForApi({ db, orgId: "org-1" });

    expect(captured.selected).toContain("requires_explicit_selection");
    expect(
      rows.map(({ id, requiresExplicitSelection }) => [id, requiresExplicitSelection]),
    ).toEqual([["historical-typed", false]]);
  });

  it("blocks every same-key registry row when any global or org row needs explicit selection", async () => {
    const { db } = fakeDb([
      portalRow({
        id: "global-explicit",
        portal_key: "same_url_key",
        requires_explicit_selection: true,
      }),
      portalRow({
        id: "org-legacy",
        org_id: "org-1",
        portal_key: "same_url_key",
        requires_explicit_selection: false,
      }),
    ]);

    await expect(listPortalsForApi({ db, orgId: "org-1" })).resolves.toEqual([]);
  });

  it("drops GLOBAL ghosts so a page can't match a dead payer's portal", async () => {
    const { db } = fakeDb([portalRow(), ...GHOSTS]);
    const rows = await listPortalsForApi({ db, orgId: "org-1" });
    expect(rows.map((r) => r.id)).toEqual(["portal-1"]);
  });

  it("leaves own-org rows untouched — an org's private registry is its own", async () => {
    const ownOrgOddities: Row[] = [
      portalRow({ id: "own-nopayer", org_id: "org-1", payer_id: null, payers: null }),
      portalRow({
        id: "own-retired",
        org_id: "org-1",
        payer_id: "payer-retired",
        payers: {
          name: "Retired Payer",
          status: "retired",
          archived_at: null,
          merged_into_id: null,
        },
      }),
    ];
    const { db } = fakeDb([...ownOrgOddities, portalRow(), ...GHOSTS]);
    const rows = await listPortalsForApi({ db, orgId: "org-1" });
    expect(rows.map((r) => r.id)).toEqual(["own-nopayer", "own-retired", "portal-1"]);
  });

  it("still folds a hand-typed portal_key at the read boundary", async () => {
    const { db, captured } = fakeDb([]);
    await listPortalsForApi({ db, orgId: "org-1" }, { portalKey: "  BCBS_KS_Enrollment " });
    expect(captured.filters).toContainEqual({
      method: "eq",
      args: ["portal_key", "bcbs_ks_enrollment"],
    });
  });
});

describe("listPortals — browser usePortals (D-TD.4 / D6.4)", () => {
  it("requests the payer lifecycle embed so the filter cannot read stale facts", async () => {
    const captured = installBrowserDb([]);
    await listPortals();
    expect(captured.selected).toContain("payers(name, status, archived_at, merged_into_id)");
    expect(captured.filters).toContainEqual({
      method: "or",
      args: ["org_id.eq.org-1,org_id.is.null"],
    });
  });

  it("drops GLOBAL ghosts so SOP/case portal selects match Work fill", async () => {
    installBrowserDb([portalRow(), ...GHOSTS]);
    const rows = await listPortals();
    expect(rows.map((r) => r.id)).toEqual(["portal-1"]);
    expect(rows[0]).not.toHaveProperty("payerName");
  });

  it("leaves own-org rows untouched, matching listPortalsForApi", async () => {
    const ownOrgOddities: Row[] = [
      portalRow({ id: "own-nopayer", org_id: "org-1", payer_id: null, payers: null }),
      portalRow({
        id: "own-retired",
        org_id: "org-1",
        payer_id: "payer-retired",
        payers: {
          name: "Retired Payer",
          status: "retired",
          archived_at: null,
          merged_into_id: null,
        },
      }),
    ];
    installBrowserDb([...ownOrgOddities, portalRow(), ...GHOSTS]);
    const rows = await listPortals();
    expect(rows.map((r) => r.id)).toEqual(["own-nopayer", "own-retired", "portal-1"]);
  });

  it("does not present a proof stamp when the exact current generation has no approved maps", async () => {
    installBrowserDb([portalRow({ id: "portal-1", org_id: "org-1" })]);
    effectiveMapsMock
      .mockResolvedValueOnce([
        {
          portalId: "portal-1",
          activeFieldCount: 0,
          isVerified: false,
          isReady: false,
          status: "empty",
        },
      ])
      .mockResolvedValueOnce([]);

    const rows = await listPortals();

    expect(rows[0]).toMatchObject({
      id: "portal-1",
      isVerified: false,
      lastVerifiedAt: null,
      provenAt: null,
    });
    expect(effectiveMapsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ orgId: "org-1" }),
    );
    expect(effectiveMapsMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ orgId: null }));
  });
});

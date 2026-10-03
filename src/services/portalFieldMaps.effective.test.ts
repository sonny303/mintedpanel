import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { listPortalFieldMaps, resolveEffectivePortalMaps } from "./portalFieldMaps";

interface QueryCapture {
  table: string;
  or?: string;
  filters: Array<[string, unknown]>;
  isNull: string[];
}

function fakeDb(configs: Record<string, unknown>[], maps: Record<string, unknown>[]) {
  const captures: QueryCapture[] = [];
  const db = {
    from(table: string) {
      const capture: QueryCapture = { table, filters: [], isNull: [] };
      captures.push(capture);
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        or: (value: string) => {
          capture.or = value;
          return builder;
        },
        is: (column: string, value: unknown) => {
          if (value === null) capture.isNull.push(column);
          else capture.filters.push([`is.${column}`, value]);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          capture.filters.push([column, value]);
          return builder;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          let rows = table === "portals" ? configs : maps;
          rows = rows.filter((row) =>
            capture.filters.every(([column, value]) => row[column] === value),
          );
          if (capture.isNull.includes("org_id")) rows = rows.filter((row) => row.org_id === null);
          if (capture.or) {
            const orgId = capture.or.match(/org_id\.eq\.([0-9a-z-]+)/i)?.[1];
            rows = rows.filter((row) => row.org_id === null || row.org_id === orgId);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

const portal = (
  id: string,
  orgId: string | null,
  key: string,
  generation: number,
  over: Record<string, unknown> = {},
) => ({
  id,
  org_id: orgId,
  portal_key: key,
  name: `Display ${id}`,
  payer_id: null,
  form_url: "https://payer.example/forms",
  case_type: null,
  requires_explicit_selection: false,
  mapping_generation: generation,
  is_verified: true,
  proven_at: "2026-09-01T00:00:00Z",
  ...over,
});

const map = (
  id: string,
  orgId: string | null,
  key: string,
  selector: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  org_id: orgId,
  portal_key: key,
  url_pattern: "https://payer.example/forms/*",
  page_step: "application",
  map_type: "web",
  selector,
  selector_fallbacks: ["input[name=backup]"],
  source: "token",
  token: "provider.npi",
  hardcoded_value: null,
  transform: null,
  field_type: "text",
  field_label: "NPI",
  display_label: "NPI",
  section: "Provider",
  sort_order: 1,
  notes: null,
  status: "approved",
  control_options: null,
  mapping_generation: 1,
  shared_base_generation: null,
  learned_via: "manual",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...over,
});

function generationFixture() {
  const key = "payer-intake";
  const configs = [
    portal("global-intake", null, key, 4),
    portal("org-a-intake", "org-a", key, 3, {
      case_type: "enrollment",
      requires_explicit_selection: true,
    }),
    portal("org-b-intake", "org-b", key, 99),
    portal("org-a-sibling", "org-a", "payer-intake-copy", 1),
  ];
  const maps = [
    map("global-current", null, key, "#shared", { mapping_generation: 4 }),
    map("global-old", null, key, "#stale-shared", { mapping_generation: 3 }),
    map("org-a-override", "org-a", key, "#shared", {
      mapping_generation: 3,
      shared_base_generation: 4,
      token: "provider.firstName",
    }),
    map("org-a-current", "org-a", key, "#org-only", {
      mapping_generation: 3,
      shared_base_generation: 4,
    }),
    map("org-a-old-generation", "org-a", key, "#stale-org", {
      mapping_generation: 2,
      shared_base_generation: 4,
    }),
    map("org-a-old-base", "org-a", key, "#stale-base", {
      mapping_generation: 3,
      shared_base_generation: 3,
    }),
    map("org-b-foreign", "org-b", key, "#foreign", {
      mapping_generation: 99,
      shared_base_generation: 4,
    }),
    map("sibling-map", "org-a", "payer-intake-copy", "#sibling"),
    map("proposal", "org-a", key, "#proposal", {
      mapping_generation: 3,
      shared_base_generation: 4,
      status: "proposed",
    }),
    map("retired", "org-a", key, "#retired", {
      mapping_generation: 3,
      shared_base_generation: 4,
      status: "retired",
    }),
    map("pdf-map", "org-a", key, "#pdf", {
      map_type: "pdf",
      mapping_generation: 3,
      shared_base_generation: 4,
    }),
  ];
  return { key, configs, maps };
}

describe("exact effective portal maps", () => {
  it("resolves only exact-key current generations and shadows matching shared selectors", async () => {
    const fixture = generationFixture();
    const { db } = fakeDb(fixture.configs, fixture.maps);
    const result = await resolveEffectivePortalMaps(
      { db, orgId: "org-a" },
      { portalKey: fixture.key, mapType: "web" },
    );

    expect(result).toMatchObject({
      portalId: "org-a-intake",
      ownerScope: "organization",
      ownerOrgId: "org-a",
      caseType: "enrollment",
      requiresExplicitSelection: true,
      mappingGeneration: 3,
      sharedMappingGeneration: 4,
      activeFieldCount: 2,
      isReady: true,
      isVerified: true,
      status: "ready",
    });
    expect(result.maps.map((row) => row.selector)).toEqual([
      "#org-only",
      "#proposal",
      "#retired",
      "#shared",
    ]);
    expect(result.maps.find((row) => row.selector === "#shared")).toMatchObject({
      id: "org-a-override",
      token: "provider.firstName",
    });
    expect(result.maps.some((row) => row.selector.includes("stale"))).toBe(false);
    expect(result.maps.some((row) => row.id === "org-b-foreign")).toBe(false);
    expect(result.maps.some((row) => row.id === "sibling-map")).toBe(false);
    expect(result.maps.some((row) => row.mapType === "pdf")).toBe(false);
  });

  it("keeps global training global-only and blocks explicit configs from the legacy reader", async () => {
    const fixture = generationFixture();
    const { db, captures } = fakeDb(fixture.configs, fixture.maps);
    const global = await resolveEffectivePortalMaps(
      { db, orgId: null },
      { portalKey: fixture.key, mapType: "web" },
    );
    expect(global.ownerScope).toBe("global");
    expect(global.maps.map((row) => row.selector)).toEqual(["#shared"]);
    expect(
      captures.every((capture) => capture.or === undefined && capture.isNull.includes("org_id")),
    ).toBe(true);

    const orgDb = fakeDb(fixture.configs, fixture.maps).db;
    const visible = await listPortalFieldMaps(
      { db: orgDb, orgId: "org-a" },
      { portalKey: fixture.key },
    );
    expect(visible).toEqual([]);
  });

  it("pins shared generation only when an org configuration has a shared base", async () => {
    const orgOnly = portal("org-only", "org-a", "org-only-key", 7, {
      case_type: "enrollment",
      requires_explicit_selection: true,
    });
    const orgMap = map("org-only-map", "org-a", "org-only-key", "#field", {
      mapping_generation: 7,
      shared_base_generation: null,
    });
    const withoutShared = await resolveEffectivePortalMaps(
      { db: fakeDb([orgOnly], [orgMap]).db, orgId: "org-a" },
      { portalKey: "org-only-key", mapType: "web" },
    );
    expect(withoutShared.sharedMappingGeneration).toBeNull();
    expect(withoutShared.isReady).toBe(true);

    const fixture = generationFixture();
    const withShared = await resolveEffectivePortalMaps(
      { db: fakeDb(fixture.configs, fixture.maps).db, orgId: "org-a" },
      { portalKey: fixture.key, mapType: "web" },
    );
    expect(withShared.sharedMappingGeneration).toBe(4);
  });

  it("blocks legacy maps for the whole key when a global sibling is explicit but Panel can resolve the org config", async () => {
    const fixture = generationFixture();
    const configs = fixture.configs.map((row) =>
      row.portal_key === fixture.key && row.org_id === null
        ? { ...row, requires_explicit_selection: true }
        : row.portal_key === fixture.key && row.org_id === "org-a"
          ? { ...row, requires_explicit_selection: false }
          : row,
    );
    const { db } = fakeDb(configs, fixture.maps);
    const panelResolution = await resolveEffectivePortalMaps(
      { db, orgId: "org-a" },
      { portalKey: fixture.key, mapType: "web" },
    );
    expect(panelResolution).toMatchObject({
      requiresExplicitSelection: false,
      activeFieldCount: 2,
    });
    expect(panelResolution.maps).toHaveLength(4);

    const legacyRows = await listPortalFieldMaps(
      { db, orgId: "org-a" },
      { portalKey: fixture.key },
    );
    expect(legacyRows).toEqual([]);
  });

  it("preserves generation-1 PDF maps without pretending they are verified portals", async () => {
    const pdf = map("legacy-pdf-map", "org-a", "payer-form:family-1", "#field", {
      map_type: "pdf",
      mapping_generation: 1,
      shared_base_generation: null,
    });
    const sharedPdf = map("legacy-shared-pdf-map", null, "payer-form:family-1", "#shared-field", {
      map_type: "pdf",
      mapping_generation: 1,
      shared_base_generation: null,
    });
    const { db } = fakeDb([], [pdf, sharedPdf]);
    const resolution = await resolveEffectivePortalMaps(
      { db, orgId: "org-a" },
      { portalKey: "payer-form:family-1", mapType: "pdf" },
    );
    expect(resolution).toMatchObject({
      portalId: "legacy-pdf:payer-form:family-1",
      ownerScope: "organization",
      mappingGeneration: 1,
      activeFieldCount: 2,
      isReady: true,
      isVerified: false,
    });
    expect(resolution.maps.map((row) => row.id)).toEqual([
      "legacy-pdf-map",
      "legacy-shared-pdf-map",
    ]);
    const global = await resolveEffectivePortalMaps(
      { db, orgId: null },
      { portalKey: "payer-form:family-1", mapType: "pdf" },
    );
    expect(global.maps.map((row) => row.id)).toEqual(["legacy-shared-pdf-map"]);
  });

  it("fingerprints executable map changes and generations but ignores labels and timestamps", async () => {
    const fixture = generationFixture();
    const original = await resolveEffectivePortalMaps(
      { db: fakeDb(fixture.configs, fixture.maps).db, orgId: "org-a" },
      { portalKey: fixture.key, mapType: "web" },
    );
    const presentationOnly = fixture.maps.map((row) =>
      row.id === "org-a-override"
        ? {
            ...row,
            display_label: "renamed in editor",
            field_label: "Name on payer page",
            updated_at: "2026-10-01T00:00:00Z",
          }
        : row,
    );
    const renamed = await resolveEffectivePortalMaps(
      {
        db: fakeDb(
          fixture.configs.map((row) => ({ ...row, name: "New display name" })),
          presentationOnly,
        ).db,
        orgId: "org-a",
      },
      { portalKey: fixture.key, mapType: "web" },
    );
    expect(renamed.effectiveMappingFingerprint).toBe(original.effectiveMappingFingerprint);

    const executableChange = fixture.maps.map((row) =>
      row.id === "org-a-override" ? { ...row, token: "provider.lastName" } : row,
    );
    const changed = await resolveEffectivePortalMaps(
      { db: fakeDb(fixture.configs, executableChange).db, orgId: "org-a" },
      { portalKey: fixture.key, mapType: "web" },
    );
    expect(changed.effectiveMappingFingerprint).not.toBe(original.effectiveMappingFingerprint);

    const reset = await resolveEffectivePortalMaps(
      {
        db: fakeDb(
          fixture.configs.map((row) =>
            row.portal_key === fixture.key && row.org_id === "org-a"
              ? { ...row, mapping_generation: 4 }
              : row,
          ),
          fixture.maps,
        ).db,
        orgId: "org-a",
      },
      { portalKey: fixture.key, mapType: "web" },
    );
    expect(reset.mappingGeneration).toBe(4);
    expect(reset.maps.map((row) => row.selector)).toEqual(["#shared"]);
    expect(reset.effectiveMappingFingerprint).not.toBe(original.effectiveMappingFingerprint);
  });

  it("orders non-ASCII selectors by code unit so equivalent snapshots fingerprint identically", async () => {
    const key = "unicode-order";
    const config = portal("unicode-global", null, key, 1);
    const codeUnitFirst = map("map-z", null, key, "#z", { mapping_generation: 1 });
    const codeUnitLast = map("map-aumlaut", null, key, "#ä", { mapping_generation: 1 });
    const first = await resolveEffectivePortalMaps(
      { db: fakeDb([config], [codeUnitLast, codeUnitFirst]).db, orgId: null },
      { portalKey: key, mapType: "web" },
    );
    const reversed = await resolveEffectivePortalMaps(
      { db: fakeDb([config], [codeUnitFirst, codeUnitLast]).db, orgId: null },
      { portalKey: key, mapType: "web" },
    );

    expect(first.maps.map((row) => row.selector)).toEqual(["#z", "#ä"]);
    expect(reversed.maps.map((row) => row.selector)).toEqual(["#z", "#ä"]);
    expect(first.effectiveMappingFingerprint).toBe(reversed.effectiveMappingFingerprint);
  });

  it("does not let sibling or other-org rows perturb the selected fingerprint", async () => {
    const fixture = generationFixture();
    const original = await resolveEffectivePortalMaps(
      { db: fakeDb(fixture.configs, fixture.maps).db, orgId: "org-a" },
      { portalKey: fixture.key, mapType: "web" },
    );
    const unrelated = await resolveEffectivePortalMaps(
      {
        db: fakeDb(fixture.configs, [
          ...fixture.maps,
          map("other-sibling", "org-a", "payer-intake-copy", "#other-sibling"),
          map("other-org", "org-b", fixture.key, "#other-org", {
            mapping_generation: 99,
            shared_base_generation: 4,
          }),
        ]).db,
        orgId: "org-a",
      },
      { portalKey: fixture.key, mapType: "web" },
    );
    expect(unrelated.effectiveMappingFingerprint).toBe(original.effectiveMappingFingerprint);
  });

  it("marks empty, unverified and missing configurations distinctly", async () => {
    const config = portal("p-empty", null, "empty", 2);
    const noActiveMaps = map("proposal-empty", null, "empty", "#pending", {
      mapping_generation: 2,
      status: "proposed",
    });
    const empty = await resolveEffectivePortalMaps(
      { db: fakeDb([config], [noActiveMaps]).db, orgId: null },
      { portalKey: "empty", mapType: "web" },
    );
    expect(empty).toMatchObject({
      status: "empty",
      activeFieldCount: 0,
      isReady: false,
      isVerified: false,
    });

    const unverified = await resolveEffectivePortalMaps(
      {
        db: fakeDb(
          [portal("p-unverified", null, "unverified", 1, { is_verified: false })],
          [map("approved-unverified", null, "unverified", "#approved")],
        ).db,
        orgId: null,
      },
      { portalKey: "unverified", mapType: "web" },
    );
    expect(unverified).toMatchObject({ status: "ready", isReady: true, isVerified: false });

    const missing = await resolveEffectivePortalMaps(
      { db: fakeDb([], []).db, orgId: null },
      { portalKey: "not-registered", mapType: "web" },
    );
    expect(missing).toMatchObject({
      status: "configuration_missing",
      activeFieldCount: 0,
      isReady: false,
      isVerified: false,
    });
    expect(missing.effectiveMappingFingerprint).toBeNull();
  });
});

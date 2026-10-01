import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// The module now also exposes browser readers/mutations that import the anon
// client at load; stub it so this ctx-only suite needs no real env (matches
// providers.di.test.ts).
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import {
  listPortalFieldMaps,
  listStaleOrgOverridesForReview,
  proposeFieldMap,
  PROPOSED_BY_EXTENSION_NOTE,
  type PortalFieldMapServiceCtx,
} from "./portalFieldMaps";

// Minimal chainable fake of the supabase-js query builder — enough for the
// portal-field-map list shape. Records the table, columns, `.or()` expression,
// eq filters, and every `.order()` call so tests can assert what was sent.
interface Captured {
  table?: string;
  selectCols?: string;
  or?: string;
  filters: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean }]>;
  op?: "insert" | "update";
  payload?: Record<string, unknown>;
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const db = {
    from(table: string) {
      const cap: Captured = { table, filters: [], orders: [] };
      captures.push(cap);
      const builder: Record<string, unknown> = {
        select(cols: string) {
          cap.selectCols = cols;
          return builder;
        },
        or(expr: string) {
          cap.or = expr;
          return builder;
        },
        eq(col: string, val: unknown) {
          cap.filters.push([col, val]);
          return builder;
        },
        // S5.3's learned-suggestion read uses .not("token", "is", null).
        not(col: string, op: string, val: unknown) {
          cap.filters.push([`not.${col}.${op}`, val]);
          return builder;
        },
        order(col: string, opts: { ascending: boolean }) {
          cap.orders.push([col, opts]);
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          cap.op = "insert";
          cap.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          cap.op = "update";
          cap.payload = payload;
          return builder;
        },
        limit() {
          return builder;
        },
        single: () => Promise.resolve(take()),
        maybeSingle: () => Promise.resolve(take()),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(take()).then(res, rej),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

function ctxWith(db: SupabaseClient<Database>): PortalFieldMapServiceCtx {
  return { db, orgId: "org-1" };
}

const dbRow = {
  id: "m1",
  org_id: null,
  portal_key: "availity",
  url_pattern: "https://apps.availity.com/*",
  page_step: "provider-info",
  map_type: "web",
  selector: "#npi",
  selector_fallbacks: ["input[name=npi]"],
  source: "token",
  token: "provider.npi",
  hardcoded_value: null,
  transform: null,
  field_type: "text",
  notes: null,
  status: "approved",
  learned_via: "manual",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
};

const portalDbRow = {
  id: "p1",
  org_id: null,
  portal_key: "availity",
  name: "Availity",
  payer_id: null,
  form_url: "https://apps.availity.com/*",
  case_type: null,
  requires_explicit_selection: false,
  mapping_generation: 1,
  is_verified: true,
  proven_at: "2026-07-02T00:00:00Z",
};

function mapReadDb(mapData: unknown, mapError?: unknown) {
  return makeFakeDb([{ data: [portalDbRow] }, { data: mapData, error: mapError }]);
}

describe("portal field map service — injected server context", () => {
  it("scopes to global rows plus the caller's org via the .or() filter", async () => {
    const { db, captures } = mapReadDb([dbRow]);
    await listPortalFieldMaps(ctxWith(db));

    const cap = captures.find((capture) => capture.table === "portal_field_maps")!;
    expect(cap.table).toBe("portal_field_maps");
    expect(cap.or).toBe("org_id.is.null,org_id.eq.org-1");
    // Deterministic catalog order: portal_key, then created_at.
    expect(cap.orders).toEqual([
      ["portal_key", { ascending: true }],
      ["selector", { ascending: true }],
    ]);
  });

  it("applies the portalKey filter when given and omits it otherwise", async () => {
    const filtered = mapReadDb([]);
    await listPortalFieldMaps(ctxWith(filtered.db), { portalKey: "availity" });
    expect(filtered.captures[0]?.filters).toContainEqual(["portal_key", "availity"]);

    const unfiltered = mapReadDb([]);
    await listPortalFieldMaps(ctxWith(unfiltered.db), {});
    expect(unfiltered.captures[0]?.filters).toHaveLength(0);
  });

  it("selects the explicit column list, never *", async () => {
    const { db, captures } = mapReadDb([]);
    await listPortalFieldMaps(ctxWith(db));

    const cols = (
      captures.find((capture) => capture.table === "portal_field_maps")?.selectCols ?? ""
    )
      .split(",")
      .map((c) => c.trim());
    for (const col of [
      "id",
      "org_id",
      "portal_key",
      "url_pattern",
      "page_step",
      "map_type",
      "selector",
      "selector_fallbacks",
      "source",
      "token",
      "hardcoded_value",
      "transform",
      "field_type",
      "notes",
      "status",
      "control_options",
      "mapping_generation",
      "shared_base_generation",
      "learned_via",
      "created_at",
      "updated_at",
    ]) {
      expect(cols).toContain(col);
    }
    expect(cols).not.toContain("*");
  });

  it("camelizes rows at the boundary", async () => {
    const { db } = mapReadDb([dbRow]);
    const rows = await listPortalFieldMaps(ctxWith(db));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "m1",
      orgId: null,
      portalKey: "availity",
      urlPattern: "https://apps.availity.com/*",
      pageStep: "provider-info",
      mapType: "web",
      selector: "#npi",
      selectorFallbacks: ["input[name=npi]"],
      hardcodedValue: null,
      fieldType: "text",
      status: "approved",
      learnedVia: "manual",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-02T00:00:00Z",
    });
    expect(rows[0]).not.toHaveProperty("portal_key");
  });

  it("returns stale org overrides only in the review projection with the current shared map", async () => {
    const orgConfig = {
      ...portalDbRow,
      id: "org-config",
      org_id: "org-1",
      mapping_generation: 1,
    };
    const sharedConfig = {
      ...portalDbRow,
      id: "shared-config",
      mapping_generation: 2,
    };
    const staleOverride = {
      ...dbRow,
      id: "old-org-override",
      org_id: "org-1",
      mapping_generation: 1,
      shared_base_generation: 1,
      status: "approved",
    };
    const currentSharedMap = {
      ...dbRow,
      id: "current-shared-map",
      mapping_generation: 2,
      shared_base_generation: null,
      status: "approved",
    };
    const { db } = makeFakeDb([
      { data: [orgConfig, sharedConfig] },
      { data: [staleOverride, currentSharedMap] },
    ]);

    const result = await listStaleOrgOverridesForReview(ctxWith(db), "Availity");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      map: { id: "old-org-override", sharedBaseGeneration: 1 },
      currentSharedBaseGeneration: 2,
      currentSharedMap: { id: "current-shared-map", mappingGeneration: 2 },
    });
  });

  it("retries the legacy projection only when the additive provenance column is absent", async () => {
    const missingColumn = {
      code: "42703",
      message: "column portal_field_maps.learned_via does not exist",
    };
    const { db, captures } = makeFakeDb([
      { data: [portalDbRow] },
      { data: null, error: missingColumn },
      { data: [{ ...dbRow, learned_via: undefined }] },
    ]);

    const rows = await listPortalFieldMaps(ctxWith(db), { portalKey: "availity" });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.learnedVia).toBeUndefined();
    const mapCaptures = captures.filter((capture) => capture.table === "portal_field_maps");
    expect(mapCaptures).toHaveLength(2);
    expect(mapCaptures[0]?.selectCols).toContain("learned_via");
    expect(mapCaptures[1]?.selectCols).not.toContain("learned_via");
    expect(mapCaptures.map((capture) => capture.or)).toEqual([
      "org_id.is.null,org_id.eq.org-1",
      "org_id.is.null,org_id.eq.org-1",
    ]);
    expect(mapCaptures.map((capture) => capture.filters)).toEqual([
      [["portal_key", "availity"]],
      [["portal_key", "availity"]],
    ]);
  });

  it("does not retry the old projection for an unrelated database error", async () => {
    const { db, captures } = mapReadDb([], { code: "42501", message: "permission denied" });

    await expect(listPortalFieldMaps(ctxWith(db))).rejects.toMatchObject({ code: "42501" });
    expect(captures.filter((capture) => capture.table === "portal_field_maps")).toHaveLength(1);
  });

  it("returns [] when the query yields no rows", async () => {
    const { db } = makeFakeDb([]);
    await expect(listPortalFieldMaps(ctxWith(db))).resolves.toEqual([]);
  });

  // Live rows are seeded by humans pasting from SOP templates, so the DB holds
  // "{{provider.firstName}}" alongside bare "provider.firstName". The endpoint
  // contract is the bare catalog form — the extension joins these strings
  // literally against profile tokens (tonight's 0-fields-filled bug).
  it("normalizes braced DB tokens to the bare catalog form at the read boundary", async () => {
    const bracedRow = {
      ...dbRow,
      id: "m2",
      selector: "#first-name",
      token: "{{provider.firstName}}",
    };
    const spacedRow = { ...dbRow, id: "m3", selector: "#group-tin", token: " {{ group.tin }} " };
    const { db } = mapReadDb([dbRow, bracedRow, spacedRow]);

    const rows = await listPortalFieldMaps(ctxWith(db));

    expect(rows.map((r) => r.token)).toEqual(["provider.npi", "provider.firstName", "group.tin"]);
  });

  it("leaves manual rows' null token as null", async () => {
    const manualRow = { ...dbRow, id: "m4", source: "manual", token: null };
    const { db } = mapReadDb([manualRow]);

    const rows = await listPortalFieldMaps(ctxWith(db));

    expect(rows[0].token).toBeNull();
  });
});

describe("proposeFieldMap — propose-only write", () => {
  const audit = () => vi.fn().mockResolvedValue(undefined);
  const proposeCtx = (db: SupabaseClient<Database>, writeAudit = audit()) => ({
    ...ctxWith(db),
    writeAudit,
  });
  const input = { portal_key: "Availity", selector: " #npi ", field_label: "NPI Number:" };

  function inserted(captures: Captured[]) {
    return captures.find((c) => c.op === "insert")?.payload;
  }

  // The row the insert returns.
  const proposedRow = {
    ...dbRow,
    id: "m-new",
    org_id: "org-1",
    status: "proposed",
    source: "manual",
    token: null,
  };

  it("forces status/source/token regardless of what the body asks for", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db), {
      ...input,
      // A client trying to mint an approved token mapping.
      status: "approved",
      source: "token",
      token: "provider.ssnLast4",
    } as never);

    const payload = inserted(captures);
    // Approving is a human act in the trainer; a client that could write
    // 'approved' with a token could silently redirect what autofills.
    expect(payload?.status).toBe("proposed");
    expect(payload?.source).toBe("manual");
    expect(payload?.token).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("ssnLast4");
  });

  // Regression: the first cut of this write omitted `notes`, and every call
  // 23514'd on portal_field_maps_notes_required (source 'manual' ⇒ notes NOT
  // NULL) — verified against the live DB. The fake DB below speaks PostgREST,
  // not Postgres, so it cannot enforce a CHECK; this asserts the payload
  // instead. Keep `notes` non-empty here or the route is dead on arrival.
  it("stamps the note the schema requires for a source 'manual' row", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db), input);
    const payload = inserted(captures);
    expect(payload?.source).toBe("manual");
    expect(typeof payload?.notes).toBe("string");
    expect((payload?.notes as string).trim()).not.toBe("");
    // The note explains the row; it never carries scraped page content.
    expect(payload?.notes).toBe(PROPOSED_BY_EXTENSION_NOTE);
  });

  it("uses the generation-guarded capture RPC and surfaces a selector collision", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "portal_selector_collision: review the existing selector" },
    });
    const db = { rpc } as unknown as SupabaseClient<Database>;
    const result = await proposeFieldMap(proposeCtx(db), {
      ...input,
      expected_mapping_generation: 3,
    });

    expect(rpc).toHaveBeenCalledWith(
      "capture_org_portal_field_map",
      expect.objectContaining({
        p_org_id: "org-1",
        p_expected_mapping_generation: 3,
        p_capture: expect.objectContaining({ portal_key: "availity", selector: "#npi" }),
      }),
    );
    expect(result).toMatchObject({ kind: "rejected", status: 409 });
    if (result.kind !== "rejected") throw new Error("expected a rejected result");
    expect(result.message).toContain("portal_selector_collision");
  });

  it("returns a current shared selector unchanged instead of auditing an org proposal", async () => {
    const sharedRow = {
      ...dbRow,
      id: "shared-current-generation-map",
      org_id: null,
      mapping_generation: 2,
      status: "approved",
      token: "provider.npi",
    };
    const rpc = vi.fn().mockResolvedValue({
      data: { kind: "existing", map: sharedRow },
      error: null,
    });
    const db = { rpc } as unknown as SupabaseClient<Database>;
    const writeAudit = vi.fn().mockResolvedValue(undefined);
    const result = await proposeFieldMap(proposeCtx(db, writeAudit), {
      ...input,
      field_label: "",
      expected_mapping_generation: 2,
    });

    expect(rpc).toHaveBeenCalledWith(
      "capture_org_portal_field_map",
      expect.objectContaining({ p_expected_mapping_generation: 2 }),
    );
    expect(result).toMatchObject({
      kind: "existing",
      map: { id: "shared-current-generation-map", orgId: null, status: "approved" },
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a stale capture generation with a reload message", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "mapping_generation_stale" },
    });
    const result = await proposeFieldMap(
      proposeCtx({ rpc } as unknown as SupabaseClient<Database>),
      { ...input, expected_mapping_generation: 1 },
    );

    expect(result).toMatchObject({ kind: "rejected", status: 409 });
    if (result.kind !== "rejected") throw new Error("expected a rejected result");
    expect(result.message).toContain("Reload the configuration");
  });

  it("always writes the caller's org, never a global row or a body-supplied org", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db), { ...input, org_id: null } as never);
    const payload = inserted(captures);
    expect(payload?.org_id).toBe("org-1");
  });

  it("normalizes the portal key and field label at the write boundary", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db), input);
    const payload = inserted(captures);
    // Folded so the SOP-step -> portal join stays a literal compare, and the
    // label matches the field_dictionary's learned key.
    expect(payload?.portal_key).toBe("availity");
    expect(payload?.field_label).toBe("npi number");
    expect(payload?.selector).toBe("#npi");
  });

  it("builds label suggestions from current maps while retaining current other-key evidence", async () => {
    const registryConfig = (portalKey: string, generation: number) => ({
      ...portalDbRow,
      id: `config-${portalKey}`,
      portal_key: portalKey,
      mapping_generation: generation,
    });
    const learnedMap = (id: string, portalKey: string, generation: number, token: string) => ({
      ...dbRow,
      id,
      portal_key: portalKey,
      field_label: "npi number",
      token,
      mapping_generation: generation,
      shared_base_generation: null,
      status: "approved",
    });
    const { db, captures } = makeFakeDb([
      { data: [] },
      { data: proposedRow },
      { data: [registryConfig("stale_other", 4), registryConfig("current_other", 2)] },
      { data: [] },
      {
        data: [
          learnedMap("stale-observation", "stale_other", 1, "group.tin"),
          learnedMap("current-observation", "current_other", 2, "provider.npi"),
        ],
      },
    ]);

    const result = await proposeFieldMap(proposeCtx(db), input);

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected a created proposal");
    expect(result.suggestion).toEqual({
      token: "provider.npi",
      portalCount: 1,
      fromDictionary: false,
    });
  });

  it("returns the existing row without inserting when the selector is already known", async () => {
    const { db, captures } = makeFakeDb([{ data: [dbRow] }]);
    const result = await proposeFieldMap(proposeCtx(db), input);
    expect(result.kind).toBe("existing");
    expect(captures.some((c) => c.op === "insert")).toBe(false);
  });

  it("writes a non-empty option list on first sighting", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db), {
      ...input,
      field_type: "select",
      control_options: [
        { value: "KS", label: "Kansas" },
        { value: "MO", label: "Missouri" },
      ],
    });
    const payload = inserted(captures);
    expect(payload?.control_options).toEqual([
      { value: "KS", label: "Kansas" },
      { value: "MO", label: "Missouri" },
    ]);
  });

  it("ignores an empty option list on insert so 'never captured' stays null", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db), { ...input, control_options: [] });
    expect(inserted(captures)?.control_options).toBeNull();
  });

  it("refreshes a non-empty vocabulary on an own-org re-capture without inserting", async () => {
    const own = { ...dbRow, org_id: "org-1", status: "approved", source: "token" };
    const refreshed = {
      ...own,
      control_options: [{ value: "KS", label: "Kansas" }],
    };
    const { db, captures } = makeFakeDb([{ data: [own] }, { data: refreshed }]);
    const result = await proposeFieldMap(proposeCtx(db), {
      ...input,
      field_type: "select",
      control_options: [{ value: "KS", label: "Kansas" }],
    });
    expect(result.kind).toBe("existing");
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(captures.some((c) => c.op === "update")).toBe(true);
    const update = captures.find((c) => c.op === "update")?.payload;
    expect(update?.control_options).toEqual([{ value: "KS", label: "Kansas" }]);
  });

  it("does not erase a stored vocabulary when re-capture returns an empty list", async () => {
    const own = {
      ...dbRow,
      org_id: "org-1",
      control_options: [{ value: "KS", label: "Kansas" }],
    };
    const { db, captures } = makeFakeDb([{ data: [own] }]);
    const result = await proposeFieldMap(proposeCtx(db), { ...input, control_options: [] });
    expect(result.kind).toBe("existing");
    expect(captures.some((c) => c.op === "update")).toBe(false);
  });

  it("leaves a GLOBAL hit unchanged even when a vocabulary is offered", async () => {
    const { db, captures } = makeFakeDb([{ data: [{ ...dbRow, org_id: null }] }]);
    await proposeFieldMap(proposeCtx(db), {
      ...input,
      control_options: [{ value: "KS", label: "Kansas" }],
    });
    expect(captures.some((c) => c.op === "update")).toBe(false);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
  });

  it("treats a GLOBAL row as already-covered (the shared catalog is authoritative)", async () => {
    // dbRow is org_id null — a global catalog entry for this very selector.
    const { db, captures } = makeFakeDb([{ data: [{ ...dbRow, org_id: null }] }]);
    const result = await proposeFieldMap(proposeCtx(db), input);
    expect(result.kind).toBe("existing");
    expect(captures.some((c) => c.op === "insert")).toBe(false);
  });

  it("scopes the dedupe lookup to global + own org", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db), input);
    const lookup = captures[0];
    expect(lookup.or).toBe("org_id.is.null,org_id.eq.org-1");
    expect(lookup.filters).toContainEqual(["portal_key", "availity"]);
    expect(lookup.filters).toContainEqual(["selector", "#npi"]);
  });

  it("audits a created proposal without echoing a token", async () => {
    const writeAudit = audit();
    const { db } = makeFakeDb([{ data: [] }, { data: proposedRow }]);
    await proposeFieldMap(proposeCtx(db, writeAudit), input);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        entityType: "portal_field_map",
        entityId: "m-new",
        after: expect.objectContaining({ status: "proposed", portalKey: "availity" }),
      }),
    );
  });

  it("does not audit when nothing was written", async () => {
    const writeAudit = audit();
    const { db } = makeFakeDb([{ data: [dbRow] }]);
    await proposeFieldMap(proposeCtx(db, writeAudit), input);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank portal_key", { portal_key: "  ", selector: "#npi" }],
    ["a missing portal_key", { selector: "#npi" }],
    ["a blank selector", { portal_key: "availity", selector: "   " }],
    ["a missing selector", { portal_key: "availity" }],
    ["an unknown field_type", { portal_key: "availity", selector: "#a", field_type: "textarea" }],
    ["a non-string field_label", { portal_key: "availity", selector: "#a", field_label: 42 }],
    [
      "a malformed control_options list",
      { portal_key: "availity", selector: "#a", control_options: [{ value: "KS" }] },
    ],
  ])("rejects %s with 422 before any query", async (_name, bad) => {
    const { db, captures } = makeFakeDb([]);
    const writeAudit = audit();
    const result = await proposeFieldMap(proposeCtx(db, writeAudit), bad as never);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") throw new Error("expected a rejected result");
    expect(result.status).toBe(422);
    expect(captures).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

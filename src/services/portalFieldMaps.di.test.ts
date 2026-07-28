import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// The module now also exposes browser readers/mutations that import the anon
// client at load; stub it so this ctx-only suite needs no real env (matches
// providers.di.test.ts).
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import {
  listPortalFieldMaps,
  proposeFieldMap,
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
  op?: "insert";
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
        limit() {
          return builder;
        },
        single: () => Promise.resolve(take()),
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
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
};

describe("portal field map service — injected server context", () => {
  it("scopes to global rows plus the caller's org via the .or() filter", async () => {
    const { db, captures } = makeFakeDb([{ data: [dbRow] }]);
    await listPortalFieldMaps(ctxWith(db));

    const cap = captures[0];
    expect(cap.table).toBe("portal_field_maps");
    expect(cap.or).toBe("org_id.is.null,org_id.eq.org-1");
    // Deterministic catalog order: portal_key, then created_at.
    expect(cap.orders).toEqual([
      ["portal_key", { ascending: true }],
      ["created_at", { ascending: true }],
    ]);
  });

  it("applies the portalKey filter when given and omits it otherwise", async () => {
    const filtered = makeFakeDb([{ data: [] }]);
    await listPortalFieldMaps(ctxWith(filtered.db), { portalKey: "availity" });
    expect(filtered.captures[0].filters).toContainEqual(["portal_key", "availity"]);

    const unfiltered = makeFakeDb([{ data: [] }]);
    await listPortalFieldMaps(ctxWith(unfiltered.db), {});
    expect(unfiltered.captures[0].filters).toHaveLength(0);
  });

  it("selects the explicit column list, never *", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }]);
    await listPortalFieldMaps(ctxWith(db));

    const cols = (captures[0].selectCols ?? "").split(",").map((c) => c.trim());
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
      "created_at",
      "updated_at",
    ]) {
      expect(cols).toContain(col);
    }
    expect(cols).not.toContain("*");
  });

  it("camelizes rows at the boundary", async () => {
    const { db } = makeFakeDb([{ data: [dbRow] }]);
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
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-02T00:00:00Z",
    });
    expect(rows[0]).not.toHaveProperty("portal_key");
  });

  it("returns [] when the query yields no rows", async () => {
    const { db } = makeFakeDb([{ data: null }]);
    await expect(listPortalFieldMaps(ctxWith(db))).resolves.toEqual([]);
  });

  // Live rows are seeded by humans pasting from SOP templates, so the DB holds
  // "{{provider.firstName}}" alongside bare "provider.firstName". The endpoint
  // contract is the bare catalog form — the extension joins these strings
  // literally against profile tokens (tonight's 0-fields-filled bug).
  it("normalizes braced DB tokens to the bare catalog form at the read boundary", async () => {
    const bracedRow = { ...dbRow, id: "m2", token: "{{provider.firstName}}" };
    const spacedRow = { ...dbRow, id: "m3", token: " {{ group.tin }} " };
    const { db } = makeFakeDb([{ data: [dbRow, bracedRow, spacedRow] }]);

    const rows = await listPortalFieldMaps(ctxWith(db));

    expect(rows.map((r) => r.token)).toEqual(["provider.npi", "provider.firstName", "group.tin"]);
  });

  it("leaves manual rows' null token as null", async () => {
    const manualRow = { ...dbRow, id: "m4", source: "manual", token: null };
    const { db } = makeFakeDb([{ data: [manualRow] }]);

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

  it("returns the existing row without inserting when the selector is already known", async () => {
    const { db, captures } = makeFakeDb([{ data: [dbRow] }]);
    const result = await proposeFieldMap(proposeCtx(db), input);
    expect(result.kind).toBe("existing");
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

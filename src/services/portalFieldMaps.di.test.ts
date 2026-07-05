import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { listPortalFieldMaps, type PortalFieldMapServiceCtx } from "./portalFieldMaps";

// Minimal chainable fake of the supabase-js query builder — enough for the
// portal-field-map list shape. Records the table, columns, `.or()` expression,
// eq filters, and every `.order()` call so tests can assert what was sent.
interface Captured {
  table?: string;
  selectCols?: string;
  or?: string;
  filters: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean }]>;
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
        order(col: string, opts: { ascending: boolean }) {
          cap.orders.push([col, opts]);
          return builder;
        },
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
});

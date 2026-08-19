import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// These tests always inject an explicit ctx, so the browser default client is
// never used. Stub it so importing the service doesn't construct a real
// Supabase client (which needs VITE_ env that isn't present under vitest).
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  type ProviderServiceCtx,
} from "./providers";

// Minimal chainable fake of the supabase-js query builder — enough for the
// provider service's four query shapes. Records the table, op, insert/update
// payload, filters, and range so tests can assert what was sent to the DB.
interface Captured {
  table?: string;
  op: "select" | "insert" | "update";
  selectCols?: string;
  selectOpts?: { count?: string };
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
  excludeFilters: Array<[string, unknown]>;
  inFilters: Array<[string, unknown[]]>;
  range?: [number, number];
  order?: [string, { ascending: boolean }];
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown; count?: number }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const db = {
    from(table: string) {
      const cap: Captured = {
        table,
        op: "select",
        filters: [],
        excludeFilters: [],
        inFilters: [],
      };
      captures.push(cap);
      const builder: Record<string, unknown> = {
        select(cols: string, opts?: { count?: string }) {
          cap.selectCols = cols;
          cap.selectOpts = opts;
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
        eq(col: string, val: unknown) {
          cap.filters.push([col, val]);
          return builder;
        },
        neq(col: string, val: unknown) {
          cap.excludeFilters.push([col, val]);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          cap.inFilters.push([col, vals]);
          return builder;
        },
        or() {
          return builder;
        },
        order(col: string, opts: { ascending: boolean }) {
          cap.order = [col, opts];
          return builder;
        },
        range(a: number, b: number) {
          cap.range = [a, b];
          return builder;
        },
        maybeSingle: () => Promise.resolve(take()),
        single: () => Promise.resolve(take()),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(take()).then(res, rej),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

function ctxWith(db: SupabaseClient<Database>, writeAudit = vi.fn().mockResolvedValue(undefined)) {
  const ctx: ProviderServiceCtx = { db, orgId: "org-1", writeAudit };
  return { ctx, writeAudit };
}

describe("provider service — injected server context", () => {
  it("listProviders scopes to ctx.orgId, paginates with range + exact count", async () => {
    const rows = [
      { id: "p1", first_name: "Ana", last_name: "Beck", email: "a@x.io" },
      { id: "p2", first_name: "Cy", last_name: "Dell", email: "c@x.io" },
    ];
    const { db, captures } = makeFakeDb([{ data: rows, count: 42 }]);
    const { ctx } = ctxWith(db);

    const page = await listProviders(ctx, {}, { page: 2, pageSize: 10 });

    expect(page.total).toBe(42);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]).toMatchObject({ id: "p1", firstName: "Ana", lastName: "Beck" });
    const cap = captures[0];
    expect(cap.selectOpts).toEqual({ count: "exact" });
    expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    expect(cap.range).toEqual([10, 19]); // page 2, size 10 => rows 10..19
  });

  it("listProviders applies excludeStatus as a neq filter", async () => {
    const { db, captures } = makeFakeDb([{ data: [], count: 0 }]);
    const { ctx } = ctxWith(db);
    await listProviders(ctx, { excludeStatus: "terminated" }, { page: 1, pageSize: 25 });
    expect(captures[0].excludeFilters).toContainEqual(["status", "terminated"]);
    expect(captures[0].filters).not.toContainEqual(["status", "terminated"]);
  });

  it("an explicit status filter wins over excludeStatus (caller shouldn't set both, but status is authoritative)", async () => {
    const { db, captures } = makeFakeDb([{ data: [], count: 0 }]);
    const { ctx } = ctxWith(db);
    await listProviders(
      ctx,
      { status: "terminated", excludeStatus: "terminated" },
      { page: 1, pageSize: 25 },
    );
    expect(captures[0].filters).toContainEqual(["status", "terminated"]);
    expect(captures[0].excludeFilters).toEqual([]);
  });

  it("the list projection never leaks PHI (no ssn / dob / home street-city-zip)", async () => {
    const { db, captures } = makeFakeDb([{ data: [], count: 0 }]);
    const { ctx } = ctxWith(db);
    await listProviders(ctx, {}, { page: 1, pageSize: 25 });

    const cols = captures[0].selectCols ?? "";
    for (const phi of ["ssn_last4", "date_of_birth", "home_street", "home_city", "home_zip"]) {
      expect(cols).not.toContain(phi);
    }
  });

  // 2026-08-19 — `withGroups`: the extension's provider search names the group
  // beside the provider, because the same human can be on two groups' rosters.
  it("listProviders without withGroups issues exactly ONE query (browser path unchanged)", async () => {
    const { db, captures } = makeFakeDb([{ data: [{ id: "p1" }], count: 1 }]);
    const { ctx } = ctxWith(db);
    const page = await listProviders(ctx, {}, { page: 1, pageSize: 25 });
    expect(captures).toHaveLength(1);
    expect(page.rows[0]).not.toHaveProperty("groups");
  });

  it("withGroups reads provider_group_assignments org-scoped on BOTH sides, for the fetched ids only", async () => {
    const { db, captures } = makeFakeDb([
      { data: [{ id: "p1" }, { id: "p2" }], count: 2 },
      {
        data: [
          {
            provider_id: "p1",
            group_id: "g2",
            is_primary: false,
            end_date: null,
            provider_groups: { name: "Zenith Ortho", org_id: "org-1" },
          },
          {
            provider_id: "p1",
            group_id: "g1",
            is_primary: true,
            end_date: null,
            provider_groups: { name: "Acme Health", org_id: "org-1" },
          },
        ],
      },
    ]);
    const { ctx } = ctxWith(db);

    const page = await listProviders(ctx, {}, { page: 1, pageSize: 25, withGroups: true });

    const join = captures[1];
    expect(join.table).toBe("provider_group_assignments");
    // The service key bypasses RLS, so the org filter is the wall — on the
    // assignment row AND on the embedded group.
    expect(join.filters).toContainEqual(["org_id", "org-1"]);
    expect(join.filters).toContainEqual(["provider_groups.org_id", "org-1"]);
    expect(join.inFilters).toContainEqual(["provider_id", ["p1", "p2"]]);

    expect(page.rows[0]?.groups?.map((g) => g.name)).toEqual(["Acme Health", "Zenith Ortho"]);
    // A provider with no membership gets an empty list, never an absent key —
    // absent means "not requested" on the wire.
    expect(page.rows[1]?.groups).toEqual([]);
  });

  it("withGroups skips the second query entirely when the page is empty", async () => {
    const { db, captures } = makeFakeDb([{ data: [], count: 0 }]);
    const { ctx } = ctxWith(db);
    await listProviders(ctx, {}, { page: 1, pageSize: 25, withGroups: true });
    expect(captures).toHaveLength(1);
  });

  it("createProvider sets org_id from ctx (not the body) and writes an audit row", async () => {
    const created = { id: "new-1", first_name: "Ana", last_name: "Beck", org_id: "org-1" };
    const { db, captures } = makeFakeDb([{ data: created }]);
    const { ctx, writeAudit } = ctxWith(db);

    // Attacker tries to plant a different org via the body.
    const result = await createProvider(
      { firstName: "Ana", lastName: "Beck", org_id: "org-EVIL" } as never,
      ctx,
    );

    expect(result.id).toBe("new-1");
    const insertCap = captures.find((c) => c.op === "insert");
    expect(insertCap?.payload?.org_id).toBe("org-1");
    expect(insertCap?.payload).not.toHaveProperty("org_id", "org-EVIL");
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "CREATE", entityType: "provider" }),
    );
  });

  it("updateProvider filters by id + ctx.orgId and audits", async () => {
    const before = { id: "p9", first_name: "Old", last_name: "Name" };
    const after = { id: "p9", first_name: "New", last_name: "Name" };
    const { db, captures } = makeFakeDb([{ data: before }, { data: after }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await updateProvider("p9", { firstName: "New" }, ctx);

    expect(result.firstName).toBe("New");
    const updateCap = captures.find((c) => c.op === "update");
    expect(updateCap?.filters).toContainEqual(["id", "p9"]);
    expect(updateCap?.filters).toContainEqual(["org_id", "org-1"]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "UPDATE", entityType: "provider" }),
    );
  });

  it("getProvider scopes by id + ctx.orgId", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: "p1", first_name: "Ana", last_name: "Beck" } },
    ]);
    const { ctx } = ctxWith(db);
    const provider = await getProvider("p1", ctx);
    expect(provider?.id).toBe("p1");
    expect(captures[0].filters).toContainEqual(["id", "p1"]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
  });
});

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
  range?: [number, number];
  order?: [string, { ascending: boolean }];
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown; count?: number }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const db = {
    from(table: string) {
      const cap: Captured = { table, op: "select", filters: [] };
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

  it("the list projection never leaks PHI (no ssn / dob / home street-city-zip)", async () => {
    const { db, captures } = makeFakeDb([{ data: [], count: 0 }]);
    const { ctx } = ctxWith(db);
    await listProviders(ctx, {}, { page: 1, pageSize: 25 });

    const cols = captures[0].selectCols ?? "";
    for (const phi of ["ssn_last4", "date_of_birth", "home_street", "home_city", "home_zip"]) {
      expect(cols).not.toContain(phi);
    }
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

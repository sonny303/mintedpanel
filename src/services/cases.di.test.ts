import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// These tests always inject an explicit ctx, so the browser default client is
// never used. Stub it so importing the service doesn't construct a real
// Supabase client (which needs VITE_ env that isn't present under vitest).
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
// cases.ts also pulls the notes lookup for getCase; unused by the picker.
vi.mock("@/services/lookups", () => ({ getNotesFor: vi.fn() }));

import { listCasesForPicker, type CaseServiceCtx } from "./cases";

// Minimal chainable fake of the supabase-js query builder — enough for the
// case-picker list shape. Records the table, columns, eq filters, and order
// calls so tests can assert what was sent (same pattern as
// portalFieldMaps.di.test.ts).
interface Captured {
  table?: string;
  selectCols?: string;
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

function ctxWith(db: SupabaseClient<Database>): CaseServiceCtx {
  return { db, orgId: "org-1" };
}

const dbRow = {
  id: "c1",
  payer_id: "payer-1",
  state: "KS",
  submitted_date: "2026-06-01",
  payers: { name: "BCBS of Kansas" },
  status_configs: { label: "Submitted" },
};

describe("case picker service — injected server context", () => {
  it("scopes by org AND provider, newest first", async () => {
    const { db, captures } = makeFakeDb([{ data: [dbRow] }]);
    await listCasesForPicker(ctxWith(db), "prov-1");

    const cap = captures[0];
    expect(cap.table).toBe("credential_cases");
    expect(cap.filters).toEqual([
      ["org_id", "org-1"],
      ["provider_id", "prov-1"],
    ]);
    expect(cap.orders).toEqual([["created_at", { ascending: false }]]);
  });

  it("selects the explicit picker projection with payer/status embeds, never *", async () => {
    const { db, captures } = makeFakeDb([{ data: [] }]);
    await listCasesForPicker(ctxWith(db), "prov-1");

    const cols = captures[0].selectCols ?? "";
    expect(cols).toContain("id");
    expect(cols).toContain("payer_id");
    expect(cols).toContain("state");
    expect(cols).toContain("submitted_date");
    expect(cols).toContain("payers(name)");
    expect(cols).toContain("status_configs(label)");
    expect(cols).not.toContain("*");
  });

  it("flattens the embeds into the picker DTO", async () => {
    const { db } = makeFakeDb([{ data: [dbRow] }]);
    const rows = await listCasesForPicker(ctxWith(db), "prov-1");

    expect(rows).toEqual([
      {
        id: "c1",
        payerId: "payer-1",
        payerName: "BCBS of Kansas",
        state: "KS",
        statusLabel: "Submitted",
        submittedDate: "2026-06-01",
      },
    ]);
  });

  it("tolerates missing embeds (null payer/status)", async () => {
    const { db } = makeFakeDb([{ data: [{ ...dbRow, payers: null, status_configs: null }] }]);
    const rows = await listCasesForPicker(ctxWith(db), "prov-1");
    expect(rows[0]).toMatchObject({ payerName: null, statusLabel: null });
  });

  it("returns [] when the query yields no rows", async () => {
    const { db } = makeFakeDb([{ data: null }]);
    await expect(listCasesForPicker(ctxWith(db), "prov-1")).resolves.toEqual([]);
  });
});

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// The service imports the anon client at load for its browser default ctx;
// stub it so this ctx-only suite needs no real env.
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { FORBIDDEN_SEARCH_COLUMNS } from "@/lib/globalSearch";
import { searchProvidersAcrossOrgs, type GlobalProviderSearchCtx } from "./globalProviderSearch";

// Minimal chainable fake of the supabase-js query builder, recording what the
// cross-org read actually asked for. The assertions below are the security
// review of this service in executable form: the read must carry no org filter
// (RLS supplies it), no PHI column, and a bounded limit.
interface Captured {
  table?: string;
  selectCols?: string;
  or?: string;
  eqFilters: Array<[string, unknown]>;
  limit?: number;
}

function makeFakeDb(result: { data: unknown; error?: unknown }) {
  const captures: Captured[] = [];

  const db = {
    from(table: string) {
      const cap: Captured = { table, eqFilters: [] };
      captures.push(cap);
      const builder: Record<string, unknown> = {
        select(cols: string) {
          cap.selectCols = cols;
          return builder;
        },
        or(filter: string) {
          cap.or = filter;
          return builder;
        },
        eq(col: string, val: unknown) {
          cap.eqFilters.push([col, val]);
          return builder;
        },
        in(col: string, val: unknown) {
          cap.eqFilters.push([col, val]);
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          cap.limit = n;
          return builder;
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return builder;
    },
  };
  return {
    ctx: { db: db as unknown as SupabaseClient<Database> } as GlobalProviderSearchCtx,
    captures,
  };
}

const MEMBER_ORGS = new Map([
  ["org-1", "Kansas PT"],
  ["org-2", "Missouri Rehab"],
]);

function providerRow(over: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    org_id: "org-1",
    first_name: "Jane",
    last_name: "Smith",
    credentials: "PT, DPT",
    npi: "1234567890",
    status: "active",
    organizations: { name: "Kansas PT" },
    ...over,
  };
}

describe("searchProvidersAcrossOrgs — what the query asks for", () => {
  it("reads providers with no org filter, because RLS is the wall", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    await searchProvidersAcrossOrgs("smith", MEMBER_ORGS, ctx);

    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("providers");
    // Naming an org here would re-impose the silo this lookup exists to cross;
    // under the anon client, providers_select (org_id IN user_org_ids()) is
    // what keeps a non-member org's rows unreachable.
    expect(captures[0].eqFilters).toEqual([]);
    expect(captures[0].or).not.toContain("org_id");
  });

  it("selects only the lookup projection — no PHI column, no select(*)", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    await searchProvidersAcrossOrgs("smith", MEMBER_ORGS, ctx);

    const cols = captures[0].selectCols ?? "";
    expect(cols).not.toContain("*");
    for (const column of FORBIDDEN_SEARCH_COLUMNS) {
      expect(cols).not.toContain(column);
    }
    expect(cols).toContain("npi");
    expect(cols).toContain("organizations(name)");
  });

  it("bounds the read, so a two-character term cannot pull every org's roster", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    await searchProvidersAcrossOrgs("sm", MEMBER_ORGS, ctx);

    expect(captures[0].limit).toBe(60);
  });

  it("sends the sanitized term, so a crafted query cannot rewrite the filter", async () => {
    const { ctx, captures } = makeFakeDb({ data: [] });

    await searchProvidersAcrossOrgs("smith),or(ssn_last4.not.is.null", MEMBER_ORGS, ctx);

    const filter = captures[0].or ?? "";
    // The injected column reference and operator chain arrive as inert text.
    expect(filter).not.toContain("ssn_last4");
    expect(filter).not.toContain("not.is.null");
    // Every parenthesis in the filter is one this module opened itself.
    expect(filter.match(/\(/g) ?? []).toHaveLength((filter.match(/and\(/g) ?? []).length);
  });
});

describe("searchProvidersAcrossOrgs — when it issues no query at all", () => {
  it("skips the read below the minimum term length", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    expect(await searchProvidersAcrossOrgs("s", MEMBER_ORGS, ctx)).toEqual([]);
    expect(captures).toHaveLength(0);
  });

  it("skips the read for a term that sanitizes away to nothing", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    expect(await searchProvidersAcrossOrgs("%%%", MEMBER_ORGS, ctx)).toEqual([]);
    expect(captures).toHaveLength(0);
  });

  it("skips the read when the caller has no memberships", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    expect(await searchProvidersAcrossOrgs("smith", new Map(), ctx)).toEqual([]);
    expect(captures).toHaveLength(0);
  });
});

describe("searchProvidersAcrossOrgs — results", () => {
  it("returns the hit shape across several orgs, org name resolved", async () => {
    const { ctx } = makeFakeDb({
      data: [
        providerRow(),
        providerRow({
          id: "p-2",
          org_id: "org-2",
          first_name: "Jane",
          last_name: "Smithers",
          organizations: { name: "Missouri Rehab" },
        }),
      ],
    });

    const hits = await searchProvidersAcrossOrgs("smith", MEMBER_ORGS, ctx);

    expect(hits).toEqual([
      {
        providerId: "p-1",
        orgId: "org-1",
        orgName: "Kansas PT",
        name: "Jane Smith",
        firstName: "Jane",
        lastName: "Smith",
        credentials: "PT, DPT",
        npi: "1234567890",
        status: "active",
      },
      {
        providerId: "p-2",
        orgId: "org-2",
        orgName: "Missouri Rehab",
        name: "Jane Smithers",
        firstName: "Jane",
        lastName: "Smithers",
        credentials: "PT, DPT",
        npi: "1234567890",
        status: "active",
      },
    ]);
  });

  it("drops a row from an org the caller is not a member of", async () => {
    const { ctx } = makeFakeDb({
      data: [providerRow({ id: "p-leak", org_id: "org-foreign" }), providerRow()],
    });

    const hits = await searchProvidersAcrossOrgs("smith", MEMBER_ORGS, ctx);

    expect(hits.map((h) => h.providerId)).toEqual(["p-1"]);
  });

  it("propagates a query error instead of rendering an empty result", async () => {
    const { ctx } = makeFakeDb({ data: null, error: new Error("policy violation") });

    await expect(searchProvidersAcrossOrgs("smith", MEMBER_ORGS, ctx)).rejects.toThrow(
      "policy violation",
    );
  });
});

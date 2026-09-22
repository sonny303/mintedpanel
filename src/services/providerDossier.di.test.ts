import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { FORBIDDEN_DOSSIER_COLUMNS } from "@/lib/providerDossier";
import { loadProviderDossier, type ProviderDossierCtx } from "./providerDossier";

interface Captured {
  table?: string;
  selectCols?: string;
  eqFilters: Array<[string, unknown]>;
  or?: string;
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
        eq(col: string, val: unknown) {
          cap.eqFilters.push([col, val]);
          return builder;
        },
        or(filter: string) {
          cap.or = filter;
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
    ctx: { db: db as unknown as SupabaseClient<Database> } as ProviderDossierCtx,
    captures,
  };
}

const MEMBER_ORGS = new Map([
  ["org-a", "Kansas PT"],
  ["org-b", "Missouri Rehab"],
]);

function providerRow(over: Record<string, unknown> = {}) {
  return {
    id: "p-a",
    org_id: "org-a",
    first_name: "Marc",
    last_name: "Ng",
    credentials: "PT",
    npi: "1234567890",
    status: "active",
    organizations: { name: "Kansas PT" },
    state_licenses: [
      {
        id: "lic-1",
        org_id: "org-a",
        state: "KS",
        license_number: "KS-100",
        license_type: "PT",
        expiration_date: "2027-01-02",
        status: "active",
        verified_status: "verified",
      },
    ],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    ...over,
  };
}

describe("loadProviderDossier — what the query asks for", () => {
  it("reads providers by NPI with no org filter, because RLS is the wall", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    await loadProviderDossier("1234567890", MEMBER_ORGS, ctx);

    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("providers");
    expect(captures[0].eqFilters).toEqual([["npi", "1234567890"]]);
    expect(captures[0].or).toBeUndefined();
    const cols = captures[0].selectCols ?? "";
    expect(cols).not.toContain("*");
    expect(cols).toContain("state_licenses(");
    expect(cols).toContain("provider_groups(");
    expect(cols).toContain("facilities(");
    for (const column of FORBIDDEN_DOSSIER_COLUMNS) {
      expect(cols).not.toContain(column);
    }
  });

  it("drops a non-member org's license even when the row comes back", async () => {
    const { ctx } = makeFakeDb({
      data: [
        providerRow(),
        providerRow({
          id: "p-x",
          org_id: "org-foreign",
          state_licenses: [
            {
              id: "lic-x",
              org_id: "org-foreign",
              state: "CA",
              license_number: "CA-9",
              license_type: "PT",
              expiration_date: "2030-01-01",
              status: "active",
              verified_status: "verified",
            },
          ],
        }),
      ],
    });

    const dossier = await loadProviderDossier("1234567890", MEMBER_ORGS, ctx);

    expect(dossier?.affiliations.map((row) => row.orgId)).toEqual(["org-a"]);
    expect(dossier?.licenses.map((row) => row.state)).toEqual(["KS"]);
  });
});

describe("loadProviderDossier — when it issues no query", () => {
  it("skips the read for a partial NPI", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    expect(await loadProviderDossier("12345", MEMBER_ORGS, ctx)).toBeNull();
    expect(captures).toHaveLength(0);
  });

  it("skips the read when the caller has no memberships", async () => {
    const { ctx, captures } = makeFakeDb({ data: [providerRow()] });

    expect(await loadProviderDossier("1234567890", new Map(), ctx)).toBeNull();
    expect(captures).toHaveLength(0);
  });
});

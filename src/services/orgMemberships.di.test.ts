import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { listUserOrgMemberships } from "./orgMemberships";

// Minimal chainable fake of the supabase-js builder — one memberships query,
// capturing the projection and filters (same style as the other .di tests).
interface Captured {
  table: string;
  selectCols?: string;
  filters: Array<[string, unknown]>;
}

function makeFakeDb(result: { data: unknown; error?: unknown }) {
  const captures: Captured[] = [];
  const db = {
    from(table: string) {
      const cap: Captured = { table, filters: [] };
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
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ error: null, ...result }).then(res, rej),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

describe("org memberships service — the /api/me/orgs projection", () => {
  it("queries memberships by the JWT user id with explicit columns only", async () => {
    const { db, captures } = makeFakeDb({ data: [] });

    await listUserOrgMemberships({ db }, "user-1");

    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("memberships");
    expect(captures[0].selectCols).toBe("org_id, role, organizations(name)");
    // The ONLY filter: the caller's own user id. No org filter exists here —
    // the endpoint's job is discovering the caller's orgs.
    expect(captures[0].filters).toEqual([["user_id", "user-1"]]);
  });

  it("maps rows to { orgId, orgName, role }, sorted by org name", async () => {
    const { db } = makeFakeDb({
      data: [
        { org_id: "org-b", role: "billing", organizations: { name: "Beta Group" } },
        { org_id: "org-a", role: "admin", organizations: { name: "Alpha Group" } },
        // A dangling embed cannot happen (org_id is a NOT NULL FK) but must
        // not crash the projection if it ever does.
        { org_id: "org-c", role: "specialist", organizations: null },
      ],
    });

    const rows = await listUserOrgMemberships({ db }, "user-1");

    expect(rows).toEqual([
      { orgId: "org-c", orgName: "", role: "specialist" },
      { orgId: "org-a", orgName: "Alpha Group", role: "admin" },
      { orgId: "org-b", orgName: "Beta Group", role: "billing" },
    ]);
  });

  it("returns an empty list for a user with no memberships", async () => {
    const { db } = makeFakeDb({ data: [] });
    expect(await listUserOrgMemberships({ db }, "user-1")).toEqual([]);
  });

  it("propagates a query error", async () => {
    const { db } = makeFakeDb({ data: null, error: new Error("memberships query failed") });
    await expect(listUserOrgMemberships({ db }, "user-1")).rejects.toThrow(
      "memberships query failed",
    );
  });
});

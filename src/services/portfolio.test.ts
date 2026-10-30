import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ currentUserId: vi.fn() }));

import { supabase } from "@/integrations/supabase/externalClient";
import { currentUserId } from "@/lib/audit";
import { listPortfolioOrgs } from "./portfolio";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface Captured {
  table?: string;
  select?: string;
  selectOpts?: unknown;
  filters: Array<[string, unknown]>;
  orders: Array<[string, unknown]>;
  ranges: Array<[number, number]>;
}

function fakeQuery(page: { data: unknown[]; count: number }): Captured {
  const cap: Captured = { filters: [], orders: [], ranges: [] };
  const builder = {
    select(cols: string, opts?: unknown) {
      cap.select = cols;
      cap.selectOpts = opts;
      return builder;
    },
    eq(column: string, value: unknown) {
      cap.filters.push([column, value]);
      return builder;
    },
    order(column: string, opts?: unknown) {
      cap.orders.push([column, opts]);
      return builder;
    },
    range(from: number, to: number) {
      cap.ranges.push([from, to]);
      return Promise.resolve({ data: page.data, error: null, count: page.count });
    },
  };
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    cap.table = table;
    return builder;
  }) as never);
  return cap;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPortfolioOrgs", () => {
  it("reads only the caller's member orgs, in name order, as a complete paged read", async () => {
    vi.mocked(currentUserId).mockReturnValue(USER_ID);
    const cap = fakeQuery({ data: [], count: 0 });

    await listPortfolioOrgs();

    expect(cap.table).toBe("organizations");
    expect(cap.select).toBe("id, name, lifecycle_state, created_at, memberships!inner(user_id)");
    expect(cap.selectOpts).toEqual({ count: "exact" });
    // The membership scope is in the query, not left to the organizations
    // policy (which a platform admin passes for every row).
    expect(cap.filters).toEqual([["memberships.user_id", USER_ID]]);
    expect(cap.orders).toEqual([
      ["name", undefined],
      ["id", { ascending: true }],
    ]);
    expect(cap.ranges[0]).toEqual([0, 499]);
  });

  it("maps rows to Portfolio orgs and drops the scoping embed", async () => {
    vi.mocked(currentUserId).mockReturnValue(USER_ID);
    fakeQuery({
      count: 3,
      data: [
        {
          id: "o1",
          name: "Outer Banks Rehab Group",
          lifecycle_state: "inactive",
          created_at: "2026-06-01T00:00:00Z",
          memberships: [{ user_id: USER_ID }],
        },
        {
          id: "o2",
          name: "Rose City Rehab Collective",
          lifecycle_state: "prospect",
          created_at: "2026-07-01T00:00:00Z",
          memberships: [{ user_id: USER_ID }],
        },
        {
          id: "o3",
          name: "Shelby Sports Rehab",
          lifecycle_state: "archived",
          created_at: "2026-07-02T00:00:00Z",
          memberships: [{ user_id: USER_ID }],
        },
      ],
    });

    await expect(listPortfolioOrgs()).resolves.toEqual([
      {
        id: "o1",
        name: "Outer Banks Rehab Group",
        lifecycleState: "inactive",
        createdAt: "2026-06-01T00:00:00Z",
      },
      {
        id: "o2",
        name: "Rose City Rehab Collective",
        lifecycleState: "prospect",
        createdAt: "2026-07-01T00:00:00Z",
      },
      // An unknown lifecycle value coerces to active.
      {
        id: "o3",
        name: "Shelby Sports Rehab",
        lifecycleState: "active",
        createdAt: "2026-07-02T00:00:00Z",
      },
    ]);
  });

  it("returns no orgs without a signed-in user, and never queries", async () => {
    vi.mocked(currentUserId).mockReturnValue(null);

    await expect(listPortfolioOrgs()).resolves.toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

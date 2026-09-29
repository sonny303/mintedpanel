import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@/lib/audit", () => ({ requireActiveOrg: vi.fn() }));

import { listRosterFacilityOptions } from "./rosterEngine";

type FacilityRow = { id: string; name: string; state: string | null };
type Capture = {
  table: string;
  columns: string;
  filters: Array<[string, string]>;
  orders: string[];
  range: [number, number];
};

function fakeDb(rows: FacilityRow[], failurePage?: number) {
  const captures: Capture[] = [];
  const db = {
    from(table: string) {
      const capture: Capture = { table, columns: "", filters: [], orders: [], range: [0, 0] };
      const builder = {
        select(columns: string) {
          capture.columns = columns;
          return builder;
        },
        eq(column: string, value: string) {
          capture.filters.push([column, value]);
          return builder;
        },
        order(column: string) {
          capture.orders.push(column);
          return builder;
        },
        range(from: number, to: number) {
          capture.range = [from, to];
          captures.push(capture);
          return Promise.resolve(
            from === failurePage
              ? { data: null, error: { message: "Location lookup failed" } }
              : { data: rows.slice(from, to + 1), error: null },
          );
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

function facilities(count: number): FacilityRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `facility-${String(index).padStart(4, "0")}`,
    name: `Clinic ${String(index).padStart(4, "0")}`,
    state: "NC",
  }));
}

describe("roster facility picker lookup", () => {
  it("reads every org-scoped page past Supabase's default row cap in stable order", async () => {
    const { db, captures } = fakeDb(facilities(1001));

    const rows = await listRosterFacilityOptions({ db, orgId: "org-caller" });

    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)?.id).toBe("facility-1000");
    expect(captures.map((capture) => capture.range)).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
    for (const capture of captures) {
      expect(capture.table).toBe("facilities");
      expect(capture.columns).toBe("id,name,state");
      expect(capture.filters).toContainEqual(["org_id", "org-caller"]);
      expect(capture.orders).toEqual(["name", "id"]);
    }
  });

  it("accepts exactly 5,000 locations and rejects a 5,001st instead of truncating", async () => {
    const atLimit = fakeDb(facilities(5000));
    await expect(
      listRosterFacilityOptions({ db: atLimit.db, orgId: "org-caller" }),
    ).resolves.toHaveLength(5000);
    expect(atLimit.captures.at(-1)?.range).toEqual([5000, 5000]);

    const overLimit = fakeDb(facilities(5001));
    await expect(
      listRosterFacilityOptions({ db: overLimit.db, orgId: "org-caller" }),
    ).rejects.toThrow("Roster location options exceed the 5,000 record selection limit");
    expect(overLimit.captures.at(-1)?.range).toEqual([5000, 5000]);
  });

  it("fails the lookup when a later page errors", async () => {
    const { db } = fakeDb(facilities(700), 500);
    await expect(listRosterFacilityOptions({ db, orgId: "org-caller" })).rejects.toMatchObject({
      message: "Location lookup failed",
    });
  });
});

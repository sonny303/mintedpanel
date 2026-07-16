import { describe, it, expect, vi } from "vitest";

// E4.2 SOP hardening — a backend read/query test proving generic-fallback usage
// is countable by organization, payer, state, group, AND generation run. The
// service read is org-scoped and tier-filtered; the returned rows carry every
// grouping dimension, so `countRunRowsBy` (pure) tallies them per dimension.
//
// generationRuns.ts is a browser-path service (anon client + requireActiveOrg);
// mock both like the other *.di.test.ts suites so this drives the query builder
// without a real env or auth store.
const holder = vi.hoisted(() => ({
  from: (_table: string): unknown => {
    throw new Error("no fake db installed");
  },
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (table: string) => holder.from(table) },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
}));

import { listGenerationRunRowsByTier } from "./generationRuns";
import { countRunRowsBy } from "@/lib/generationRuns";

interface Capture {
  table: string;
  selectCols?: string;
  filters: Array<[string, unknown]>;
  order?: [string, unknown];
}

function installDb(rows: unknown[]): Capture {
  const cap: Capture = { table: "", filters: [] };
  const builder: Record<string, unknown> = {
    select(cols: string) {
      cap.selectCols = cols;
      return builder;
    },
    eq(col: string, val: unknown) {
      cap.filters.push([col, val]);
      return builder;
    },
    order(col: string, opts: unknown) {
      cap.order = [col, opts];
      return Promise.resolve({ data: rows, error: null });
    },
  };
  holder.from = (table: string) => {
    cap.table = table;
    return builder;
  };
  return cap;
}

function runRow(over: {
  id: string;
  runId: string;
  payerId: string;
  state: string;
  groupId: string;
}): Record<string, unknown> {
  return {
    id: over.id,
    org_id: "org-1",
    run_id: over.runId,
    provider_id: "prov",
    group_id: over.groupId,
    payer_id: over.payerId,
    state: over.state,
    disposition: "created",
    reason: "generated",
    case_id: `case-${over.id}`,
    exclusion_id: null,
    sop_template_id: "00000000-0000-4000-a000-00000000e17b",
    sop_version: 1,
    sop_resolution_tier: "generic_fallback",
    created_at: "2026-07-16T00:00:00Z",
  };
}

describe("listGenerationRunRowsByTier — generic-fallback usage is countable by every dimension", () => {
  it("reads org-scoped + tier-filtered rows and counts them by run / payer / state / group", async () => {
    const rows = [
      runRow({ id: "r1", runId: "run-a", payerId: "pay1", state: "NC", groupId: "g1" }),
      runRow({ id: "r2", runId: "run-a", payerId: "pay1", state: "NC", groupId: "g2" }),
      runRow({ id: "r3", runId: "run-b", payerId: "pay2", state: "SC", groupId: "g1" }),
    ];
    const cap = installDb(rows);

    const result = await listGenerationRunRowsByTier("generic_fallback");

    // Org isolation + tier filter are on the query (organization countability).
    expect(cap.table).toBe("case_generation_run_rows");
    expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    expect(cap.filters).toContainEqual(["sop_resolution_tier", "generic_fallback"]);

    // Returned rows are camelized and carry every grouping dimension.
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      runId: "run-a",
      payerId: "pay1",
      state: "NC",
      groupId: "g1",
      sopResolutionTier: "generic_fallback",
      sopVersion: 1,
    });

    // Countable per generation run, payer, state, and group.
    expect(countRunRowsBy(result, "runId")).toEqual(
      new Map([
        ["run-a", 2],
        ["run-b", 1],
      ]),
    );
    expect(countRunRowsBy(result, "payerId")).toEqual(
      new Map([
        ["pay1", 2],
        ["pay2", 1],
      ]),
    );
    expect(countRunRowsBy(result, "state")).toEqual(
      new Map([
        ["NC", 2],
        ["SC", 1],
      ]),
    );
    expect(countRunRowsBy(result, "groupId")).toEqual(
      new Map([
        ["g1", 2],
        ["g2", 1],
      ]),
    );
  });
});

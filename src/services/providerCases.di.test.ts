import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { listOpenProviderCases, type ProviderCasesServiceCtx } from "./providerCases";

// Minimal chainable fake of the supabase-js query builder — enough for the
// provider-cases shapes (org-scoped maybeSingle lookup, filtered selects).
// Records table, select columns, and filters; results consume in call order,
// which is deterministic in listOpenProviderCases.
interface Captured {
  table?: string;
  selectCols?: string;
  filters: Array<[string, unknown]>;
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

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
        maybeSingle: () => Promise.resolve(take()),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(take()).then(res, rej),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

function ctxWith(db: SupabaseClient<Database>): ProviderCasesServiceCtx {
  return { db, orgId: "org-1" };
}

const PROVIDER_ID = "99999999-8888-4777-8666-121212121212";

// Kansas-shaped credentialing statuses: 'complete' is the terminal bucket.
const STATUSES = [
  { id: "st-open", label: "In Progress", action_bucket: "ours" },
  { id: "st-submitted", label: "Submitted", action_bucket: "waiting_payer" },
  { id: "st-innetwork", label: "In-Network", action_bucket: "complete" },
  { id: "st-oon", label: "OON", action_bucket: "complete" },
];

function caseRow(
  id: string,
  payerName: string | null,
  state: string,
  statusId: string | null,
  submitted: string | null = null,
) {
  return {
    id,
    state,
    submitted_date: submitted,
    credentialing_status_id: statusId,
    payers: payerName == null ? null : { name: payerName },
  };
}

describe("listOpenProviderCases — org isolation", () => {
  it("returns null (the route's 404) for a provider outside the org, before reading cases", async () => {
    const { db, captures } = makeFakeDb([{ data: null }]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toBeNull();
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("providers");
    expect(captures[0].filters).toContainEqual(["id", PROVIDER_ID]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
  });

  it("org-scopes every query it makes", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [] },
    ]);

    await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(captures.map((c) => c.table)).toEqual([
      "providers",
      "status_configs",
      "credential_cases",
    ]);
    for (const cap of captures) {
      expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    }
    const caseCap = captures[2];
    expect(caseCap.filters).toContainEqual(["provider_id", PROVIDER_ID]);
    // Explicit projection, never select('*').
    expect(caseCap.selectCols).not.toContain("*");
  });
});

describe("listOpenProviderCases — open/terminal derivation from status config", () => {
  it("drops cases whose status is in the 'complete' bucket, keeps the rest", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      {
        data: [
          caseRow("c-open", "Aetna", "KS", "st-open"),
          caseRow("c-submitted", "BCBS", "KS", "st-submitted", "2026-06-01"),
          caseRow("c-done", "Cigna", "KS", "st-innetwork"),
          caseRow("c-oon", "Humana", "KS", "st-oon"),
        ],
      },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.map((r) => r.id)).toEqual(["c-open", "c-submitted"]);
    expect(result?.[1]).toEqual({
      id: "c-submitted",
      payerName: "BCBS",
      state: "KS",
      status: "Submitted",
      submittedDate: "2026-06-01",
    });
  });

  it("a case with no status is unclassified and stays open (status null)", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c-null", "Aetna", "MO", null)] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toEqual([
      { id: "c-null", payerName: "Aetna", state: "MO", status: null, submittedDate: null },
    ]);
  });

  it("a case pointing at an unknown status id stays open rather than silently dropping", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c-ghost", "Aetna", "KS", "st-deleted")] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.map((r) => r.id)).toEqual(["c-ghost"]);
    expect(result?.[0].status).toBeNull();
  });

  it("a provider with only terminal cases returns an empty list, not null", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c-done", "Cigna", "KS", "st-innetwork")] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toEqual([]);
  });
});

describe("listOpenProviderCases — dropdown ordering", () => {
  it("sorts by payer name then state, nameless payers last", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      {
        data: [
          caseRow("c-noname", null, "KS", "st-open"),
          caseRow("c-bcbs-mo", "BCBS", "MO", "st-open"),
          caseRow("c-aetna", "Aetna", "KS", "st-open"),
          caseRow("c-bcbs-ks", "BCBS", "KS", "st-open"),
        ],
      },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.map((r) => r.id)).toEqual(["c-aetna", "c-bcbs-ks", "c-bcbs-mo", "c-noname"]);
  });
});

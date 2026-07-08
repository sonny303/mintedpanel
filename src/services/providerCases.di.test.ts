import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { listOpenProviderCases, type ProviderCasesServiceCtx } from "./providerCases";

// Minimal chainable fake of the supabase-js query builder — enough for the
// provider-cases shapes (org-scoped maybeSingle lookup, filtered selects, the
// touchlog .in().order() read, and the profiles .in() author resolution).
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
        in(col: string, vals: unknown) {
          cap.filters.push([col, vals]);
          return builder;
        },
        order() {
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
  payerReferenceId: string | null = null,
) {
  return {
    id,
    state,
    submitted_date: submitted,
    payer_reference_id: payerReferenceId,
    credentialing_status_id: statusId,
    payers: payerName == null ? null : { name: payerName },
  };
}

// No touchlog entries for the open cases — the common shape in these tests.
const NO_TOUCHES = { data: [] };

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
      { data: [caseRow("c-open", "Aetna", "KS", "st-open")] },
      NO_TOUCHES,
      { data: [] },
    ]);

    await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    // providers, status_configs, credential_cases, then the touchlog + tasks
    // reads (only when there are open cases).
    expect(captures.map((c) => c.table)).toEqual([
      "providers",
      "status_configs",
      "credential_cases",
      "touches",
      "tasks",
    ]);
    for (const cap of captures) {
      expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    }
    const caseCap = captures[2];
    expect(caseCap.filters).toContainEqual(["provider_id", PROVIDER_ID]);
    // Explicit projection, never select('*').
    expect(caseCap.selectCols).not.toContain("*");
    // The touchlog + tasks reads are both scoped to the open case ids.
    expect(captures[3].filters).toContainEqual(["case_id", ["c-open"]]);
    expect(captures[4].filters).toContainEqual(["case_id", ["c-open"]]);
    expect(captures[4].selectCols).not.toContain("*");
  });

  it("makes no touchlog read when there are no open cases", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toEqual([]);
    expect(captures.map((c) => c.table)).toEqual([
      "providers",
      "status_configs",
      "credential_cases",
    ]);
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
      NO_TOUCHES,
      { data: [] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.map((r) => r.id)).toEqual(["c-open", "c-submitted"]);
    expect(result?.[1]).toEqual({
      id: "c-submitted",
      payerName: "BCBS",
      state: "KS",
      status: "Submitted",
      submittedDate: "2026-06-01",
      payerReferenceId: null,
      latestNote: null,
      lastSubmittedAt: null,
      portalTasks: [],
    });
  });

  it("a case with no status is unclassified and stays open (status null)", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c-null", "Aetna", "MO", null)] },
      NO_TOUCHES,
      { data: [] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toEqual([
      {
        id: "c-null",
        payerName: "Aetna",
        state: "MO",
        status: null,
        submittedDate: null,
        payerReferenceId: null,
        latestNote: null,
        lastSubmittedAt: null,
        portalTasks: [],
      },
    ]);
  });

  it("a case pointing at an unknown status id stays open rather than silently dropping", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c-ghost", "Aetna", "KS", "st-deleted")] },
      NO_TOUCHES,
      { data: [] },
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

describe("listOpenProviderCases — PR C prefill/guard fields", () => {
  it("exposes payerReferenceId, latest note (author-resolved), and last submission", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c1", "Aetna", "KS", "st-open", null, "REF-42")] },
      {
        // newest-first, mixed entry types
        data: [
          {
            case_id: "c1",
            entry_type: "note",
            outcome: null,
            notes: "call the rep tomorrow",
            coordinator_id: "user-9",
            created_at: "2026-07-06T10:00:00Z",
          },
          {
            case_id: "c1",
            entry_type: "touchpoint",
            outcome: "submitted",
            notes: "Application submitted via Availity",
            coordinator_id: "user-9",
            created_at: "2026-07-05T09:00:00Z",
          },
          {
            case_id: "c1",
            entry_type: "note",
            outcome: null,
            notes: "older note, ignored",
            coordinator_id: "user-9",
            created_at: "2026-07-01T09:00:00Z",
          },
        ],
      },
      { data: [] },
      { data: [{ id: "user-9", full_name: "Nadia Rep", email: "nadia@x.test" }] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toEqual([
      {
        id: "c1",
        payerName: "Aetna",
        state: "KS",
        status: "In Progress",
        submittedDate: null,
        payerReferenceId: "REF-42",
        latestNote: {
          text: "call the rep tomorrow",
          author: "Nadia Rep",
          at: "2026-07-06T10:00:00Z",
        },
        lastSubmittedAt: "2026-07-05T09:00:00Z",
        portalTasks: [],
      },
    ]);
    // The profiles author lookup is org-agnostic by id but only runs when a
    // note has an author.
    expect(captures.map((c) => c.table)).toContain("profiles");
  });

  it("falls back to email when the author has no full_name, and skips the profiles read when no note has an author", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c1", "Aetna", "KS", "st-open")] },
      {
        data: [
          {
            case_id: "c1",
            entry_type: "system_event",
            outcome: null,
            notes: "Form submitted to Aetna",
            coordinator_id: null,
            created_at: "2026-07-06T10:00:00Z",
          },
        ],
      },
      { data: [] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    // A system_event is neither a note nor a submitted touchpoint.
    expect(result?.[0].latestNote).toBeNull();
    expect(result?.[0].lastSubmittedAt).toBeNull();
    expect(result?.[0].portalTasks).toEqual([]);
    expect(captures.map((c) => c.table)).not.toContain("profiles");
  });
});

describe("listOpenProviderCases — portalTasks (Phase 4)", () => {
  function taskRow(
    id: string,
    caseId: string | null,
    title: string,
    status: string,
    steps: unknown[],
  ) {
    return { id, case_id: caseId, title, status, sop_content: steps };
  }

  it("surfaces a non-completed task's distinct portal keys as portalTasks", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c1", "Aetna", "KS", "st-open")] },
      NO_TOUCHES,
      {
        data: [
          taskRow("t1", "c1", "Enroll on Availity", "in_progress", [
            { label: "s", stepType: "online_form", portalKey: "availity" },
            { label: "s2", stepType: "draft_email" },
          ]),
        ],
      },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.[0].portalTasks).toEqual([
      { taskId: "t1", title: "Enroll on Availity", portalKey: "availity", status: "in_progress" },
    ]);
  });

  it("excludes completed tasks and steps with no portalKey; normalizes + dedupes keys", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c1", "Aetna", "KS", "st-open")] },
      NO_TOUCHES,
      {
        data: [
          // Completed task is skipped entirely.
          taskRow("t-done", "c1", "Done", "completed", [{ portalKey: "availity" }]),
          // Two steps, same key (cased/spaced) → one deduped entry; a keyless
          // step contributes nothing.
          taskRow("t1", "c1", "Two steps", "not_started", [
            { portalKey: " Availity " },
            { portalKey: "availity" },
            { label: "no portal" },
          ]),
          // Two distinct keys on one task → two entries.
          taskRow("t2", "c1", "Multi", "in_progress", [
            { portalKey: "caqh" },
            { portalKey: "pecos" },
          ]),
        ],
      },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.[0].portalTasks).toEqual([
      { taskId: "t1", title: "Two steps", portalKey: "availity", status: "not_started" },
      { taskId: "t2", title: "Multi", portalKey: "caqh", status: "in_progress" },
      { taskId: "t2", title: "Multi", portalKey: "pecos", status: "in_progress" },
    ]);
  });

  it("returns an empty portalTasks when a case has no portal-linked tasks", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: STATUSES },
      { data: [caseRow("c1", "Aetna", "KS", "st-open")] },
      NO_TOUCHES,
      { data: [taskRow("t1", "c1", "Call payer", "in_progress", [{ label: "phone them" }])] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.[0].portalTasks).toEqual([]);
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
      NO_TOUCHES,
      { data: [] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.map((r) => r.id)).toEqual(["c-aetna", "c-bcbs-ks", "c-bcbs-mo", "c-noname"]);
  });
});

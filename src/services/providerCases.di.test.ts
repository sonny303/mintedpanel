import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  listOpenProviderCases,
  searchOrgCases,
  type ProviderCasesServiceCtx,
} from "./providerCases";

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

function caseRow(
  id: string,
  payerName: string | null,
  state: string,
  caseStatus: string | null,
  submitted: string | null = null,
  payerReferenceId: string | null = null,
) {
  return {
    id,
    state,
    submitted_date: submitted,
    payer_reference_id: payerReferenceId,
    case_status: caseStatus,
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
      { data: [caseRow("c-open", "Aetna", "KS", "in_progress")] },
      NO_TOUCHES,
      { data: [] },
    ]);

    await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    // providers, credential_cases, then touchlog + tasks (when open cases exist).
    // No status_configs read — open/closed is E6.0 case_status.
    expect(captures.map((c) => c.table)).toEqual([
      "providers",
      "credential_cases",
      "touches",
      "tasks",
    ]);
    for (const cap of captures) {
      expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    }
    const caseCap = captures[1];
    expect(caseCap.filters).toContainEqual(["provider_id", PROVIDER_ID]);
    expect(caseCap.selectCols).toContain("case_status");
    expect(caseCap.selectCols).not.toContain("credentialing_status_id");
    expect(caseCap.selectCols).not.toContain("*");
    expect(captures[2].filters).toContainEqual(["case_id", ["c-open"]]);
    expect(captures[3].filters).toContainEqual(["case_id", ["c-open"]]);
  });

  it("makes no touchlog read when there are no open cases", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: [] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toEqual([]);
    expect(captures.map((c) => c.table)).toEqual(["providers", "credential_cases"]);
  });
});

describe("listOpenProviderCases — open/terminal derivation from case_status", () => {
  it("keeps open spine statuses and drops terminals (approved/denied/not_pursuing)", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      {
        data: [
          caseRow("c-open", "Aetna", "KS", "in_progress"),
          caseRow("c-submitted", "BCBS", "KS", "submitted", "2026-06-01"),
          caseRow("c-approved", "Cigna", "KS", "approved"),
          caseRow("c-denied", "Humana", "KS", "denied"),
          caseRow("c-np", "UHC", "KS", "not_pursuing"),
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

  it("a case with null case_status stays open (status null)", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
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

  it("a case with an unknown case_status stays open rather than silently dropping", async () => {
    const { db } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: [caseRow("c-ghost", "Aetna", "KS", "legacy_bucket")] },
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
      { data: [caseRow("c-done", "Cigna", "KS", "approved")] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toEqual([]);
  });
});

describe("listOpenProviderCases — PR C prefill/guard fields", () => {
  it("exposes payerReferenceId, latest note (author-resolved), and last submission", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: [caseRow("c1", "Aetna", "KS", "in_progress", null, "REF-42")] },
      {
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
    expect(captures.map((c) => c.table)).toContain("profiles");
  });

  it("falls back to email when the author has no full_name, and skips the profiles read when no note has an author", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: [caseRow("c1", "Aetna", "KS", "in_progress")] },
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
      { data: [caseRow("c1", "Aetna", "KS", "in_progress")] },
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
      { data: [caseRow("c1", "Aetna", "KS", "in_progress")] },
      NO_TOUCHES,
      {
        data: [
          taskRow("t-done", "c1", "Done", "completed", [{ portalKey: "availity" }]),
          taskRow("t1", "c1", "Two steps", "not_started", [
            { portalKey: " Availity " },
            { portalKey: "availity" },
            { label: "no portal" },
          ]),
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
      { data: [caseRow("c1", "Aetna", "KS", "in_progress")] },
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
      {
        data: [
          caseRow("c-noname", null, "KS", "in_progress"),
          caseRow("c-bcbs-mo", "BCBS", "MO", "in_progress"),
          caseRow("c-aetna", "Aetna", "KS", "in_progress"),
          caseRow("c-bcbs-ks", "BCBS", "KS", "in_progress"),
        ],
      },
      NO_TOUCHES,
      { data: [] },
    ]);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result?.map((r) => r.id)).toEqual(["c-aetna", "c-bcbs-ks", "c-bcbs-mo", "c-noname"]);
  });
});

describe("searchOrgCases — E4.3 TE-11 case search", () => {
  const searchCaseRow = (over: Record<string, unknown> = {}) => ({
    id: "c1",
    state: "KS",
    provider_id: "p1",
    payer_reference_id: null,
    case_status: "in_progress",
    payer_pipeline_state: "drafting",
    providers: { id: "p1", first_name: "Brooke", last_name: "Ostrander" },
    payers: { name: "BCBS of Kansas" },
    ...over,
  });

  it("returns [] for a blank query without any DB read", async () => {
    const { db, captures } = makeFakeDb([]);
    const result = await searchOrgCases(ctxWith(db), "   ");
    expect(result).toEqual([]);
    expect(captures).toHaveLength(0);
  });

  it("org-scopes the case read (no status_configs)", async () => {
    const { db, captures } = makeFakeDb([{ data: [searchCaseRow()] }]);
    await searchOrgCases(ctxWith(db), "brooke");
    expect(captures.map((c) => c.table)).toEqual(["credential_cases"]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures[0].selectCols).toContain("case_status");
  });

  it("matches on provider name, payer name, and tracking id (case-insensitive), mapping display fields", async () => {
    const rows = [
      searchCaseRow({ id: "c1" }),
      searchCaseRow({
        id: "c2",
        providers: { id: "p2", first_name: "Stan", last_name: "Marsh" },
        payers: { name: "Humana" },
        payer_reference_id: "REF-BROOKE-9",
      }),
      searchCaseRow({
        id: "c3",
        providers: { id: "p3", first_name: "Kyle", last_name: "Broflovski" },
        payers: { name: "Aetna" },
      }),
    ];
    const { db } = makeFakeDb([{ data: rows }]);

    const result = await searchOrgCases(ctxWith(db), "BROOKE");
    expect(result.map((r) => r.id).sort()).toEqual(["c1", "c2"]);
    const c1 = result.find((r) => r.id === "c1");
    expect(c1).toMatchObject({
      providerName: "Brooke Ostrander",
      payerName: "BCBS of Kansas",
      state: "KS",
      status: "In Progress",
      payerPipelineState: "drafting",
    });
  });

  it("resolves the case_status label and defaults pipeline to not_started", async () => {
    const { db } = makeFakeDb([
      {
        data: [searchCaseRow({ case_status: null, payer_pipeline_state: null })],
      },
    ]);
    const result = await searchOrgCases(ctxWith(db), "brooke");
    expect(result[0].status).toBeNull();
    expect(result[0].payerPipelineState).toBe("not_started");
  });
});

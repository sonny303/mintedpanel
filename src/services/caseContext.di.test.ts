import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { getCaseContext, type CaseContextServiceCtx } from "./caseContext";

// Minimal chainable fake of the supabase-js query builder — enough for the
// case-context shapes (org-scoped maybeSingle case lookup, the touchlog
// .eq().order() read, and the profiles maybeSingle author resolution). Records
// table, select columns, and filters; results consume in call order, which is
// deterministic in getCaseContext.
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

function ctxWith(db: SupabaseClient<Database>): CaseContextServiceCtx {
  return { db, orgId: "org-1" };
}

const CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function noteEntry(notes: string, coordinatorId: string | null, createdAt: string) {
  return {
    entry_type: "note",
    touch_type: null,
    outcome: null,
    touch_date: createdAt.slice(0, 10),
    notes,
    coordinator_id: coordinatorId,
    created_at: createdAt,
  };
}

function touchpointEntry(
  touchType: string,
  outcome: string,
  notes: string | null,
  createdAt: string,
) {
  return {
    entry_type: "touchpoint",
    touch_type: touchType,
    outcome,
    touch_date: createdAt.slice(0, 10),
    notes,
    coordinator_id: "user-9",
    created_at: createdAt,
  };
}

describe("getCaseContext — org isolation", () => {
  it("returns null (the route's 404) for a case outside the org, before any touchlog read", async () => {
    const { db, captures } = makeFakeDb([{ data: null }]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result).toBeNull();
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("credential_cases");
    expect(captures[0].filters).toContainEqual(["id", CASE_ID]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    // Explicit projection, never select('*').
    expect(captures[0].selectCols).not.toContain("*");
  });

  it("org-scopes the case AND touchlog reads", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID, payer_reference_id: null } },
      { data: [] },
    ]);

    await getCaseContext(ctxWith(db), CASE_ID);

    expect(captures.map((c) => c.table)).toEqual(["credential_cases", "touches"]);
    for (const cap of captures) {
      expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    }
    expect(captures[1].filters).toContainEqual(["case_id", CASE_ID]);
  });
});

describe("getCaseContext — projection", () => {
  it("surfaces the reference number, latest note (author-resolved), and latest touchpoint", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID, payer_reference_id: "REF-42", payer_pipeline_state: "submitted" } },
      {
        // newest-first, mixed entry types
        data: [
          noteEntry("call the rep tomorrow", "user-9", "2026-07-06T10:00:00Z"),
          touchpointEntry(
            "portal",
            "submitted",
            "Application submitted via Availity",
            "2026-07-05T09:00:00Z",
          ),
          noteEntry("older note, ignored", "user-9", "2026-07-01T09:00:00Z"),
        ],
      },
      { data: { full_name: "Nadia Rep", email: "nadia@x.test" } },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result).toEqual({
      referenceNumbers: ["REF-42"],
      payerPipelineState: "submitted",
      latestNote: {
        content: "call the rep tomorrow",
        createdAt: "2026-07-06T10:00:00Z",
        authorName: "Nadia Rep",
      },
      latestTouch: {
        touchDate: "2026-07-05",
        touchType: "portal",
        outcome: "submitted",
        note: "Application submitted via Availity",
      },
    });
    expect(captures.map((c) => c.table)).toContain("profiles");
  });

  it("empty reference + no touchlog entries -> empty array and null note/touch, no profiles read", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID, payer_reference_id: null, payer_pipeline_state: "not_started" } },
      { data: [] },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result).toEqual({
      referenceNumbers: [],
      payerPipelineState: "not_started",
      latestNote: null,
      latestTouch: null,
    });
    expect(captures.map((c) => c.table)).not.toContain("profiles");
  });

  it("falls back to email when the note author has no full_name", async () => {
    const { db } = makeFakeDb([
      { data: { id: CASE_ID, payer_reference_id: null } },
      { data: [noteEntry("note", "user-9", "2026-07-06T10:00:00Z")] },
      { data: { full_name: null, email: "nadia@x.test" } },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.latestNote?.authorName).toBe("nadia@x.test");
  });

  it("skips the profiles read (author stays null) when the latest note has no author", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID, payer_reference_id: null } },
      { data: [noteEntry("system-ish note", null, "2026-07-06T10:00:00Z")] },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.latestNote).toEqual({
      content: "system-ish note",
      createdAt: "2026-07-06T10:00:00Z",
      authorName: null,
    });
    expect(captures.map((c) => c.table)).not.toContain("profiles");
  });

  it("ignores system_event / task_update entries for both note and touch", async () => {
    const { db } = makeFakeDb([
      { data: { id: CASE_ID, payer_reference_id: null } },
      {
        data: [
          {
            entry_type: "system_event",
            touch_type: null,
            outcome: null,
            touch_date: "2026-07-06",
            notes: "Form submitted to Aetna",
            coordinator_id: "user-9",
            created_at: "2026-07-06T10:00:00Z",
          },
          {
            entry_type: "task_update",
            touch_type: null,
            outcome: null,
            touch_date: "2026-07-06",
            notes: "Task marked done",
            coordinator_id: "user-9",
            created_at: "2026-07-06T09:00:00Z",
          },
        ],
      },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.latestNote).toBeNull();
    expect(result?.latestTouch).toBeNull();
  });
});

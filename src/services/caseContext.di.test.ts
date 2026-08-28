import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { getCaseContext, type CaseContextServiceCtx } from "./caseContext";

// Minimal chainable fake of the supabase-js query builder — enough for the
// case-context shapes (org-scoped maybeSingle case lookup, the open-tasks
// .eq().eq().neq().order() read, the case_facilities read, the optional
// selectedFacility maybeSingle, the touchlog .eq().order() read, and the
// profiles maybeSingle author resolution). Records table, select columns, and
// filters; results consume in call order, which is deterministic in
// getCaseContext:
//   credential_cases -> tasks -> case_facilities -> [facilities] -> touches -> [profiles]
// case_facilities is UNCONDITIONAL (always the 3rd call) — unlike the
// selectedFacility `facilities` read, which only fires when facility_id is set.
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
        neq(col: string, val: unknown) {
          cap.filters.push([`neq:${col}`, val]);
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

// A case row as the FK-embedded read returns it.
function caseRow(over: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    state: "KS",
    payer_reference_id: null,
    payer_pipeline_state: "not_started",
    facility_id: null,
    providers: { id: "prov-1", first_name: "Kay", last_name: "One" },
    payers: { id: "pay-1", name: "BCBS of Kansas" },
    ...over,
  };
}

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
  it("returns null (the route's 404) for a case outside the org, before any further read", async () => {
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

  it("org-scopes the case, tasks, case_facilities, AND touchlog reads", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      { data: [] },
      { data: [] },
    ]);

    await getCaseContext(ctxWith(db), CASE_ID);

    expect(captures.map((c) => c.table)).toEqual([
      "credential_cases",
      "tasks",
      "case_facilities",
      "touches",
    ]);
    for (const cap of captures) {
      expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    }
    // tasks read is case-scoped and excludes completed tasks.
    expect(captures[1].filters).toContainEqual(["case_id", CASE_ID]);
    expect(captures[1].filters).toContainEqual(["neq:status", "completed"]);
    // case_facilities read is case-scoped, org-scoped on both the join row
    // and the joined facility (E1.4 — never a facility outside the org).
    expect(captures[2].filters).toContainEqual(["case_id", CASE_ID]);
    expect(captures[2].filters).toContainEqual(["facility.org_id", "org-1"]);
    expect(captures[3].filters).toContainEqual(["case_id", CASE_ID]);
  });
});

describe("getCaseContext — projection", () => {
  it("surfaces identity, open tasks with execution types, reference, latest note (author-resolved), and latest touchpoint", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow({ payer_reference_id: "REF-42", payer_pipeline_state: "submitted" }) },
      {
        data: [
          {
            id: "task-1",
            title: "Enroll on BCBS portal",
            status: "in_progress",
            execution_type: "extension_fill",
            sort_order: 1,
            due_date: null,
          },
          {
            id: "task-2",
            title: "Verify roster",
            status: "in_progress",
            execution_type: null, // null ⇒ manual
            sort_order: 2,
            due_date: "2026-07-20",
          },
        ],
      },
      {
        // E1.4 — deliberately out of order (non-primary first, alphabetically
        // later) so the assertion below proves the primary-first-then-name
        // sort, not just pass-through.
        data: [
          {
            is_primary: false,
            facility: {
              id: "fac-2",
              name: "Zebra Annex",
              street: "9 Oak St",
              suite: null,
              city: "Wichita",
              state: "KS",
              zip: "67203",
            },
          },
          {
            is_primary: true,
            facility: {
              id: "fac-1",
              name: "Main Clinic",
              street: "100 Main St",
              suite: null,
              city: "Wichita",
              state: "KS",
              zip: "67202",
            },
          },
        ],
      },
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
      provider: { id: "prov-1", name: "Kay One" },
      payer: { id: "pay-1", name: "BCBS of Kansas" },
      state: "KS",
      selectedFacility: null,
      // E1.4 — primary first, then alphabetical: proves the sort, not just
      // pass-through of the fixture's (deliberately reversed) order.
      facilities: [
        {
          id: "fac-1",
          name: "Main Clinic",
          street: "100 Main St",
          suite: null,
          city: "Wichita",
          state: "KS",
          zip: "67202",
          isPrimary: true,
        },
        {
          id: "fac-2",
          name: "Zebra Annex",
          street: "9 Oak St",
          suite: null,
          city: "Wichita",
          state: "KS",
          zip: "67203",
          isPrimary: false,
        },
      ],
      openTasks: [
        {
          id: "task-1",
          title: "Enroll on BCBS portal",
          status: "in_progress",
          executionType: "extension_fill",
          sortOrder: 1,
          dueDate: null,
          steps: [],
        },
        {
          id: "task-2",
          title: "Verify roster",
          status: "in_progress",
          executionType: "manual",
          sortOrder: 2,
          dueDate: "2026-07-20",
          steps: [],
        },
      ],
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

  it("hides a REMOVED payer-form task from openTasks", async () => {
    // The row stays as `blocked` for the audit trail, and `blocked` counts as
    // open (the query only excludes `completed`) — so without the filter the
    // extension would be handed a task for a form that is no longer part of
    // the case.
    const { db } = makeFakeDb([
      { data: caseRow() },
      {
        data: [
          {
            id: "task-1",
            title: "Enroll on BCBS portal",
            status: "in_progress",
            execution_type: "extension_fill",
            sort_order: 1,
            due_date: null,
          },
          {
            id: "task-2",
            title: "Send payer form",
            status: "blocked",
            execution_type: null,
            sort_order: 2,
            due_date: null,
            sop_content: [
              {
                id: "s1",
                label: "Send payer form",
                stepType: "pdf",
                payerForm: {
                  familyId: "fam-1",
                  formId: "f1",
                  label: "Supplement",
                  fileName: "s.pdf",
                  removedAt: "2026-08-24T10:00:00Z",
                },
              },
            ],
          },
        ],
      },
      { data: [] }, // case_facilities
      { data: [] }, // touches
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.openTasks.map((t) => t.id)).toEqual(["task-1"]);
  });

  it("keeps a payer-form task that has NOT been removed", async () => {
    const { db } = makeFakeDb([
      { data: caseRow() },
      {
        data: [
          {
            id: "task-2",
            title: "Send payer form",
            status: "not_started",
            execution_type: null,
            sort_order: 2,
            due_date: null,
            sop_content: [
              {
                id: "s1",
                label: "Send payer form",
                stepType: "pdf",
                payerForm: {
                  familyId: "fam-1",
                  formId: "f1",
                  label: "Supplement",
                  fileName: "s.pdf",
                },
              },
            ],
          },
        ],
      },
      { data: [] }, // case_facilities
      { data: [] }, // touches
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.openTasks.map((t) => t.id)).toEqual(["task-2"]);
  });

  it("empty reference + no tasks/touchlog entries -> empty arrays and null note/touch, no profiles read", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      { data: [] }, // case_facilities
      { data: [] }, // touches
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result).toMatchObject({
      referenceNumbers: [],
      payerPipelineState: "not_started",
      openTasks: [],
      selectedFacility: null,
      facilities: [],
      latestNote: null,
      latestTouch: null,
    });
    expect(captures.map((c) => c.table)).not.toContain("profiles");
  });

  it("falls back to email when the note author has no full_name", async () => {
    const { db } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      { data: [] }, // case_facilities
      { data: [noteEntry("note", "user-9", "2026-07-06T10:00:00Z")] },
      { data: { full_name: null, email: "nadia@x.test" } },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.latestNote?.authorName).toBe("nadia@x.test");
  });

  it("skips the profiles read (author stays null) when the latest note has no author", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      { data: [] }, // case_facilities
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

  it("resolves the case-selected facility with its complete nullable address", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow({ facility_id: "fac-1" }) },
      { data: [] },
      { data: [] }, // case_facilities
      {
        data: {
          id: "fac-1",
          name: "Main Clinic",
          street: "100 Main St",
          suite: null,
          city: "Wichita",
          state: "KS",
          zip: "67202",
        },
      },
      { data: [] }, // touches
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.selectedFacility).toEqual({
      id: "fac-1",
      name: "Main Clinic",
      street: "100 Main St",
      suite: null,
      city: "Wichita",
      state: "KS",
      zip: "67202",
    });
    // The facility read is org-scoped, keyed by the case's facility_id, and an
    // explicit projection — never select('*').
    const facilityCap = captures.find((c) => c.table === "facilities");
    expect(facilityCap).toBeDefined();
    expect(facilityCap?.filters).toContainEqual(["id", "fac-1"]);
    expect(facilityCap?.filters).toContainEqual(["org_id", "org-1"]);
    expect(facilityCap?.selectCols).toBe("id, name, street, suite, city, state, zip");
  });

  it("excludes a facility that does not resolve inside the org (cross-org facility_id -> explicit null)", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow({ facility_id: "fac-other-org" }) },
      { data: [] },
      { data: [] }, // case_facilities
      { data: null },
      { data: [] }, // touches
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.selectedFacility).toBeNull();
    const facilityCap = captures.find((c) => c.table === "facilities");
    expect(facilityCap?.filters).toContainEqual(["org_id", "org-1"]);
  });

  it("never consults the provider's facility set: no facility link means an explicit null, no facility read", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow({ facility_id: null }) },
      { data: [] },
      { data: [] }, // case_facilities
      { data: [] }, // touches
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    // Explicit, never guessed: the key is present and null, and the
    // selectedFacility `facilities` table was never read (case_facilities is
    // unconditional and IS read; only the selectedFacility lookup is skipped).
    expect(result).toHaveProperty("selectedFacility", null);
    expect(captures.map((c) => c.table)).toEqual([
      "credential_cases",
      "tasks",
      "case_facilities",
      "touches",
    ]);
  });

  it("ignores system_event / task_update entries for both note and touch", async () => {
    const { db } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      { data: [] }, // case_facilities
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

describe("getCaseContext — facilities[] (E1.4)", () => {
  it("is org-scoped on BOTH the join row and the joined facility", async () => {
    const { db, captures } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      { data: [] }, // case_facilities
      { data: [] }, // touches
    ]);

    await getCaseContext(ctxWith(db), CASE_ID);

    const cap = captures.find((c) => c.table === "case_facilities");
    expect(cap).toBeDefined();
    expect(cap?.filters).toContainEqual(["case_id", CASE_ID]);
    expect(cap?.filters).toContainEqual(["org_id", "org-1"]);
    // The embedded facility carries its own org filter — a facility outside
    // the caller's org can never ride along on a leaked/mis-scoped join row.
    expect(cap?.filters).toContainEqual(["facility.org_id", "org-1"]);
    expect(cap?.selectCols).not.toContain("*");
  });

  it("drops a row whose embedded facility didn't resolve (defensive — the !inner join should already exclude it)", async () => {
    const { db } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      {
        data: [
          { is_primary: true, facility: null },
          {
            is_primary: false,
            facility: {
              id: "fac-1",
              name: "Main Clinic",
              street: null,
              suite: null,
              city: null,
              state: null,
              zip: null,
            },
          },
        ],
      },
      { data: [] },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.facilities.map((f) => f.id)).toEqual(["fac-1"]);
  });

  it("treats a missing/non-true is_primary as not primary", async () => {
    const { db } = makeFakeDb([
      { data: caseRow() },
      { data: [] },
      {
        data: [
          {
            is_primary: undefined,
            facility: {
              id: "fac-1",
              name: "Main Clinic",
              street: null,
              suite: null,
              city: null,
              state: null,
              zip: null,
            },
          },
        ],
      },
      { data: [] },
    ]);

    const result = await getCaseContext(ctxWith(db), CASE_ID);

    expect(result?.facilities).toEqual([
      {
        id: "fac-1",
        name: "Main Clinic",
        street: null,
        suite: null,
        city: null,
        state: null,
        zip: null,
        isPrimary: false,
      },
    ]);
  });
});

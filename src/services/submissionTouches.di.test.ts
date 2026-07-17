import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  portalKeyLabel,
  recordSubmissionTouch,
  type RecordSubmissionTouchResult,
  type SubmissionTouchInput,
  type SubmissionTouchServiceCtx,
} from "./submissionTouches";

// Minimal chainable fake of the supabase-js query builder — same pattern as
// fillSessions.di.test.ts. Results consume in call order (via maybeSingle /
// single) which is deterministic in recordSubmissionTouch. Bare inserts with no
// .select().single() (the note/system_event/task_update entries) resolve to the
// builder itself, so `{ error }` is undefined and they consume no result.
interface Captured {
  table?: string;
  op: "select" | "insert" | "update";
  selectCols?: string;
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const db = {
    from(table: string) {
      const cap: Captured = { table, op: "select", filters: [] };
      captures.push(cap);
      const builder: Record<string, unknown> = {
        select(cols: string) {
          cap.selectCols = cols;
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          cap.op = "insert";
          cap.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          cap.op = "update";
          cap.payload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          cap.filters.push([col, val]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(take()),
        single: () => Promise.resolve(take()),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

function ctxWith(db: SupabaseClient<Database>, writeAudit = vi.fn().mockResolvedValue(undefined)) {
  const ctx: SubmissionTouchServiceCtx = { db, orgId: "org-1", userId: "user-1", writeAudit };
  return { ctx, writeAudit };
}

const TOUCH_ID = "11111111-2222-4333-8444-555555555555";
const CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FILL_SESSION_ID = "99999999-8888-4777-8666-121212121212";
const TASK_ID = "cccccccc-dddd-4eee-8fff-000000000000";

const baseInput: SubmissionTouchInput = {
  kind: "portal_submission",
  portal_key: "bcbs_ks_enrollment",
  idempotency_id: TOUCH_ID,
};

// The row the DB hands back from insert()/the idempotency lookup.
const storedRow = {
  id: TOUCH_ID,
  org_id: "org-1",
  case_id: CASE_ID,
  touch_date: "2026-07-05",
  entry_type: "touchpoint",
  touch_type: "portal",
  outcome: "submitted",
  next_follow_up_date: null,
  notes: "Application submitted via BCBS KS Enrollment",
  coordinator_id: "user-1",
  task_id: null,
  communication_event_id: null,
  source: "extension",
  created_at: "2026-07-05T00:00:00Z",
};

// Convenience: the entry-type of a captured touches insert.
function touchInserts(captures: Captured[]) {
  return captures.filter((c) => c.table === "touches" && c.op === "insert");
}

function expectRejected(result: RecordSubmissionTouchResult, status: 404 | 409 | 422): void {
  expect(result.kind).toBe("rejected");
  if (result.kind !== "rejected") throw new Error("expected a rejected result");
  expect(result.status).toBe(status);
}

describe("portalKeyLabel", () => {
  it.each([
    ["bcbs_ks_enrollment", "BCBS KS Enrollment"],
    ["availity", "Availity"],
    ["sp_test_portal", "SP TEST Portal"],
  ])("%s -> %s", (key, label) => {
    expect(portalKeyLabel(key)).toBe(label);
  });
});

describe("recordSubmissionTouch — shape validation rejects before any DB call", () => {
  const cases: Array<[string, string, SubmissionTouchInput, 404 | 422]> = [
    ["non-UUID case id", "not-a-case", baseInput, 404],
    ["wrong kind", CASE_ID, { ...baseInput, kind: "status_change" }, 422],
    ["missing kind", CASE_ID, { ...baseInput, kind: undefined as never }, 422],
    ["non-UUID idempotency_id", CASE_ID, { ...baseInput, idempotency_id: "nope" }, 422],
    ["blank portal_key", CASE_ID, { ...baseInput, portal_key: "  " }, 422],
    ["non-UUID fill_session_id", CASE_ID, { ...baseInput, fill_session_id: "fs-1" }, 422],
    ["non-string note", CASE_ID, { ...baseInput, note: 42 as never }, 422],
    [
      "non-string payer_reference_id",
      CASE_ID,
      { ...baseInput, payer_reference_id: 42 as never },
      422,
    ],
    ["non-string wip_note", CASE_ID, { ...baseInput, wip_note: 42 as never }, 422],
    ["non-UUID task_id", CASE_ID, { ...baseInput, task_id: "task-1" }, 422],
    ["non-string pdf_filename", CASE_ID, { ...baseInput, pdf_filename: 42 as never }, 422],
  ];

  it.each(cases)("%s rejects with zero queries", async (_name, caseId, input, status) => {
    const { db, captures } = makeFakeDb([]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, caseId, input);

    expectRejected(result, status);
    expect(captures).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("recordSubmissionTouch — org validation rejects before any write", () => {
  it("a case outside the org is a 404 and nothing is ever inserted", async () => {
    const { db, captures } = makeFakeDb([{ data: null }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, baseInput);

    expectRejected(result, 404);
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("credential_cases");
    expect(captures[0].op).toBe("select");
    expect(captures[0].filters).toContainEqual(["id", CASE_ID]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a fill session outside the org is a 404 and nothing is ever inserted", async () => {
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: null }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, {
      ...baseInput,
      fill_session_id: FILL_SESSION_ID,
    });

    expectRejected(result, 404);
    expect(captures).toHaveLength(2);
    expect(captures[1].table).toBe("fill_sessions");
    expect(captures[1].filters).toContainEqual(["id", FILL_SESSION_ID]);
    expect(captures[1].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a task outside the org is a 404 before any write (isolation gate assertion 13)", async () => {
    // case lookup ok, task lookup miss (cross-org) -> 404 before idempotency.
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: null }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, { ...baseInput, task_id: TASK_ID });

    expectRejected(result, 404);
    expect(captures.map((c) => c.table)).toEqual(["credential_cases", "tasks"]);
    expect(captures[1].filters).toContainEqual(["id", TASK_ID]);
    expect(captures[1].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert" || c.op === "update")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("recordSubmissionTouch — happy path (R2 core)", () => {
  it("inserts the anchor touchpoint with identity from ctx even when the body smuggles it", async () => {
    // Sequence: case lookup, idempotency lookup (miss), anchor insert.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const body = {
      ...baseInput,
      org_id: "org-EVIL",
      coordinator_id: "intruder",
    } as SubmissionTouchInput;
    const result = await recordSubmissionTouch(ctx, CASE_ID, body);

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected a created result");
    expect(result.touch.orgId).toBe("org-1");
    expect(result.touch.source).toBe("extension");

    const anchor = touchInserts(captures)[0];
    expect(anchor?.payload).toMatchObject({
      id: TOUCH_ID,
      org_id: "org-1",
      case_id: CASE_ID,
      entry_type: "touchpoint",
      touch_type: "portal",
      outcome: "submitted",
      coordinator_id: "user-1",
      source: "extension",
      notes: "Application submitted via BCBS KS Enrollment",
    });
    expect(anchor?.payload?.touch_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(anchor?.payload)).not.toContain("org-EVIL");
    expect(JSON.stringify(anchor?.payload)).not.toContain("intruder");

    // No task_id / payer ref / wip note / pdf -> only the TOUCH_LOGGED audit.
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "TOUCH_LOGGED",
        entityType: "touch",
        entityId: TOUCH_ID,
        after: expect.objectContaining({
          caseId: CASE_ID,
          portalKey: "bcbs_ks_enrollment",
          fillSessionId: null,
          taskId: null,
          source: "extension",
        }),
      }),
    );
    // No task write, and the case is only ever read (no payer-ref update here).
    expect(captures.every((c) => c.table !== "tasks")).toBe(true);
    expect(
      captures.filter((c) => c.table === "credential_cases").every((c) => c.op === "select"),
    ).toBe(true);
  });

  it("always writes a 'Form submitted to {payer}' system_event, payer name from the case", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID, payers: { name: "Aetna" } } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, baseInput);

    const inserts = touchInserts(captures);
    const sysEvent = inserts.find((c) => c.payload?.entry_type === "system_event");
    expect(sysEvent?.payload).toMatchObject({
      org_id: "org-1",
      case_id: CASE_ID,
      entry_type: "system_event",
      notes: "Form submitted to Aetna",
      source: "extension",
    });
  });

  it("falls back to the portal label when the case has no payer name", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, baseInput);

    const sysEvent = touchInserts(captures).find((c) => c.payload?.entry_type === "system_event");
    expect(sysEvent?.payload?.notes).toBe("Form submitted to BCBS KS Enrollment");
  });

  it("appends the optional note to the touch text and records fill_session_id in the audit", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: FILL_SESSION_ID } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, {
      ...baseInput,
      fill_session_id: FILL_SESSION_ID,
      note: "confirmation #12345",
    });

    const anchor = touchInserts(captures)[0];
    expect(anchor?.payload?.notes).toBe(
      "Application submitted via BCBS KS Enrollment — confirmation #12345",
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({ fillSessionId: FILL_SESSION_ID }),
      }),
    );
  });
});

describe("recordSubmissionTouch — Stories 5/6/7 write-back", () => {
  it("overwrites the payer reference (Story 5) and audits the case update", async () => {
    // case, idempotency(miss), payer-ref update, anchor insert.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: { id: CASE_ID } },
      { data: storedRow },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, { ...baseInput, payer_reference_id: "  REF-9  " });

    const refUpdate = captures.find((c) => c.table === "credential_cases" && c.op === "update");
    expect(refUpdate?.payload).toEqual({ payer_reference_id: "REF-9" });
    expect(refUpdate?.filters).toContainEqual(["org_id", "org-1"]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "case",
        entityId: CASE_ID,
        after: { payerReferenceId: "REF-9" },
      }),
    );
    // A whitespace-trimmed non-empty value writes; the TOUCH_LOGGED audit flags it.
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "TOUCH_LOGGED",
        after: expect.objectContaining({ payerReferenceSet: true }),
      }),
    );
  });

  it("a blank payer reference is a no-op (never clears the latest-wins value)", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, { ...baseInput, payer_reference_id: "   " });

    expect(captures.some((c) => c.table === "credential_cases" && c.op === "update")).toBe(false);
  });

  it("writes a task-linked note for the wip_note (Story 6)", async () => {
    // case, task lookup, idempotency(miss), anchor insert, task update.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: TASK_ID, status: "not_started" } },
      { data: null },
      { data: storedRow },
      { data: { id: TASK_ID } },
    ]);
    const { ctx } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, {
      ...baseInput,
      task_id: TASK_ID,
      wip_note: "left the CAQH section blank",
    });

    const note = touchInserts(captures).find((c) => c.payload?.entry_type === "note");
    expect(note?.payload).toMatchObject({
      entry_type: "note",
      case_id: CASE_ID,
      task_id: TASK_ID,
      notes: "left the CAQH section blank",
      source: "extension",
    });
  });

  it("closes the linked task and records a task_update (Story 7), auditing the task", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID, payers: { name: "Cigna" } } },
      { data: { id: TASK_ID, status: "not_started" } },
      { data: null },
      { data: storedRow },
      { data: { id: TASK_ID } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, {
      ...baseInput,
      task_id: TASK_ID,
      pdf_filename: "aetna_app.pdf",
    });

    // Task marked completed.
    const taskUpdate = captures.find((c) => c.table === "tasks" && c.op === "update");
    expect(taskUpdate?.payload).toMatchObject({ status: "completed" });
    expect(taskUpdate?.filters).toContainEqual(["id", TASK_ID]);
    expect(taskUpdate?.filters).toContainEqual(["org_id", "org-1"]);

    // task_update entry references the task.
    const taskEntry = touchInserts(captures).find((c) => c.payload?.entry_type === "task_update");
    expect(taskEntry?.payload).toMatchObject({ entry_type: "task_update", task_id: TASK_ID });
    expect(String(taskEntry?.payload?.notes)).toContain(TASK_ID);

    // PDF -> a second system_event.
    const sysEvents = touchInserts(captures).filter(
      (c) => c.payload?.entry_type === "system_event",
    );
    expect(sysEvents.map((c) => c.payload?.notes)).toEqual(
      expect.arrayContaining(["Form submitted to Cigna", "PDF attached: aetna_app.pdf"]),
    );

    // Audits: task UPDATE + the TOUCH_LOGGED (payer already set? no -> just these two).
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "task",
        entityId: TASK_ID,
        before: { status: "not_started" },
        after: { status: "completed" },
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "TOUCH_LOGGED",
        after: expect.objectContaining({ taskId: TASK_ID, pdfAttached: true }),
      }),
    );
  });

  it("leaves an already-completed task alone (no task_update, no task audit)", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: TASK_ID, status: "completed" } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    await recordSubmissionTouch(ctx, CASE_ID, { ...baseInput, task_id: TASK_ID });

    expect(captures.some((c) => c.table === "tasks" && c.op === "update")).toBe(false);
    expect(touchInserts(captures).some((c) => c.payload?.entry_type === "task_update")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalledWith(expect.objectContaining({ entityType: "task" }));
  });
});

describe("recordSubmissionTouch — idempotency", () => {
  it("a replayed idempotency_id returns the stored row without inserting or auditing", async () => {
    // Sequence: case lookup, idempotency lookup (hit).
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: storedRow }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, baseInput);

    expect(result.kind).toBe("duplicate");
    if (result.kind !== "duplicate") throw new Error("expected a duplicate result");
    expect(result.touch).toMatchObject({ id: TOUCH_ID, caseId: CASE_ID, outcome: "submitted" });

    const lookup = captures.find((c) => c.table === "touches");
    expect(lookup?.op).toBe("select");
    expect(lookup?.filters).toContainEqual(["id", TOUCH_ID]);
    expect(lookup?.filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a same-org insert race resolves to the stored row, not a 409", async () => {
    // Sequence: case lookup, idempotency lookup (miss), anchor insert fails
    // 23505, post-conflict lookup finds the winner's row.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: null, error: { code: "23505", message: "duplicate key value" } },
      { data: storedRow },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, baseInput);

    expect(result.kind).toBe("duplicate");
    expect(captures.filter((c) => c.table === "touches" && c.op === "select")).toHaveLength(2);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a 23505 whose row is invisible org-scoped (id used by another org) is a 409", async () => {
    const { db } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: null, error: { code: "23505", message: "duplicate key value" } },
      { data: null },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, baseInput);

    expectRejected(result, 409);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("recordSubmissionTouch — kind 'structured_touch' (E4.3 TE-5)", () => {
  const structuredBase: SubmissionTouchInput = {
    kind: "structured_touch",
    idempotency_id: TOUCH_ID,
    touch_type: "call",
  };

  it("rejects an unknown kind with 422", async () => {
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }]);
    const { ctx } = ctxWith(db);
    const result = await recordSubmissionTouch(ctx, CASE_ID, {
      ...structuredBase,
      kind: "nonsense",
    });
    expectRejected(result, 422);
    expect(captures).toHaveLength(0);
  });

  it("rejects a missing/invalid touch_type with 422 before any DB call", async () => {
    const { db, captures } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    const result = await recordSubmissionTouch(ctx, CASE_ID, {
      ...structuredBase,
      touch_type: "smoke_signal",
    });
    expectRejected(result, 422);
    expect(captures).toHaveLength(0);
  });

  it("rejects a portal_submission-only field on a structured touch with 422", async () => {
    const { db, captures } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    const result = await recordSubmissionTouch(ctx, CASE_ID, {
      ...structuredBase,
      task_id: TASK_ID,
    });
    expectRejected(result, 422);
    expect(captures).toHaveLength(0);
  });

  it("rejects outcome 'other' without a note (context required)", async () => {
    const { db } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    const result = await recordSubmissionTouch(ctx, CASE_ID, {
      ...structuredBase,
      outcome: "other",
    });
    expectRejected(result, 422);
  });

  it("rejects a cross-org (or nonexistent) case with 404 before any write", async () => {
    const { db, captures } = makeFakeDb([{ data: null }]);
    const { ctx, writeAudit } = ctxWith(db);
    const result = await recordSubmissionTouch(ctx, CASE_ID, structuredBase);
    expectRejected(result, 404);
    expect(touchInserts(captures)).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("appends ONE touchpoint (source 'extension', server-set fields) and ONE audit event", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } }, // case ownership
      { data: null }, // idempotency miss
      { data: { ...storedRow, touch_type: "call", outcome: "successful" } }, // insert
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, {
      ...structuredBase,
      outcome: "successful",
      note: "spoke with the rep",
      recipient_name: "Nadia",
      next_follow_up_date: "2026-07-20",
    });

    expect(result.kind).toBe("created");
    const inserts = touchInserts(captures);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      id: TOUCH_ID,
      org_id: "org-1",
      case_id: CASE_ID,
      entry_type: "touchpoint",
      touch_type: "call",
      outcome: "successful",
      next_follow_up_date: "2026-07-20",
      recipient_name: "Nadia",
      coordinator_id: "user-1",
      source: "extension",
      notes: "spoke with the rep",
    });
    // Exactly one TOUCH_LOGGED audit event; never the free-text context.
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const auditArg = writeAudit.mock.calls[0][0];
    expect(auditArg).toMatchObject({ actionType: "TOUCH_LOGGED", entityType: "touch" });
    expect(JSON.stringify(auditArg)).not.toContain("spoke with the rep");
  });

  it("optionally writes back the tracking id (audited) before appending the touch", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } }, // case ownership
      { data: null }, // idempotency miss
      { data: { id: CASE_ID } }, // payer_reference update .maybeSingle
      { data: { ...storedRow, touch_type: "portal" } }, // insert
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, {
      ...structuredBase,
      touch_type: "portal",
      payer_reference_id: "REF-77",
    });

    expect(result.kind).toBe("created");
    const caseUpdate = captures.find((c) => c.table === "credential_cases" && c.op === "update");
    expect(caseUpdate?.payload).toMatchObject({ payer_reference_id: "REF-77" });
    // Two audit rows: the tracking-ID UPDATE and the touch TOUCH_LOGGED.
    expect(writeAudit).toHaveBeenCalledTimes(2);
  });

  it("a replay (same idempotency id in-org) returns the stored row and re-runs nothing", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } }, // case ownership
      { data: storedRow }, // idempotency HIT
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordSubmissionTouch(ctx, CASE_ID, structuredBase);

    expect(result.kind).toBe("duplicate");
    expect(touchInserts(captures)).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

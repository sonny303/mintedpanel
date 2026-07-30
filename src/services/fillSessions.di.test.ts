import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// fillSessions now also exposes a browser reader that imports the anon client
// at load; stub it so this ctx-only suite needs no real env.
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import {
  recordFillEvent,
  type FillEventInput,
  type FillSessionServiceCtx,
  type RecordFillEventResult,
} from "./fillSessions";

// Minimal chainable fake of the supabase-js query builder — enough for the
// fill-session shapes (org-scoped maybeSingle lookups, insert().select().single(),
// tasks update). Records table, op, payload, and filters; results are consumed
// in call order, which is deterministic in recordFillEvent.
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
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(take()).then(res, rej),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

function ctxWith(db: SupabaseClient<Database>, writeAudit = vi.fn().mockResolvedValue(undefined)) {
  const ctx: FillSessionServiceCtx = { db, orgId: "org-1", userId: "user-1", writeAudit };
  return { ctx, writeAudit };
}

const FILL_ID = "11111111-2222-4333-8444-555555555555";
const CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROVIDER_ID = "99999999-8888-4777-8666-121212121212";
const TASK_ID = "31313131-4242-4535-8686-797979797979";

const baseInput: FillEventInput = { id: FILL_ID, caseId: CASE_ID, portalKey: "availity" };

// The row the DB hands back from insert()/the idempotency lookup.
const storedRow = {
  id: FILL_ID,
  org_id: "org-1",
  case_id: CASE_ID,
  provider_id: null,
  portal_key: "availity",
  fill_mode: "web",
  started_at: "2026-07-05T00:00:00Z",
  completed_at: null,
  fields_filled: 0,
  fields_skipped: null,
  docs_attached: null,
  performed_by: "user-1",
};

function expectRejected(result: RecordFillEventResult, status: 404 | 409 | 422): void {
  expect(result.kind).toBe("rejected");
  if (result.kind !== "rejected") throw new Error("expected a rejected result");
  expect(result.status).toBe(status);
}

describe("recordFillEvent — shape validation rejects before any DB call", () => {
  const badInputs: Array<[string, FillEventInput]> = [
    ["non-UUID id", { ...baseInput, id: "not-a-uuid" }],
    ["non-UUID caseId", { ...baseInput, caseId: "case-1" }],
    ["non-UUID providerId", { ...baseInput, providerId: "p1" }],
    ["non-UUID taskId", { ...baseInput, taskId: "t1" }],
    ["blank portalKey", { ...baseInput, portalKey: "  " }],
    ["unknown fillMode", { ...baseInput, fillMode: "fax" as never }],
    ["negative fieldsFilled", { ...baseInput, fieldsFilled: -1 }],
    ["non-integer fieldsFilled", { ...baseInput, fieldsFilled: 1.5 }],
    ["fieldsFilled beyond int4", { ...baseInput, fieldsFilled: 2147483648 }],
    ["garbage startedAt", { ...baseInput, startedAt: "yesterday-ish" }],
    ["garbage completedAt", { ...baseInput, completedAt: "not-a-timestamp" }],
  ];

  it.each(badInputs)("%s is a 422 with zero queries", async (_name, input) => {
    const { db, captures } = makeFakeDb([]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, input);

    expectRejected(result, 422);
    expect(captures).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("recordFillEvent — org validation rejects before any write", () => {
  it("a case outside the org is a 404 and nothing is ever inserted", async () => {
    const { db, captures } = makeFakeDb([{ data: null }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, baseInput);

    expectRejected(result, 404);
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("credential_cases");
    expect(captures[0].op).toBe("select");
    expect(captures[0].filters).toContainEqual(["id", CASE_ID]);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a provider outside the org is a 404 and nothing is ever inserted", async () => {
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: null }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, providerId: PROVIDER_ID });

    expectRejected(result, 404);
    expect(captures).toHaveLength(2);
    expect(captures[1].table).toBe("providers");
    expect(captures[1].filters).toContainEqual(["id", PROVIDER_ID]);
    expect(captures[1].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a task outside the org is a 404 and nothing is ever inserted", async () => {
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: null }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, taskId: TASK_ID });

    expectRejected(result, 404);
    expect(captures).toHaveLength(2);
    expect(captures[1].table).toBe("tasks");
    expect(captures[1].filters).toContainEqual(["id", TASK_ID]);
    expect(captures[1].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("recordFillEvent — happy path", () => {
  it("inserts with org_id/performed_by from ctx even when the body smuggles them", async () => {
    // Sequence: case lookup, idempotency lookup (miss), insert.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    // Attacker plants a different org and performer via the body.
    const body = {
      id: FILL_ID,
      caseId: CASE_ID,
      portalKey: "availity",
      org_id: "org-EVIL",
      performed_by: "intruder",
    };
    const result = await recordFillEvent(ctx, body);

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected a created result");
    expect(result.session.orgId).toBe("org-1");
    expect(result.session.caseId).toBe(CASE_ID);

    const insertCap = captures.find((c) => c.op === "insert");
    expect(insertCap?.table).toBe("fill_sessions");
    expect(insertCap?.payload?.org_id).toBe("org-1");
    expect(insertCap?.payload?.performed_by).toBe("user-1");
    expect(JSON.stringify(insertCap?.payload)).not.toContain("org-EVIL");
    expect(JSON.stringify(insertCap?.payload)).not.toContain("intruder");
    // Defaults applied; started_at omitted so the column default (now()) wins.
    expect(insertCap?.payload?.fill_mode).toBe("web");
    expect(insertCap?.payload?.fields_filled).toBe(0);
    expect(insertCap?.payload).not.toHaveProperty("started_at");

    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        entityType: "fill_session",
        entityId: FILL_ID,
      }),
    );
    // No taskId — the tasks table is never touched.
    expect(captures.some((c) => c.table === "tasks")).toBe(false);
  });

  it("forwards startedAt when the client provides one", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: storedRow },
    ]);
    const { ctx } = ctxWith(db);

    await recordFillEvent(ctx, { ...baseInput, startedAt: "2026-07-04T12:00:00Z" });

    const insertCap = captures.find((c) => c.op === "insert");
    expect(insertCap?.payload?.started_at).toBe("2026-07-04T12:00:00Z");
  });
});

describe("recordFillEvent — idempotency", () => {
  it("a replayed id returns the stored row without inserting or auditing", async () => {
    // Sequence: case lookup, idempotency lookup (hit).
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: storedRow }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, baseInput);

    expect(result.kind).toBe("duplicate");
    if (result.kind !== "duplicate") throw new Error("expected a duplicate result");
    expect(result.session).toMatchObject({ id: FILL_ID, caseId: CASE_ID, portalKey: "availity" });

    const lookup = captures.find((c) => c.table === "fill_sessions");
    expect(lookup?.op).toBe("select");
    expect(lookup?.filters).toContainEqual(["id", FILL_ID]);
    expect(lookup?.filters).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a replay with a taskId leaves an already-completed task untouched (no double audit)", async () => {
    // Sequence: case lookup, task org lookup, idempotency lookup (hit),
    // task before-lookup (already completed -> early return).
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: TASK_ID } },
      { data: storedRow },
      { data: { id: TASK_ID, status: "completed" } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, taskId: TASK_ID });

    expect(result.kind).toBe("duplicate");
    expect(captures.some((c) => c.op === "update")).toBe(false);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a replay converges a dropped task completion (transient failure recovery)", async () => {
    // A prior attempt inserted the row but died before the task update. The
    // replay must re-run the idempotent completion instead of skipping it.
    // Sequence: case lookup, task org lookup, idempotency lookup (hit),
    // task before-lookup (not completed), task update.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: TASK_ID } },
      { data: storedRow },
      { data: { id: TASK_ID, status: "not_started" } },
      { data: { id: TASK_ID } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, taskId: TASK_ID });

    expect(result.kind).toBe("duplicate");
    expect(captures.some((c) => c.op === "insert")).toBe(false);
    const updateCap = captures.find((c) => c.op === "update");
    expect(updateCap?.table).toBe("tasks");
    expect(updateCap?.payload?.status).toBe("completed");
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "UPDATE", entityType: "task", entityId: TASK_ID }),
    );
  });

  it("a same-org insert race resolves to the stored row (200), not a 409", async () => {
    // Both requests passed the pre-insert lookup; this one lost the insert.
    // Sequence: case lookup, idempotency lookup (miss), insert fails 23505,
    // post-conflict lookup finds the winner's row.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: null, error: { code: "23505", message: "duplicate key value" } },
      { data: storedRow },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, baseInput);

    expect(result.kind).toBe("duplicate");
    if (result.kind !== "duplicate") throw new Error("expected a duplicate result");
    expect(result.session.id).toBe(FILL_ID);
    expect(captures.filter((c) => c.table === "fill_sessions" && c.op === "select")).toHaveLength(
      2,
    );
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a 23505 whose row is invisible org-scoped (id used by another org) is a 409", async () => {
    // Sequence: case lookup, idempotency lookup (miss), insert fails 23505,
    // post-conflict org-scoped lookup still finds nothing.
    const { db } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: null, error: { code: "23505", message: "duplicate key value" } },
      { data: null },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, baseInput);

    expectRejected(result, 409);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("echoes client jsonb payloads verbatim (keys inside fields_skipped are not camelized)", async () => {
    const skipped = [{ field_selector: "#fax", reason_code: "no_value" }];
    const rowWithJson = { ...storedRow, fields_skipped: skipped, docs_attached: { doc_ids: [1] } };
    const { db } = makeFakeDb([{ data: { id: CASE_ID } }, { data: null }, { data: rowWithJson }]);
    const { ctx } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, fieldsSkipped: skipped });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected a created result");
    expect(result.session.fieldsSkipped).toEqual(skipped);
    expect(result.session.docsAttached).toEqual({ doc_ids: [1] });
  });
});

describe("recordFillEvent — task completion", () => {
  it("marks the task completed (org-scoped) and writes a second audit row", async () => {
    // Sequence: case lookup, task org lookup, idempotency miss, insert,
    // task before-lookup, task update.
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: TASK_ID } },
      { data: null },
      { data: storedRow },
      { data: { id: TASK_ID, status: "in_progress" } },
      { data: { id: TASK_ID } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, taskId: TASK_ID });

    expect(result.kind).toBe("created");
    const updateCap = captures.find((c) => c.op === "update");
    expect(updateCap?.table).toBe("tasks");
    expect(updateCap?.filters).toContainEqual(["id", TASK_ID]);
    expect(updateCap?.filters).toContainEqual(["org_id", "org-1"]);
    expect(updateCap?.payload?.status).toBe("completed");
    expect(updateCap?.payload?.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The before-lookup is org-scoped too.
    const taskSelects = captures.filter((c) => c.table === "tasks" && c.op === "select");
    for (const cap of taskSelects) {
      expect(cap.filters).toContainEqual(["org_id", "org-1"]);
    }

    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(writeAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actionType: "CREATE", entityType: "fill_session" }),
    );
    expect(writeAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actionType: "UPDATE", entityType: "task", entityId: TASK_ID }),
    );
  });

  it("skips completion entirely when the task is already completed", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: TASK_ID } },
      { data: null },
      { data: storedRow },
      { data: { id: TASK_ID, status: "completed" } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, taskId: TASK_ID });

    expect(result.kind).toBe("created");
    expect(captures.some((c) => c.op === "update")).toBe(false);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "CREATE", entityType: "fill_session" }),
    );
  });
});

// A DRY RUN proves a portal's mappings against the live form before any provider
// is enrolled anywhere, so it has no case. The column has been nullable since
// E4.2 and the app's own dry run already writes caseless test rows; these pin
// that the /api path allows exactly that much and not one step more.
describe("recordFillEvent — caseless test runs (extension dry run)", () => {
  const testRun: FillEventInput = {
    ...baseInput,
    caseId: null,
    providerId: null,
    isTest: true,
    portalKey: "aetna-network",
  };

  it("accepts a test run with NO case and never looks a case up", async () => {
    const { db, captures } = makeFakeDb([{ data: null }, { data: storedRow }]);
    const { ctx } = ctxWith(db);
    const result = await recordFillEvent(ctx, testRun);
    expect(result.kind).toBe("created");
    // No credential_cases read at all — there is no case to own.
    expect(captures.some((c) => c.table === "credential_cases")).toBe(false);
  });

  it("writes case_id null and is_test true", async () => {
    const { db, captures } = makeFakeDb([{ data: null }, { data: storedRow }]);
    const { ctx } = ctxWith(db);
    await recordFillEvent(ctx, testRun);
    const insert = captures.find((c) => c.op === "insert");
    expect(insert?.payload?.case_id).toBeNull();
    expect(insert?.payload?.is_test).toBe(true);
    // org/actor still come from ctx, never the body — unchanged by this relaxation.
    expect(insert?.payload?.org_id).toBe("org-1");
  });

  it("a REAL fill still requires a case — the relaxation is test-only", async () => {
    const { db, captures } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    const result = await recordFillEvent(ctx, { ...baseInput, caseId: null, isTest: false });
    expectRejected(result, 422);
    expect(captures).toHaveLength(0);
  });

  it("omitting isTest entirely is a real fill, so a missing case is still 422", async () => {
    const { db } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    const noFlag = { ...baseInput } as FillEventInput;
    delete (noFlag as { caseId?: unknown }).caseId;
    expectRejected(await recordFillEvent(ctx, noFlag), 422);
  });

  it("a test run that DOES name a case still has it ownership-checked", async () => {
    // isTest must not become a way to attach a row to someone else's case.
    const { db, captures } = makeFakeDb([{ data: null }]);
    const { ctx } = ctxWith(db);
    const result = await recordFillEvent(ctx, { ...testRun, caseId: baseInput.caseId });
    expectRejected(result, 404);
    expect(captures.some((c) => c.op === "insert")).toBe(false);
  });

  it("a malformed caseId on a test run is still a 422", async () => {
    const { db } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    expectRejected(await recordFillEvent(ctx, { ...testRun, caseId: "nope" }), 422);
  });
});

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
// fillSessions.di.test.ts. Results consume in call order, which is
// deterministic in recordSubmissionTouch.
interface Captured {
  table?: string;
  op: "select" | "insert";
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
  touch_type: "portal",
  outcome: "submitted",
  next_follow_up_date: null,
  notes: "Application submitted via BCBS KS Enrollment",
  coordinator_id: "user-1",
  source: "extension",
  created_at: "2026-07-05T00:00:00Z",
};

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
});

describe("recordSubmissionTouch — happy path", () => {
  it("inserts one touch with identity from ctx even when the body smuggles it", async () => {
    // Sequence: case lookup, idempotency lookup (miss), insert.
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

    const insertCap = captures.find((c) => c.op === "insert");
    expect(insertCap?.table).toBe("touches");
    expect(insertCap?.payload).toMatchObject({
      id: TOUCH_ID,
      org_id: "org-1",
      case_id: CASE_ID,
      touch_type: "portal",
      outcome: "submitted",
      coordinator_id: "user-1",
      source: "extension",
      notes: "Application submitted via BCBS KS Enrollment",
    });
    expect(insertCap?.payload?.touch_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(insertCap?.payload)).not.toContain("org-EVIL");
    expect(JSON.stringify(insertCap?.payload)).not.toContain("intruder");

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
          source: "extension",
        }),
      }),
    );
    // This route logs a touch, nothing else: no case update, no task write.
    expect(captures.every((c) => c.table !== "tasks")).toBe(true);
    expect(captures.filter((c) => c.table === "credential_cases").every((c) => c.op === "select")).toBe(
      true,
    );
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

    const insertCap = captures.find((c) => c.op === "insert");
    expect(insertCap?.payload?.notes).toBe(
      "Application submitted via BCBS KS Enrollment — confirmation #12345",
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({ fillSessionId: FILL_SESSION_ID }),
      }),
    );
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
    // Sequence: case lookup, idempotency lookup (miss), insert fails 23505,
    // post-conflict lookup finds the winner's row.
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

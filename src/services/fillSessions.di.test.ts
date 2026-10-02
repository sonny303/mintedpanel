import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// fillSessions now also exposes a browser reader that imports the anon client
// at load; stub it so this ctx-only suite needs no real env.
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@/services/workContext", () => ({ validateWorkContext: vi.fn() }));

import {
  recordFillEvent,
  type FillEventInput,
  type FillSessionServiceCtx,
  type RecordFillEventResult,
} from "./fillSessions";
import { validateWorkContext } from "@/services/workContext";
import type { WorkContextTuple } from "@/lib/workContext";

const validateWorkContextMock = vi.mocked(validateWorkContext);

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
        is(col: string, val: unknown) {
          cap.filters.push([col, val]);
          return builder;
        },
        ilike(col: string, val: unknown) {
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
const CONTRACT_ID = "41414141-4242-4535-8686-797979797979";
const ASSIGNMENT_ID = "51515151-4242-4535-8686-797979797979";
const SOP_TEMPLATE_ID = "61616161-4242-4535-8686-797979797979";
const LAUNCH_RECEIPT_ID = "71717171-4242-4535-8686-797979797979";
const FACILITY_ID = "81818181-4242-4535-8686-797979797979";
const PORTAL_ID = "91919191-4242-4535-8686-797979797979";
const STEP_ID = "a1a1a1a1-1111-4111-8111-111111111111";
const STEP_IDENTITY = `${CASE_ID}:${TASK_ID}:${SOP_TEMPLATE_ID}:3:${STEP_ID}`;
const CASE_WORK_CONTEXT: WorkContextTuple = {
  launchReceiptId: LAUNCH_RECEIPT_ID,
  orgId: "b7a90000-0000-4000-a000-000000000001",
  ownerKind: "case",
  ownerId: CASE_ID,
  contextVersion: 2,
  sopTemplateId: SOP_TEMPLATE_ID,
  sopVersion: 3,
  portalId: PORTAL_ID,
  portalKey: "aetna_enrollment_form",
  mappingGeneration: 4,
  effectiveMappingFingerprint: `sha256:${"a".repeat(64)}`,
  providerId: PROVIDER_ID,
  facilityId: FACILITY_ID,
  stepIdentity: STEP_IDENTITY,
  taskId: TASK_ID,
  stepId: STEP_ID,
};

const baseInput: FillEventInput = { id: FILL_ID, caseId: CASE_ID, portalKey: "availity" };
const V2_FIELD = {
  mapId: "12121212-3434-4567-8899-aabbccddeeff",
  targetKey: "t_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  frameKey: "f_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  stepKey: "s_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  attempted: true,
  outcome: "verified",
  reasonCode: null,
};
const V2_INPUT: FillEventInput = {
  ...baseInput,
  schemaVersion: 2,
  fieldsAttempted: 1,
  fieldsVerified: 1,
  fieldsRejected: 0,
  fieldOutcomes: [V2_FIELD],
  fieldsFilled: 1,
};
const CONTRACT_V2_INPUT: FillEventInput = {
  ...V2_INPUT,
  caseId: null,
  contractId: CONTRACT_ID,
  contractSopAssignmentId: ASSIGNMENT_ID,
  sopTemplateId: SOP_TEMPLATE_ID,
  sopVersion: 3,
  taskIndex: 0,
  stepIndex: 1,
  facilityId: FACILITY_ID,
  portalId: PORTAL_ID,
  contextVersion: 2,
  launchReceiptId: LAUNCH_RECEIPT_ID,
  mappingGeneration: 4,
  effectiveMappingFingerprint: "opaque-canonical-fingerprint",
  providerId: PROVIDER_ID,
  portalKey: "aetna_contract_form",
  fillMode: "web",
  isTest: false,
};

const CASE_WORK_V2_INPUT: FillEventInput = {
  ...V2_INPUT,
  workContext: CASE_WORK_CONTEXT,
  caseId: CASE_ID,
  providerId: PROVIDER_ID,
  portalKey: CASE_WORK_CONTEXT.portalKey,
  schemaVersion: 2,
  fillMode: "web",
};

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

const storedCaseWorkRow = {
  ...storedRow,
  org_id: CASE_WORK_CONTEXT.orgId,
  case_id: CASE_ID,
  contract_id: null,
  contract_sop_assignment_id: null,
  sop_template_id: SOP_TEMPLATE_ID,
  sop_version: 3,
  task_index: null,
  step_index: null,
  case_task_id: TASK_ID,
  case_step_id: STEP_ID,
  step_identity: STEP_IDENTITY,
  facility_id: FACILITY_ID,
  portal_id: PORTAL_ID,
  context_version: 2,
  launch_receipt_id: LAUNCH_RECEIPT_ID,
  mapping_generation: 4,
  effective_mapping_fingerprint: `sha256:${"a".repeat(64)}`,
  provider_id: PROVIDER_ID,
  portal_key: CASE_WORK_CONTEXT.portalKey,
  fill_mode: "web",
  fields_filled: 1,
  fields_skipped: [],
  docs_attached: null,
  is_test: false,
  event_schema_version: 2,
  fields_attempted: 1,
  fields_verified: 1,
  fields_rejected: 0,
  field_outcomes: [V2_FIELD],
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
    [
      "taskId with null caseId",
      { ...baseInput, providerId: PROVIDER_ID, caseId: null, taskId: TASK_ID },
    ],
    [
      "taskId with omitted caseId",
      { id: FILL_ID, portalKey: "availity", providerId: PROVIDER_ID, taskId: TASK_ID },
    ],
    ["missing both caseId and providerId", { id: FILL_ID, portalKey: "availity" }],
    ["blank portalKey", { ...baseInput, portalKey: "  " }],
    ["unknown fillMode", { ...baseInput, fillMode: "fax" as never }],
    ["negative fieldsFilled", { ...baseInput, fieldsFilled: -1 }],
    ["non-integer fieldsFilled", { ...baseInput, fieldsFilled: 1.5 }],
    ["fieldsFilled beyond int4", { ...baseInput, fieldsFilled: 2147483648 }],
    ["garbage startedAt", { ...baseInput, startedAt: "yesterday-ish" }],
    ["garbage completedAt", { ...baseInput, completedAt: "not-a-timestamp" }],
    ["unknown schema version", { ...baseInput, schemaVersion: 3 }],
    ["incomplete V2 metadata", { ...baseInput, schemaVersion: 2, fieldsVerified: 1 }],
    ["V2 task completion", { ...V2_INPUT, taskId: TASK_ID }],
    [
      "arbitrary attachment metadata",
      { ...baseInput, docsAttached: { secret: "synthetic-value" } },
    ],
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

  it("inserts an ad hoc fill with null case_id when providerId is provided without caseId", async () => {
    const { db, captures } = makeFakeDb([
      // belongsToOrg("providers", PROVIDER_ID)
      { data: { id: PROVIDER_ID } },
      // idempotency lookup (miss)
      { data: null },
      // insert().select().single()
      { data: { ...storedRow, case_id: null, provider_id: PROVIDER_ID } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, {
      id: FILL_ID,
      providerId: PROVIDER_ID,
      portalKey: "availity",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected created");
    expect(result.session.caseId).toBeNull();
    expect(result.session.providerId).toBe(PROVIDER_ID);

    const insertCap = captures.find((c) => c.op === "insert");
    expect(insertCap?.payload?.case_id).toBeNull();
    expect(insertCap?.payload?.provider_id).toBe(PROVIDER_ID);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});

describe("recordFillEvent — idempotency", () => {
  it("rejects a case-free task completion before looking up an existing fill session", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: PROVIDER_ID } },
      { data: { id: TASK_ID } },
      { data: { ...storedRow, case_id: null, provider_id: PROVIDER_ID } },
      { data: { id: TASK_ID, status: "in_progress" } },
      { data: { id: TASK_ID } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, {
      id: FILL_ID,
      providerId: PROVIDER_ID,
      portalKey: "availity",
      taskId: TASK_ID,
    });

    expectRejected(result, 422);
    expect(captures).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

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

  it("sanitizes v1 fields_skipped before insertion and rejects value-bearing attachments", async () => {
    const skipped = [
      { selector: "#fax", label: "Fax Number", reason: "secret actual value", kind: "no_value" },
    ];
    const rowWithJson = {
      ...storedRow,
      fields_skipped: [{ label: "", reason: "missing_value", kind: "no_value", mapId: null }],
      docs_attached: null,
    };
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: null },
      { data: rowWithJson },
    ]);
    const { ctx } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, fieldsSkipped: skipped });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected a created result");
    expect(result.session.fieldsSkipped).toEqual([
      { label: "", reason: "missing_value", kind: "no_value", mapId: null },
    ]);
    expect(
      result.session.fieldsSkipped?.some((entry) => JSON.stringify(entry).includes("secret")),
    ).toBe(false);
    expect(result.session.docsAttached).toBeNull();
    const inserted = captures.find(
      (capture) => capture.table === "fill_sessions" && capture.op === "insert",
    );
    expect(inserted?.payload?.fields_skipped).toEqual([
      { label: "", reason: "missing_value", kind: "no_value", mapId: null },
    ]);
    expect(JSON.stringify(inserted?.payload).includes("Fax Number")).toBe(false);
    expect(JSON.stringify(inserted?.payload).includes("secret actual value")).toBe(false);
  });

  it("accepts an identical v2 retry and returns the stored row", async () => {
    const stored = {
      ...storedRow,
      fields_filled: 1,
      fields_skipped: [],
      docs_attached: null,
      performed_by: "user-1",
      event_schema_version: 2,
      fields_attempted: 1,
      fields_verified: 1,
      fields_rejected: 0,
      field_outcomes: [V2_FIELD],
    };
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: stored }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, V2_INPUT);

    expect(result.kind).toBe("duplicate");
    expect(captures.some((capture) => capture.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("writes v2 counters, outcomes, and safe skips without a second audit", async () => {
    const safeSkipped = [{ label: "", reason: "missing_value", kind: "needs_value", mapId: null }];
    const row = {
      ...storedRow,
      fields_filled: 1,
      fields_skipped: safeSkipped,
      docs_attached: null,
      performed_by: "user-1",
      event_schema_version: 2,
      fields_attempted: 1,
      fields_verified: 1,
      fields_rejected: 0,
      field_outcomes: [V2_FIELD],
    };
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: null }, { data: row }]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, {
      ...V2_INPUT,
      fieldOutcomes: [
        V2_FIELD,
        {
          ...V2_FIELD,
          mapId: null,
          targetKey: "t_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeefe",
          frameKey: null,
          stepKey: null,
          attempted: false,
          outcome: "needs_value",
          reasonCode: "missing_value",
        },
      ],
      fieldsAttempted: 1,
      fieldsVerified: 1,
      fieldsRejected: 0,
    });

    expect(result.kind).toBe("created");
    expect(
      captures.find((capture) => capture.table === "fill_sessions" && capture.op === "insert")
        ?.payload,
    ).toMatchObject({
      event_schema_version: 2,
      fields_attempted: 1,
      fields_verified: 1,
      fields_rejected: 0,
      fields_filled: 1,
      docs_attached: null,
    });
    const inserted = captures.find(
      (capture) => capture.table === "fill_sessions" && capture.op === "insert",
    );
    expect(inserted?.payload?.field_outcomes).toHaveLength(2);
    expect(inserted?.payload?.fields_skipped).toEqual([
      { label: "", reason: "missing_value", kind: "needs_value", mapId: null },
    ]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects changed v2 payloads on replay using the same id", async () => {
    const stored = {
      ...storedRow,
      fields_filled: 1,
      fields_skipped: [],
      docs_attached: null,
      performed_by: "user-1",
      event_schema_version: 2,
      fields_attempted: 1,
      fields_verified: 1,
      fields_rejected: 0,
      field_outcomes: [V2_FIELD],
    };
    const { db, captures } = makeFakeDb([{ data: { id: CASE_ID } }, { data: stored }]);
    const { ctx, writeAudit } = ctxWith(db);
    const changedInput = {
      ...V2_INPUT,
      fieldOutcomes: [{ ...V2_FIELD, targetKey: "t_bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" }],
    };

    const result = await recordFillEvent(ctx, changedInput);

    expectRejected(result, 409);
    expect(captures.some((capture) => capture.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a v1 task retry against a stored V2 fill before completing the task", async () => {
    const stored = {
      ...storedRow,
      fields_filled: 1,
      fields_skipped: [],
      docs_attached: null,
      performed_by: "user-1",
      event_schema_version: 2,
      fields_attempted: 1,
      fields_verified: 1,
      fields_rejected: 0,
      field_outcomes: [V2_FIELD],
    };
    const { db, captures } = makeFakeDb([
      { data: { id: CASE_ID } },
      { data: { id: TASK_ID } },
      { data: stored },
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, { ...baseInput, taskId: TASK_ID });

    expectRejected(result, 409);
    expect(captures.some((capture) => capture.table === "tasks" && capture.op === "update")).toBe(
      false,
    );
    expect(captures.some((capture) => capture.op === "insert")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
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

describe("recordFillEvent — exact case Work receipts", () => {
  it("persists the selected task and step from the nested canonical tuple without completing the task", async () => {
    validateWorkContextMock.mockResolvedValue({
      kind: "ok",
      data: { sharedMappingGeneration: 6 } as never,
    } as never);
    const { db, captures } = makeFakeDb([
      { data: null },
      { data: null },
      { data: { id: CASE_ID } },
      { data: { id: PROVIDER_ID } },
      { data: { ...storedRow, case_id: CASE_ID, provider_id: PROVIDER_ID } },
    ]);
    const { ctx, writeAudit } = ctxWith(db);
    ctx.orgId = CASE_WORK_CONTEXT.orgId;

    const result = await recordFillEvent(ctx, CASE_WORK_V2_INPUT);

    expect(result.kind).toBe("created");
    expect(validateWorkContextMock).toHaveBeenCalledWith(
      { db, orgId: CASE_WORK_CONTEXT.orgId },
      { protocolVersion: 2, ...CASE_WORK_CONTEXT },
    );
    const insert = captures.find(
      (capture) => capture.table === "fill_sessions" && capture.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      case_id: CASE_ID,
      contract_id: null,
      case_task_id: TASK_ID,
      case_step_id: STEP_ID,
      step_identity: STEP_IDENTITY,
      portal_id: PORTAL_ID,
      mapping_generation: 4,
      shared_mapping_generation: 6,
      effective_mapping_fingerprint: `sha256:${"a".repeat(64)}`,
    });
    expect(captures.some((capture) => capture.table === "tasks" && capture.op === "update")).toBe(
      false,
    );
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["test fill", { isTest: true }],
    ["conflicting flat owner", { caseId: PROVIDER_ID }],
    ["conflicting selected config", { portalId: ASSIGNMENT_ID }],
    ["conflicting snake-case organization", { org_id: "b7a90000-0000-4000-a000-000000000002" }],
    ["conflicting selected task alias", { case_task_id: PROVIDER_ID }],
    ["conflicting actor alias", { performed_by: "87654321-4321-4321-8321-210987654321" }],
  ])("rejects a %s before any database call", async (_label, override) => {
    const { db, captures } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    ctx.orgId = CASE_WORK_CONTEXT.orgId;

    const result = await recordFillEvent(ctx, {
      ...CASE_WORK_V2_INPUT,
      ...override,
    });

    expectRejected(result, 422);
    expect(captures).toHaveLength(0);
  });

  it.each(["sharedMappingGeneration", "shared_mapping_generation"])(
    "does not accept a caller-supplied %s pin",
    async (key) => {
      const { db, captures } = makeFakeDb([]);
      const { ctx } = ctxWith(db);
      ctx.orgId = CASE_WORK_CONTEXT.orgId;
      const result = await recordFillEvent(ctx, {
        ...CASE_WORK_V2_INPUT,
        [key]: 99,
      } as typeof CASE_WORK_V2_INPUT);
      expectRejected(result, 422);
      expect(captures).toHaveLength(0);
    },
  );

  it("rejects an untrusted organization selector before any database call", async () => {
    const { db, captures } = makeFakeDb([]);
    const { ctx } = ctxWith(db);
    ctx.orgId = "b7a90000-0000-4000-a000-000000000002";

    const result = await recordFillEvent(ctx, CASE_WORK_V2_INPUT);

    expectRejected(result, 404);
    expect(captures).toHaveLength(0);
  });

  it("maps stale current work context to 409 before inserting the receipt", async () => {
    validateWorkContextMock.mockResolvedValue({ kind: "stale", message: "changed" });
    const { db, captures } = makeFakeDb([{ data: null }, { data: null }]);
    const { ctx } = ctxWith(db);
    ctx.orgId = CASE_WORK_CONTEXT.orgId;

    const result = await recordFillEvent(ctx, CASE_WORK_V2_INPUT);

    expectRejected(result, 409);
    expect(
      captures.some((capture) => capture.table === "fill_sessions" && capture.op === "insert"),
    ).toBe(false);
  });

  it("returns an exact historical Work fill retry before stale step or mapping validation", async () => {
    validateWorkContextMock.mockReset();
    validateWorkContextMock.mockResolvedValue({
      kind: "stale",
      message: "step completed or reset",
    });
    const { db, captures } = makeFakeDb([{ data: storedCaseWorkRow }]);
    const { ctx, writeAudit } = ctxWith(db);
    ctx.orgId = CASE_WORK_CONTEXT.orgId;

    const result = await recordFillEvent(ctx, CASE_WORK_V2_INPUT);

    expect(result.kind).toBe("duplicate");
    if (result.kind !== "duplicate") throw new Error("expected an exact replay");
    expect(result.session.id).toBe(FILL_ID);
    expect(validateWorkContextMock).not.toHaveBeenCalled();
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("fill_sessions");
    expect(captures[0].filters).toContainEqual(["id", FILL_ID]);
    expect(captures[0].filters).toContainEqual(["org_id", CASE_WORK_CONTEXT.orgId]);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("recordFillEvent — Contract owner receipts", () => {
  it("records exact Contract SOP context without a credential case or task side effect", async () => {
    const row = {
      ...storedRow,
      case_id: null,
      contract_id: CONTRACT_ID,
      contract_sop_assignment_id: ASSIGNMENT_ID,
      sop_template_id: SOP_TEMPLATE_ID,
      sop_version: 3,
      task_index: 0,
      step_index: 1,
      facility_id: FACILITY_ID,
      portal_id: PORTAL_ID,
      context_version: 2,
      launch_receipt_id: LAUNCH_RECEIPT_ID,
      mapping_generation: 4,
      effective_mapping_fingerprint: "opaque-canonical-fingerprint",
      provider_id: PROVIDER_ID,
      portal_key: "aetna_contract_form",
      is_test: false,
      event_schema_version: 2,
      fields_attempted: 1,
      fields_verified: 1,
      fields_rejected: 0,
      fields_filled: 1,
      fields_skipped: [],
      docs_attached: null,
      performed_by: "user-1",
      field_outcomes: [V2_FIELD],
    };
    const { db, captures } = makeFakeDb([
      { data: { id: CONTRACT_ID } }, // contract org backstop
      { data: { id: PROVIDER_ID } }, // provider org backstop
      { data: { id: CONTRACT_ID, group_id: "group-1", payer_id: "payer-1", state: "NY" } },
      {
        data: {
          id: ASSIGNMENT_ID,
          sop_template_id: SOP_TEMPLATE_ID,
          sop_version: 3,
          context_version: 2,
        },
      },
      { data: { id: PROVIDER_ID, status: "active" } },
      { data: { id: "provider-group-assignment", start_date: null, end_date: null } },
      { data: { id: FACILITY_ID } }, // optional location membership
      {
        data: {
          id: PORTAL_ID,
          org_id: "org-1",
          portal_key: "aetna_contract_form",
          payer_id: "payer-1",
          case_type: "contract",
          requires_explicit_selection: true,
          mapping_generation: 4,
        },
      },
      { data: null }, // idempotency lookup
      { data: row }, // insert
    ]);
    const { ctx, writeAudit } = ctxWith(db);

    const result = await recordFillEvent(ctx, CONTRACT_V2_INPUT);

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected a created Contract receipt");
    expect(result.session).toMatchObject({
      caseId: null,
      contractId: CONTRACT_ID,
      contractSopAssignmentId: ASSIGNMENT_ID,
      sopTemplateId: SOP_TEMPLATE_ID,
      sopVersion: 3,
      taskIndex: 0,
      stepIndex: 1,
      facilityId: FACILITY_ID,
      portalId: PORTAL_ID,
      contextVersion: 2,
      launchReceiptId: LAUNCH_RECEIPT_ID,
      mappingGeneration: 4,
      effectiveMappingFingerprint: "opaque-canonical-fingerprint",
    });
    const inserted = captures.find(
      (capture) => capture.table === "fill_sessions" && capture.op === "insert",
    );
    expect(inserted?.payload).toMatchObject({
      case_id: null,
      contract_id: CONTRACT_ID,
      contract_sop_assignment_id: ASSIGNMENT_ID,
      sop_template_id: SOP_TEMPLATE_ID,
      sop_version: 3,
      task_index: 0,
      step_index: 1,
      portal_id: PORTAL_ID,
      context_version: 2,
      launch_receipt_id: LAUNCH_RECEIPT_ID,
      mapping_generation: 4,
      effective_mapping_fingerprint: "opaque-canonical-fingerprint",
    });
    expect(captures.some((capture) => capture.table === "credential_cases")).toBe(false);
    expect(captures.some((capture) => capture.table === "tasks")).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects incomplete or case-owned Contract context before querying", async () => {
    const { db, captures } = makeFakeDb([]);
    const { ctx } = ctxWith(db);

    const missingPin = await recordFillEvent(ctx, {
      ...CONTRACT_V2_INPUT,
      contractSopAssignmentId: null,
    });
    const dualOwner = await recordFillEvent(ctx, {
      ...CONTRACT_V2_INPUT,
      caseId: CASE_ID,
    });

    expectRejected(missingPin, 422);
    expectRejected(dualOwner, 422);
    expect(captures).toHaveLength(0);
  });

  it("rejects a Contract assignment outside the caller's organization before insert", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CONTRACT_ID } },
      { data: { id: PROVIDER_ID } },
      { data: null },
    ]);
    const { ctx } = ctxWith(db);

    const result = await recordFillEvent(ctx, CONTRACT_V2_INPUT);

    expectRejected(result, 404);
    expect(captures.map((capture) => capture.table)).toEqual([
      "contracts",
      "providers",
      "contracts",
    ]);
    expect(captures.some((capture) => capture.op === "insert")).toBe(false);
  });

  it.each([
    [
      "future group membership",
      { id: "provider-group-assignment", start_date: "2999-01-01", end_date: null },
      { id: PROVIDER_ID, status: "active" },
    ],
    [
      "terminated provider",
      { id: "provider-group-assignment", start_date: null, end_date: null },
      { id: PROVIDER_ID, status: "terminated" },
    ],
  ])(
    "rejects a Contract receipt for a %s before inserting",
    async (_label, membership, provider) => {
      const { db, captures } = makeFakeDb([
        { data: { id: CONTRACT_ID } },
        { data: { id: PROVIDER_ID } },
        { data: { id: CONTRACT_ID, group_id: "group-1", payer_id: "payer-1", state: "NY" } },
        {
          data: {
            id: ASSIGNMENT_ID,
            sop_template_id: SOP_TEMPLATE_ID,
            sop_version: 3,
            context_version: 2,
          },
        },
        { data: provider },
        { data: membership },
      ]);
      const { ctx } = ctxWith(db);

      const result = await recordFillEvent(ctx, CONTRACT_V2_INPUT);

      expectRejected(result, 404);
      expect(
        captures.some((capture) => capture.table === "fill_sessions" && capture.op === "insert"),
      ).toBe(false);
    },
  );

  it("rejects a global config when an org config owns the same normalized key", async () => {
    const { db, captures } = makeFakeDb([
      { data: { id: CONTRACT_ID } },
      { data: { id: PROVIDER_ID } },
      { data: { id: CONTRACT_ID, group_id: "group-1", payer_id: "payer-1", state: "NY" } },
      {
        data: {
          id: ASSIGNMENT_ID,
          sop_template_id: SOP_TEMPLATE_ID,
          sop_version: 3,
          context_version: 2,
        },
      },
      { data: { id: PROVIDER_ID, status: "active" } },
      { data: { id: "provider-group-assignment", start_date: null, end_date: null } },
      { data: { id: FACILITY_ID } },
      {
        data: {
          id: PORTAL_ID,
          org_id: null,
          portal_key: "aetna_contract_form",
          payer_id: "payer-1",
          case_type: "contract",
          requires_explicit_selection: true,
          mapping_generation: 4,
        },
      },
      { data: [{ id: "org-portal-config", portal_key: "Aetna_Contract_Form" }] },
    ]);
    const { ctx } = ctxWith(db);

    const result = await recordFillEvent(ctx, CONTRACT_V2_INPUT);

    expectRejected(result, 404);
    expect(
      captures.some((capture) => capture.table === "fill_sessions" && capture.op === "insert"),
    ).toBe(false);
  });
});

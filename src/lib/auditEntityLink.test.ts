import { describe, expect, it } from "vitest";
import { auditEntityTarget } from "./auditEntityLink";

const CASE_ID = "c0000000-0000-4000-8000-000000000001";
const TASK_ID = "70000000-0000-4000-8000-000000000001";

describe("auditEntityTarget", () => {
  it("opens the case for both case entity types", () => {
    for (const entityType of ["case", "credential_case"]) {
      expect(auditEntityTarget({ entityType, entityId: CASE_ID, after: null })).toEqual({
        to: "/cases/$id",
        id: CASE_ID,
      });
    }
  });

  it("opens the case for a task batch row, whose entity_id is the case", () => {
    expect(
      auditEntityTarget({
        entityType: "task",
        entityId: CASE_ID,
        after: { caseId: CASE_ID, count: 2, taskIds: [TASK_ID, "t-2"] },
      }),
    ).toEqual({ to: "/cases/$id", id: CASE_ID });
  });

  it("opens the task for a single-task row", () => {
    expect(
      auditEntityTarget({
        entityType: "task",
        entityId: TASK_ID,
        after: { caseId: CASE_ID, title: "Follow up", dueDate: "2026-11-01" },
      }),
    ).toEqual({ to: "/tasks/$id", id: TASK_ID });
    expect(
      auditEntityTarget({ entityType: "task", entityId: TASK_ID, after: { status: "completed" } }),
    ).toEqual({ to: "/tasks/$id", id: TASK_ID });
  });

  it("opens the provider", () => {
    expect(auditEntityTarget({ entityType: "provider", entityId: "p-1", after: null })).toEqual({
      to: "/providers/$id",
      id: "p-1",
    });
  });

  it("has no target without an id or for an entity with no page", () => {
    expect(auditEntityTarget({ entityType: "case", entityId: null, after: null })).toBeNull();
    expect(auditEntityTarget({ entityType: "payer", entityId: "pay-1", after: null })).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { completeTaskStep } from "./taskSteps";

const rpc = vi.fn();
const from = vi.fn();
const db = { rpc, from } as unknown as SupabaseClient<Database>;

function context(source: "panel" | "extension" = "panel") {
  return { db, orgId: "org-a", userId: "writer-a", source };
}

describe("completeTaskStep", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it.each(["panel", "extension"] as const)(
    "uses the same atomic RPC for the %s caller and maps its task row",
    async (source) => {
      rpc.mockResolvedValue({
        data: {
          kind: "ok",
          allDone: true,
          task: {
            id: "task-1",
            org_id: "org-a",
            case_id: null,
            sop_content: [{ id: "step-1", isCompleted: true }],
            status: "completed",
            completed_date: "2026-10-01",
          },
        },
        error: null,
      });

      const result = await completeTaskStep(context(source), "task-1", "step-1");

      expect(rpc).toHaveBeenCalledWith("complete_sop_task_step", {
        p_org_id: "org-a",
        p_task_id: "task-1",
        p_step_id: "step-1",
        p_actor_id: "writer-a",
        p_source: source,
      });
      expect(from).not.toHaveBeenCalled();
      expect(result).toEqual({
        kind: "ok",
        allDone: true,
        task: {
          id: "task-1",
          orgId: "org-a",
          caseId: null,
          sopContent: [{ id: "step-1", isCompleted: true }],
          status: "completed",
          completedDate: "2026-10-01",
        },
      });
    },
  );

  it.each([
    [403, "Your role cannot complete task steps"],
    [404, "Task not found"],
    [409, 'Complete "Upload W-9" first'],
    [422, "stepId is required"],
  ] as const)("preserves SQL rejection %s", async (status, message) => {
    rpc.mockResolvedValue({
      data: { kind: "rejected", status, message },
      error: null,
    });

    await expect(completeTaskStep(context("extension"), "task-1", "step-2")).resolves.toEqual({
      kind: "rejected",
      status,
      message,
    });
  });

  it("rejects blank step ids and missing actors before calling the database", async () => {
    await expect(completeTaskStep(context(), "task-1", "  ")).resolves.toMatchObject({
      kind: "rejected",
      status: 422,
    });
    await expect(
      completeTaskStep({ ...context(), userId: "" }, "task-1", "step-1"),
    ).resolves.toMatchObject({ kind: "rejected", status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces database failures without a second write path", async () => {
    const failure = new Error("transaction failed");
    rpc.mockResolvedValue({ data: null, error: failure });
    await expect(completeTaskStep(context(), "task-1", "step-1")).rejects.toBe(failure);
    expect(from).not.toHaveBeenCalled();
  });
});

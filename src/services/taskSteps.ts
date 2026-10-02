// Shared SOP step completion service used by the Panel task drawer and the
// extension's PATCH /api/tasks/:id/steps route. Both send the verified org,
// actor, and source to one row-locking RPC; task/case state and audit are
// committed together. The server supplies its service-role client only after
// JWT verification, and the RPC independently rechecks actor membership.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import type { Task } from "@/types";

export interface TaskStepServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
  source: "panel" | "extension";
}

export type CompleteTaskStepResult =
  | { kind: "ok"; task: Task; allDone: boolean }
  | { kind: "rejected"; status: 403 | 404 | 409 | 422; message: string };

/** Complete one ordered SOP step through the transaction shared by the Panel
 * and extension paths. The database locks the task, derives the rollup, updates
 * a termination case when applicable, and appends the audit row atomically. */
export async function completeTaskStep(
  ctx: TaskStepServiceCtx,
  taskId: string,
  stepId: string,
): Promise<CompleteTaskStepResult> {
  if (!stepId || typeof stepId !== "string" || stepId.trim() === "") {
    return { kind: "rejected", status: 422, message: "stepId is required" };
  }
  if (!ctx.userId) {
    return { kind: "rejected", status: 403, message: "An authenticated actor is required" };
  }

  const { data, error } = await ctx.db.rpc("complete_sop_task_step", {
    p_org_id: ctx.orgId,
    p_task_id: taskId,
    p_step_id: stepId,
    p_actor_id: ctx.userId,
    p_source: ctx.source,
  });
  if (error) throw error;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid complete_sop_task_step response");
  }
  const result = data as Record<string, unknown>;
  if (result.kind === "rejected") {
    const status = result.status;
    if (status !== 403 && status !== 404 && status !== 409 && status !== 422) {
      throw new Error("Invalid complete_sop_task_step rejection status");
    }
    return {
      kind: "rejected",
      status,
      message: typeof result.message === "string" ? result.message : "Step completion rejected",
    };
  }
  if (result.kind !== "ok" || !result.task || typeof result.task !== "object") {
    throw new Error("Invalid complete_sop_task_step result");
  }

  return {
    kind: "ok",
    task: camelizeRow<Task>(result.task),
    allDone: result.allDone === true,
  };
}

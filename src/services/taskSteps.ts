// S4.3 — the server-side SOP step tick, for the extension's Progress tab.
// PATCH /api/tasks/:id/steps is the ONE /api write that touches task state;
// everything else about a task still flows through the webapp.
//
// The order rule and the all-done rollup are NOT reimplemented here — they
// come from the pure `src/lib/sopStepCompletion.ts`, shared with the browser
// path (services/tasks.ts completeSOPStep). Two copies of "which step may be
// ticked" would drift the first time the rule changed.
//
// Isolation: the task must belong to the caller's resolved org, checked BEFORE
// any write (the gate's assertion 21). org_id and the actor come from the
// injected context, never the request body.
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AuditInput } from "@/lib/audit";
import { camelizeRow } from "@/lib/case";
import { planStepCompletion, stepCompletionPatch } from "@/lib/sopStepCompletion";
import type { SOPStep, Task } from "@/types";

export interface TaskStepServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
  writeAudit: (input: AuditInput) => Promise<void>;
}

export type CompleteTaskStepResult =
  | { kind: "ok"; task: Task; allDone: boolean }
  | { kind: "rejected"; status: 404 | 409 | 422; message: string };

/** Tick one SOP step complete on an org-owned task.
 *
 * A cross-org or nonexistent task id is a 404 (indistinguishable, by design).
 * A step that is blocked by an earlier incomplete step is a 409 naming the
 * blocker — the extension renders that verbatim rather than inventing its own
 * ordering rule. An already-complete step is a no-op success, so a retried
 * request converges instead of erroring. */
export async function completeTaskStep(
  ctx: TaskStepServiceCtx,
  taskId: string,
  stepId: string,
  nowIso: string,
): Promise<CompleteTaskStepResult> {
  if (!stepId || typeof stepId !== "string") {
    return { kind: "rejected", status: 422, message: "stepId is required" };
  }

  // Org membership check first — a task in another org is a 404 before any
  // write, mirroring every other case/task handler.
  const { data: existing, error: readErr } = await ctx.db
    .from("tasks")
    .select("id, org_id, status, sop_content, title, case_id")
    .eq("id", taskId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return { kind: "rejected", status: 404, message: "Task not found" };

  const row = existing as unknown as Record<string, unknown>;
  const steps: SOPStep[] = Array.isArray(row.sop_content) ? (row.sop_content as SOPStep[]) : [];

  // Idempotent: re-ticking a completed step returns the task unchanged rather
  // than a spurious error (the extension retries on a flaky connection).
  const already = steps.find((s) => s.id === stepId);
  if (already?.isCompleted) {
    const { data: fresh, error: freshErr } = await ctx.db
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("org_id", ctx.orgId)
      .single();
    if (freshErr) throw freshErr;
    const task = camelizeRow<Task>(fresh);
    return { kind: "ok", task, allDone: steps.every((s) => s.isCompleted) };
  }

  const plan = planStepCompletion(steps, stepId, ctx.userId, nowIso);
  if (!plan.ok) {
    return plan.reason === "not_found"
      ? { kind: "rejected", status: 404, message: "Step not found on task" }
      : { kind: "rejected", status: 409, message: `Complete "${plan.blockedBy}" first` };
  }

  const patch = stepCompletionPatch(plan, String(row.status ?? ""), nowIso);
  const { data, error } = await ctx.db
    .from("tasks")
    .update(patch as never)
    .eq("id", taskId)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();
  if (error) throw error;
  const task = camelizeRow<Task>(data);

  await ctx.writeAudit({
    actionType: "UPDATE",
    entityType: "task",
    entityId: taskId,
    before: { stepId, isCompleted: false },
    after: { stepId, isCompleted: true, taskStatus: task.status, source: "extension" },
    description: `Completed SOP step "${plan.nextSteps.find((s) => s.id === stepId)?.label ?? stepId}"`,
  });

  return { kind: "ok", task, allDone: plan.allDone };
}

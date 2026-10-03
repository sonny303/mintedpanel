// Tasks and SOP step completion. completeSOPStep enforces ordered completion:
// a step can only be marked complete when every lower-order step is done.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import {
  planAttachStepArtifact,
  planDetachStepArtifact,
  stepAttachmentPatch,
} from "@/lib/sopStepAttachments";
import { translateDbError } from "@/lib/dbErrors";
import { markPayerFormRemoved } from "@/lib/payerForms";
import { logNote } from "@/services/touches";
import { completeTaskStep } from "@/services/taskSteps";
import type { SOPStep, SOPStepAttachment, Task, TaskStatus } from "@/types";

export interface CaseTaskInput {
  caseId: string;
  providerId: string;
  title: string;
  description: string | null;
  sopContent: unknown;
  sortOrder: number;
  dueDate: string | null;
}

export async function createTasksForCase(inputs: CaseTaskInput[]): Promise<Task[]> {
  if (inputs.length === 0) return [];
  const orgId = requireActiveOrg();
  const caseId = inputs[0].caseId;
  const payload = inputs.map((t) => ({
    org_id: orgId,
    case_id: t.caseId,
    provider_id: t.providerId,
    title: t.title,
    description: t.description,
    sop_content: t.sopContent as never,
    status: "not_started" as const,
    sort_order: t.sortOrder,
    due_date: t.dueDate,
    is_auto_generated: true,
  }));
  const { data, error } = await supabase
    .from("tasks")
    .insert(payload as never)
    .select("*");
  // E0.10: tasks_owner_check rejects ownerless tasks — surface it friendly.
  if (error) throw translateDbError(error);
  const created = camelizeRow<Task[]>(data ?? []);
  await writeAudit({
    actionType: "CREATE",
    entityType: "task",
    entityId: caseId,
    after: { caseId, count: created.length, taskIds: created.map((t) => t.id) },
    description: `Auto-generated ${created.length} SOP task${created.length === 1 ? "" : "s"} for case`,
  });
  return created;
}

// A single follow-up task, created when a Fix-it card is skipped. Distinct from
// the SOP auto-generation path (createTasksForCase) — this is a human deferring
// one piece of data collection, audited as such.
export interface FollowUpTaskInput {
  caseId: string;
  providerId: string;
  title: string;
  dueDate: string | null;
}

export async function createFollowUpTask(input: FollowUpTaskInput): Promise<Task> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      org_id: orgId,
      case_id: input.caseId,
      provider_id: input.providerId,
      title: input.title,
      description: null,
      status: "not_started" as const,
      sort_order: 100,
      due_date: input.dueDate,
      is_auto_generated: false,
    } as never)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const task = camelizeRow<Task>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "task",
    entityId: task.id,
    after: { caseId: input.caseId, title: input.title, dueDate: input.dueDate },
    description: `Follow-up task created: ${input.title}`,
  });
  return task;
}

// E4.2 F4.2.6 / TE-13 — a provider-outreach task spawned per blocked provider
// from the generation preview (never auto-created silently). No case exists yet
// (the provider is gated), so case_id is null; the title is prefilled with the
// missing attributes and the task references the provider.
export interface ProviderOutreachTaskInput {
  providerId: string;
  title: string;
}

export async function createProviderOutreachTask(input: ProviderOutreachTaskInput): Promise<Task> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      org_id: orgId,
      case_id: null,
      provider_id: input.providerId,
      title: input.title,
      description: null,
      status: "not_started" as const,
      sort_order: 100,
      due_date: null,
      is_auto_generated: false,
    } as never)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const task = camelizeRow<Task>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "task",
    entityId: task.id,
    after: { providerId: input.providerId, title: input.title },
    description: `Provider outreach task created: ${input.title}`,
  });
  return task;
}

export interface TaskFilters {
  caseId?: string;
  status?: TaskStatus;
  dueBefore?: string;
  assignedTo?: string;
}

// sop_template_id/sop_version (E2.2) ride the list so the cases work view can
// derive "distinct stamped template ids per case" from the already-loaded
// cache. The revision token supports later SOP-content CAS writes without
// loading the full step body in this list query.
const TASK_LIST_COLUMNS =
  "id, case_id, provider_id, title, status, sort_order, due_date, completed_date, is_auto_generated, sop_template_id, sop_version, sop_content_revision, created_at, updated_at";

export async function getTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from("tasks")
    .select(TASK_LIST_COLUMNS)
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });
  if (filters.caseId) query = query.eq("case_id", filters.caseId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.dueBefore) query = query.lte("due_date", filters.dueBefore);
  // assignedTo isn't on tasks today; filter via cases when requested.
  if (filters.assignedTo) {
    const { data: caseRows, error: caseErr } = await supabase
      .from("credential_cases")
      .select("id")
      .eq("org_id", orgId)
      .eq("assigned_to", filters.assignedTo);
    if (caseErr) throw caseErr;
    const ids = (caseRows ?? []).map((r) => r.id as string);
    query = query.in("case_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<Task[]>(data ?? []);
}

export async function getTask(id: string): Promise<Task | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Task>(data) : null;
}

const TASK_SOP_CONTENT_CONFLICT = "Task changed while you were editing it. Reload and retry.";

async function updateTaskSopContentWithRevision(
  taskId: string,
  orgId: string,
  expectedRevision: number | undefined,
  patch: Record<string, unknown>,
): Promise<Task> {
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision)) {
    throw new Error("Task is missing its SOP content revision. Reload and retry.");
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(patch as never)
    .eq("id", taskId)
    .eq("org_id", orgId)
    .eq("sop_content_revision", expectedRevision)
    .select("*")
    .maybeSingle();
  if (error) throw translateDbError(error);
  if (!data) throw new Error(TASK_SOP_CONTENT_CONFLICT);
  return camelizeRow<Task>(data);
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  const orgId = requireActiveOrg();
  const before = await getTask(id);
  const patch: Record<string, unknown> = { status };
  if (status === "completed") {
    patch.completed_date = new Date().toISOString().slice(0, 10);
  } else {
    patch.completed_date = null;
  }
  const { data, error } = await supabase
    .from("tasks")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<Task>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "task",
    entityId: id,
    before: { status: before?.status ?? null },
    after: { status: after.status },
    description: `Task status set to ${after.status}`,
  });
  return after;
}

export async function completeSOPStep(taskId: string, stepId: string): Promise<Task> {
  const orgId = requireActiveOrg();
  const userId = currentUserId();
  if (!userId) throw new Error("An authenticated actor is required");
  const result = await completeTaskStep(
    { db: supabase, orgId, userId, source: "panel" },
    taskId,
    stepId,
  );
  if (result.kind === "rejected") throw new Error(result.message);
  return result.task;
}

// ASD (Active Submission Drawer) — attach/detach a vault document pointer on
// a step's requiredArtifacts checklist. Pure sop_content writes only: this
// NEVER touches task status/completed_date (D-ASD-6) and never touches
// provider_documents — the document itself is written separately via the
// documents service (upload) or is an existing vault row (attach-existing).
export async function attachStepArtifact(
  taskId: string,
  stepId: string,
  attachment: SOPStepAttachment,
): Promise<Task> {
  const orgId = requireActiveOrg();
  const existing = await getTask(taskId);
  if (!existing) throw new Error("Task not found");

  const currentSteps: SOPStep[] = Array.isArray(existing.sopContent) ? existing.sopContent : [];
  const plan = planAttachStepArtifact(currentSteps, stepId, attachment);
  if (!plan.ok) throw new Error("Step not found on task");
  const patch = stepAttachmentPatch(plan);

  const after = await updateTaskSopContentWithRevision(
    taskId,
    orgId,
    existing.sopContentRevision,
    patch,
  );

  await writeAudit({
    actionType: "UPDATE",
    entityType: "task",
    entityId: taskId,
    before: { stepId, attached: false },
    after: { stepId, documentId: attachment.documentId, fileName: attachment.fileName },
    description: `Attached "${attachment.fileName}" to step "${attachment.artifactName}"`,
  });
  return after;
}

export async function detachStepArtifact(
  taskId: string,
  stepId: string,
  documentId: string,
): Promise<Task> {
  const orgId = requireActiveOrg();
  const existing = await getTask(taskId);
  if (!existing) throw new Error("Task not found");

  const currentSteps: SOPStep[] = Array.isArray(existing.sopContent) ? existing.sopContent : [];
  const plan = planDetachStepArtifact(currentSteps, stepId, documentId);
  if (!plan.ok) {
    throw new Error(
      plan.reason === "step_not_found" ? "Step not found on task" : "Attachment not found on step",
    );
  }
  const detached = currentSteps
    .find((s) => s.id === stepId)
    ?.attachments?.find((a) => a.documentId === documentId);
  const patch = stepAttachmentPatch(plan);

  const after = await updateTaskSopContentWithRevision(
    taskId,
    orgId,
    existing.sopContentRevision,
    patch,
  );

  await writeAudit({
    actionType: "UPDATE",
    entityType: "task",
    entityId: taskId,
    before: { stepId, documentId, fileName: detached?.fileName ?? null },
    after: { stepId, attached: false },
    description: `Removed "${detached?.fileName ?? "a file"}" from step`,
  });
  return after;
}

// ---------------------------------------------------------------------------
// Payer PDF — the two case-side writes on a Payer PDF action.
// ---------------------------------------------------------------------------

/** "Mark sent": the coordinator has sent the payer's form with the application.
 *
 * Two effects, in this order: the touch FIRST, then the completion. The touch
 * is the durable record of the send — if the status write fails, the case still
 * shows that the form went out, whereas the reverse order could complete a task
 * with no evidence behind it.
 *
 * No status bump. Sending a payer form is often part of submitting, but this
 * write never moves the case: the case status control is the one place a
 * coordinator advances a case, and an implicit bump from a checklist item would
 * make the case status depend on which order the checklist was worked in.
 */
export async function markPayerFormSent(task: Task, formLabel: string): Promise<Task> {
  requireActiveOrg();
  if (task.caseId) {
    await logNote(task.caseId, {
      content: `Sent payer form: ${formLabel}`,
      taskId: task.id,
    });
  }
  return updateTaskStatus(task.id, "completed");
}

/** Remove a payer PDF from this case.
 *
 * The removal is APPENDED to the task's own sop_content (a `removedAt` marker
 * on the form pointer) and the row is set `blocked` — the task is never
 * deleted, so "who removed which payer form from this case, and when" survives
 * on the row itself. The checklist filters marked tasks out, which is what
 * makes the action disappear from the coordinator's view.
 *
 * Nothing re-adds it: payer forms are attached at generation, and a case is
 * generated once (a re-run lands in the skipped-existing bucket). Reapply
 * regenerates SOP tasks only.
 */
export async function removePayerFormFromCase(task: Task, reason: string | null): Promise<Task> {
  const orgId = requireActiveOrg();
  const existing = await getTask(task.id);
  if (!existing) throw new Error("Task not found");
  const nextSteps = markPayerFormRemoved(existing.sopContent, {
    removedAt: new Date().toISOString(),
    removedBy: currentUserId(),
    removedReason: reason,
  });
  const after = await updateTaskSopContentWithRevision(
    task.id,
    orgId,
    existing.sopContentRevision,
    {
      sop_content: nextSteps as never,
      status: "blocked" as const,
      completed_date: null,
    },
  );
  await writeAudit({
    actionType: "DELETE",
    entityType: "task",
    entityId: task.id,
    before: { status: existing.status },
    after: { status: after.status, removedReason: reason },
    description: `Payer form removed from case: ${task.title}`,
  });
  return after;
}

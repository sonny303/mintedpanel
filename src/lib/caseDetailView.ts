// Slice E (payer-and-cases screen 6) — the case-detail view's small pure
// derivations, kept out of the components so they are testable and shared:
// the task/step progress the single Tasks list renders (the step-at-a-time
// wizard is retired — one list, one drawer), the facility's full address line
// the Details card shows, and the header attribution sentence. No I/O.
import type { CaseStatusHistoryEntry, SOPStep, Task } from "@/types";
import type { CaseStatus } from "@/lib/caseStatus";

/** "1 of 4 done" + the soonest open due date, for the Tasks card header. */
export interface TaskListSummary {
  completed: number;
  total: number;
  /** ISO date of the earliest open task's due date, when any carries one. */
  nextDueDate: string | null;
}

export function summarizeTasks(tasks: readonly Task[]): TaskListSummary {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const dues = tasks
    .filter((t) => t.status !== "completed" && t.dueDate)
    .map((t) => t.dueDate as string)
    .sort();
  return { completed, total: tasks.length, nextDueDate: dues[0] ?? null };
}

/**
 * The CURRENT step: the first incomplete step of the first task that still has
 * one. The design gives exactly this step the "Open step" affordance — every
 * other step is context, and the drawer owns the actual work.
 */
export interface CurrentStepPointer {
  taskId: string;
  stepId: string;
}

export function currentStepPointer(tasks: readonly Task[]): CurrentStepPointer | null {
  for (const task of tasks) {
    if (task.status === "completed") continue;
    const step = (task.sopContent ?? []).find((s) => !s.isCompleted);
    if (step) return { taskId: task.id, stepId: step.id };
  }
  return null;
}

/** Ordered steps for display — the stored order wins; ties keep array order. */
export function orderedSteps(task: Task): SOPStep[] {
  return (task.sopContent ?? [])
    .map((step, index) => ({ step, index }))
    .sort((a, b) => (a.step.order ?? 0) - (b.step.order ?? 0) || a.index - b.index)
    .map((entry) => entry.step);
}

/** The facility line the Details card renders — name + full address (screen 6
 * asks for the address, not just the name). Missing parts are simply absent;
 * a facility-less case renders the em dash the caller supplies. */
export function facilityAddressLine(
  facility: {
    street?: string | null;
    suite?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null,
): string | null {
  if (!facility) return null;
  const street = [facility.street, facility.suite].filter((p) => (p ?? "").trim()).join(", ");
  const cityState = [facility.city, facility.state].filter((p) => (p ?? "").trim()).join(", ");
  const tail = [cityState, (facility.zip ?? "").trim()].filter(Boolean).join(" ");
  const line = [street, tail].filter(Boolean).join(" · ");
  return line || null;
}

/** One transition a touch was recorded as the evidence for. */
export interface EvidencedTransition {
  /** The case_status_history row id — the `#status-<id>` anchor to link to. */
  historyId: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
}

/**
 * The REVERSE of the status timeline's evidence link. The timeline already
 * points each transition at the touch that evidenced it (`#touch-<id>`); this
 * lets the touchlog row point back, so a touch that moved the case says so on
 * its own row instead of only being discoverable from the other panel.
 *
 * Keyed by touch id and derived from the FULL history, so a filtered touchlog
 * simply looks up fewer keys — never a marker computed against a visible
 * subset. A touch that evidenced nothing has no entry (callers render nothing).
 * Oldest transition first, so a touch cited by more than one reads in order.
 */
export function evidencedTransitionsByTouch(
  history: readonly CaseStatusHistoryEntry[] | undefined,
): Map<string, EvidencedTransition[]> {
  const byTouch = new Map<string, EvidencedTransition[]>();
  const ordered = [...(history ?? [])]
    .filter((h) => h.evidenceTouchId)
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt));
  for (const h of ordered) {
    const touchId = h.evidenceTouchId as string;
    const list = byTouch.get(touchId) ?? [];
    list.push({ historyId: h.id, fromStatus: h.fromStatus, toStatus: h.toStatus });
    byTouch.set(touchId, list);
  }
  return byTouch;
}

// E2.3 TE-2 — the next-best-action queue as a pure ranked reduction (the
// payerExpansion/enrollmentReadiness/generationPreview pattern): typed inputs
// assembled by the services/hook layer, no Supabase, no clock reads — `today`
// is always passed in and every comparison is date-only (ISO YYYY-MM-DD).
// The queue is fully DERIVED (the E1.0 derived-progress rule): no stored
// priority, no dirty flags, nothing written anywhere — every render recomputes
// from cases, tasks, deadline sources, and readiness.
//
// One entry per OPEN case (TE-3: open = credentialing status not in the
// action_bucket 'complete' bucket; status-less cases count as open — the
// GET /api/cases idiom, never label matching). The entry's deadline is the
// EARLIEST applicable signal among the TE-1 sources:
//
//   provider_start  providers.start_date; where null, the earliest future
//                   provider_facility_assignments.start_date stands in. A
//                   start date < today is history, not a deadline — it never
//                   ranks (TE-1).
//   launch_date     facilities.effective_date >= today on a facility
//                   reachable from the case (credential_cases.facility_id or
//                   the provider's assignments) — rank-if-present
//                   ([r4-review] Q8).
//   task_due        the earliest due_date among the case's non-completed
//                   tasks (overdue dues still rank — work deadlines don't
//                   expire, unlike start dates).
//   follow_up       the latest touchpoint's next_follow_up_date (the
//                   user-set date the team already records — TE-1's
//                   reconciliation rule).
//   cadence         SOP follow-up cadence (F2.3.3): the smallest
//                   followUpEveryDays among the case's tasks' stamped steps,
//                   counted from the last touchpoint — a case with no touch
//                   yet starts its cadence clock at the case's created_at.
//                   Notes/system events never reset the clock (only
//                   entry_type 'touchpoint' rows count). Cadence steps on
//                   COMPLETED tasks still drive the rhythm — completing
//                   "submit the application" is exactly when "call every 14
//                   days" starts mattering.
//
// Recredentialing deadlines are a named gap (TE-1): no schema models them in
// R4; they join the ranking when R9 lands ([r4-review] Q7).
//
// DETERMINISTIC ORDERING (the F2.3.1 documented tie order): entries with a
// deadline sort by date ascending; entries with no signal rank after ALL
// dated entries (the queue is total — nothing silently drops out). Ties break
// by case created_at (oldest first), then case id. When one case has two
// signals on the same date, the reported driving source is the first in
// DEADLINE_SOURCE_ORDER above.
//
// ACTION PRECEDENCE (TE-2/TE-5, documented): a red-readiness case surfaces
// its open gap as the action (advisory only — nothing is gated, E1.8's
// locked model); otherwise a follow_up/cadence-driven entry whose date has
// ARRIVED (<= today) renders a "touch due" action — recording a touchpoint
// pushes the cadence date out, so the touch-due entry re-derives away
// (F2.3.3's AC); otherwise the case's next actionable task (lowest
// sort_order non-completed); otherwise an honest "review" fallback.

import { fmtDate } from "@/lib/format";
import type { PayerPipelineState } from "@/lib/payerPipeline";

export type DeadlineSource =
  "provider_start" | "launch_date" | "task_due" | "follow_up" | "cadence";

/** Same-date tie order for the reported driving source (documented above). */
export const DEADLINE_SOURCE_ORDER: readonly DeadlineSource[] = [
  "provider_start",
  "launch_date",
  "task_due",
  "follow_up",
  "cadence",
];

export const DEADLINE_SOURCE_LABELS: Record<DeadlineSource, string> = {
  provider_start: "Provider start date",
  launch_date: "Location launch date",
  task_due: "Task due date",
  follow_up: "Follow-up date",
  cadence: "SOP follow-up cadence",
};

// ---------- inputs (assembled by services/hooks; no Supabase here) ----------

export interface QueueCaseInput {
  id: string;
  providerId: string;
  groupId: string | null;
  payerId: string;
  state: string;
  credentialingStatusId: string | null;
  facilityId: string | null;
  generationRunId: string | null;
  /** E4.0 TE-7 — the payer-pipeline state, rendered as a badge on the queue
   * distinct from internal task progress. Optional (older callers omit it). */
  payerPipelineState?: PayerPipelineState;
  createdAt: string;
}

export interface QueueStatusConfigInput {
  id: string;
  actionBucket: string;
}

export interface QueueTaskInput {
  caseId: string | null;
  title: string;
  /** "completed" closes a task; every other status counts as open. */
  status: string;
  sortOrder: number;
  dueDate: string | null;
  /** The smallest followUpEveryDays among the task's stamped SOP steps,
   * reduced at the service boundary (the jsonb never enters the queue). */
  cadenceDays: number | null;
}

export interface QueueTouchInput {
  caseId: string;
  /** Only 'touchpoint' rows count — a note or system_event never resets the
   * cadence clock (the touches.ts stalled/follow-up idiom, re-enforced here
   * so a wider input can never mis-derive). */
  entryType: string;
  touchDate: string;
  nextFollowUpDate: string | null;
}

export interface QueueProviderInput {
  id: string;
  name: string;
  startDate: string | null;
}

export interface QueueAssignmentInput {
  providerId: string | null;
  facilityId: string | null;
  startDate: string | null;
}

export interface QueueFacilityInput {
  id: string;
  name: string;
  effectiveDate: string | null;
}

export interface QueueLookupInput {
  id: string;
  name: string;
}

/** One E1.8 readiness row reduced to its open-gap labels, joined by the
 * 4-part case key (TE-5 — the evaluator itself is never re-implemented). */
export interface QueueReadinessInput {
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  openGapLabels: readonly string[];
}

export interface NextBestActionsInput {
  /** Date-only ISO string (YYYY-MM-DD); never read a clock inside. */
  today: string;
  cases: readonly QueueCaseInput[];
  statusConfigs: readonly QueueStatusConfigInput[];
  tasks: readonly QueueTaskInput[];
  touches: readonly QueueTouchInput[];
  providers: readonly QueueProviderInput[];
  facilityAssignments: readonly QueueAssignmentInput[];
  facilities: readonly QueueFacilityInput[];
  groups: readonly QueueLookupInput[];
  payers: readonly QueueLookupInput[];
  readiness: readonly QueueReadinessInput[];
}

// ---------- output ----------

export type QueueActionKind = "task" | "touch_due" | "readiness_gap" | "review";

export interface QueueDeadline {
  date: string;
  source: DeadlineSource;
  /** date < today — the UI's only license for a destructive tint (TE-9). */
  overdue: boolean;
}

export interface QueueEntry {
  caseId: string;
  providerId: string;
  providerName: string;
  groupName: string;
  payerName: string;
  state: string;
  generationRunId: string | null;
  /** E4.0 TE-7 — the payer-pipeline state for the queue badge (may be absent). */
  payerPipelineState?: PayerPipelineState;
  actionKind: QueueActionKind;
  action: string;
  /** null = no deadline signal at all; the entry ranks after dated work. */
  deadline: QueueDeadline | null;
  /** Human-readable "why this is next" (F2.3.1) — the E2.0 reason pattern. */
  reason: string;
}

// ---------- date-only helpers ----------

/** ISO date + n days, via UTC midnights — no TZ drift (the E1.8 idiom). */
export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const onOrAfter = (date: string, today: string) => date.slice(0, 10) >= today;

// ---------- derivation ----------

interface DeadlineSignal {
  date: string;
  source: DeadlineSource;
  reason: string;
}

const sourceRank = (s: DeadlineSource) => DEADLINE_SOURCE_ORDER.indexOf(s);

/** Derive the ordered queue: one entry per open case, ranked by the earliest
 * applicable deadline, each with its action and derivation reason. */
export function buildNextBestActions(input: NextBestActionsInput): QueueEntry[] {
  const bucketByStatusId = new Map(input.statusConfigs.map((s) => [s.id, s.actionBucket]));
  const providerById = new Map(input.providers.map((p) => [p.id, p]));
  const groupNameById = new Map(input.groups.map((g) => [g.id, g.name]));
  const payerNameById = new Map(input.payers.map((p) => [p.id, p.name]));
  const facilityById = new Map(input.facilities.map((f) => [f.id, f]));

  // Open (non-completed) tasks per case, ordered by sort_order then due date —
  // the "next actionable task" rule; plus the case-wide minimum cadence across
  // ALL tasks (completed included — see the module docstring).
  const openTasksByCase = new Map<string, QueueTaskInput[]>();
  const minCadenceByCase = new Map<string, number>();
  for (const t of input.tasks) {
    if (!t.caseId) continue;
    if (t.cadenceDays !== null && t.cadenceDays > 0) {
      const prior = minCadenceByCase.get(t.caseId);
      if (prior === undefined || t.cadenceDays < prior) {
        minCadenceByCase.set(t.caseId, t.cadenceDays);
      }
    }
    if (t.status === "completed") continue;
    const list = openTasksByCase.get(t.caseId) ?? [];
    list.push(t);
    openTasksByCase.set(t.caseId, list);
  }
  for (const list of openTasksByCase.values()) {
    list.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    );
  }

  // Latest touchpoint per case (touch date + the explicit follow-up date it
  // carries). Notes and system events are filtered out here by rule.
  const latestTouchByCase = new Map<string, QueueTouchInput>();
  for (const t of input.touches) {
    if (t.entryType !== "touchpoint") continue;
    const prior = latestTouchByCase.get(t.caseId);
    if (!prior || t.touchDate.slice(0, 10) > prior.touchDate.slice(0, 10)) {
      latestTouchByCase.set(t.caseId, t);
    }
  }

  // Provider-start signal (TE-1): start_date when set; the earliest future
  // assignment start date stands in ONLY where the provider-level date is
  // null. Computed once per provider.
  const futureAssignmentStartByProvider = new Map<string, string>();
  for (const a of input.facilityAssignments) {
    if (!a.providerId || !a.startDate) continue;
    const date = a.startDate.slice(0, 10);
    if (!onOrAfter(date, input.today)) continue;
    const prior = futureAssignmentStartByProvider.get(a.providerId);
    if (!prior || date < prior) futureAssignmentStartByProvider.set(a.providerId, date);
  }

  // Reachable-facility index for the launch-date signal.
  const facilityIdsByProvider = new Map<string, Set<string>>();
  for (const a of input.facilityAssignments) {
    if (!a.providerId || !a.facilityId) continue;
    if (!facilityIdsByProvider.has(a.providerId)) {
      facilityIdsByProvider.set(a.providerId, new Set());
    }
    facilityIdsByProvider.get(a.providerId)?.add(a.facilityId);
  }

  const readinessByKey = new Map(
    input.readiness.map((r) => [`${r.providerId}|${r.groupId}|${r.payerId}|${r.state}`, r]),
  );

  const entries: Array<QueueEntry & { createdAt: string }> = [];

  for (const c of input.cases) {
    // TE-3: open = not in the 'complete' bucket; status-less counts as open.
    const bucket = c.credentialingStatusId
      ? (bucketByStatusId.get(c.credentialingStatusId) ?? null)
      : null;
    if (bucket === "complete") continue;

    const provider = providerById.get(c.providerId);
    const providerName = provider?.name ?? "Unknown provider";
    const payerName = payerNameById.get(c.payerId) ?? "Unknown payer";
    const groupName = c.groupId ? (groupNameById.get(c.groupId) ?? "Unknown group") : "No group";
    const openTasks = openTasksByCase.get(c.id) ?? [];
    const latestTouch = latestTouchByCase.get(c.id) ?? null;

    const signals: DeadlineSignal[] = [];

    // provider_start
    if (provider) {
      const providerStart = provider.startDate
        ? onOrAfter(provider.startDate, input.today)
          ? provider.startDate.slice(0, 10)
          : null
        : (futureAssignmentStartByProvider.get(provider.id) ?? null);
      if (providerStart) {
        signals.push({
          date: providerStart,
          source: "provider_start",
          reason: `${providerName} starts seeing patients ${fmtDate(providerStart)} — ranked by the provider start date.`,
        });
      }
    }

    // launch_date — facilities reachable via the case link or the provider's
    // assignments; only a future-dated effective date is a deadline.
    const reachable = new Set<string>(facilityIdsByProvider.get(c.providerId) ?? []);
    if (c.facilityId) reachable.add(c.facilityId);
    let launch: { date: string; name: string } | null = null;
    for (const facilityId of reachable) {
      const facility = facilityById.get(facilityId);
      if (!facility?.effectiveDate) continue;
      const date = facility.effectiveDate.slice(0, 10);
      if (!onOrAfter(date, input.today)) continue;
      if (!launch || date < launch.date) launch = { date, name: facility.name };
    }
    if (launch) {
      signals.push({
        date: launch.date,
        source: "launch_date",
        reason: `${launch.name} launches ${fmtDate(launch.date)} — ranked by the location launch date.`,
      });
    }

    // task_due — the earliest due date among the case's open tasks.
    let due: { date: string; title: string } | null = null;
    for (const t of openTasks) {
      if (!t.dueDate) continue;
      const date = t.dueDate.slice(0, 10);
      if (!due || date < due.date) due = { date, title: t.title };
    }
    if (due) {
      signals.push({
        date: due.date,
        source: "task_due",
        reason: `“${due.title}” is due ${fmtDate(due.date)} — ranked by the earliest task due date.`,
      });
    }

    // follow_up — the explicit date the team recorded on the last touch.
    if (latestTouch?.nextFollowUpDate) {
      const date = latestTouch.nextFollowUpDate.slice(0, 10);
      signals.push({
        date,
        source: "follow_up",
        reason: `Follow-up recorded for ${fmtDate(date)} on the last touch — ranked by the follow-up date.`,
      });
    }

    // cadence — SOP follow-up rhythm from the stamped steps (F2.3.3).
    const cadence = minCadenceByCase.get(c.id);
    if (cadence !== undefined) {
      const base = latestTouch ? latestTouch.touchDate.slice(0, 10) : c.createdAt.slice(0, 10);
      const date = addDaysIso(base, cadence);
      signals.push({
        date,
        source: "cadence",
        reason: `SOP cadence says touch every ${cadence} days; ${
          latestTouch
            ? `last touch ${fmtDate(base)}`
            : `no touch yet — counting from case creation ${fmtDate(base)}`
        } — touch due ${fmtDate(date)}.`,
      });
    }

    // Driving signal: earliest date; same-date ties by DEADLINE_SOURCE_ORDER.
    signals.sort(
      (a, b) => a.date.localeCompare(b.date) || sourceRank(a.source) - sourceRank(b.source),
    );
    const driving = signals[0] ?? null;

    // Action precedence (documented above): readiness gap → touch due → next
    // actionable task → honest review fallback.
    const readiness = c.groupId
      ? readinessByKey.get(`${c.providerId}|${c.groupId}|${c.payerId}|${c.state}`)
      : undefined;
    const gaps = readiness?.openGapLabels ?? [];
    let actionKind: QueueActionKind;
    let action: string;
    if (gaps.length > 0) {
      actionKind = "readiness_gap";
      action = `Resolve readiness gap: ${gaps[0]}${gaps.length > 1 ? ` (+${gaps.length - 1} more)` : ""}`;
    } else if (
      driving &&
      (driving.source === "follow_up" || driving.source === "cadence") &&
      driving.date <= input.today
    ) {
      actionKind = "touch_due";
      action = `Touch due — follow up with ${payerName}`;
    } else if (openTasks.length > 0) {
      actionKind = "task";
      action = openTasks[0].title;
    } else {
      actionKind = "review";
      action = "Review case — no open tasks";
    }

    entries.push({
      caseId: c.id,
      providerId: c.providerId,
      providerName,
      groupName,
      payerName,
      state: c.state,
      generationRunId: c.generationRunId ?? null,
      payerPipelineState: c.payerPipelineState,
      actionKind,
      action,
      deadline: driving
        ? { date: driving.date, source: driving.source, overdue: driving.date < input.today }
        : null,
      reason: driving?.reason ?? "No deadline signal on this case — ranked after dated work.",
      createdAt: c.createdAt,
    });
  }

  // Total order: dated entries by deadline ascending, undated after all dated;
  // ties by case created_at (oldest first), then case id.
  entries.sort((a, b) => {
    if (a.deadline && b.deadline) {
      const byDate = a.deadline.date.localeCompare(b.deadline.date);
      if (byDate !== 0) return byDate;
    } else if (a.deadline !== b.deadline) {
      return a.deadline ? -1 : 1;
    }
    return a.createdAt.localeCompare(b.createdAt) || a.caseId.localeCompare(b.caseId);
  });

  return entries.map(({ createdAt: _createdAt, ...entry }) => entry);
}

/** F2.3.2 — the batch view is the SAME derivation filtered by run id; the
 * filter is URL-state (?run=<uuid>), never component state. */
export function filterQueueToRun(
  entries: readonly QueueEntry[],
  runId: string | undefined,
): QueueEntry[] {
  if (!runId) return [...entries];
  return entries.filter((e) => e.generationRunId === runId);
}

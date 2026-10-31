// MINT-108 — the daily coordinator follow-up digest: the pure rules. The job
// that reads the rows and sends the emails is src/server/jobs/followupDigestRun.ts;
// the email body is `followup_digest_daily` in src/server/email/templates.ts,
// which renders FollowUpDigestEmailData below.
//
// What is listed. Open cases only (OPEN_CASE_STATUSES). A case's follow-up is
// the carry-forward reducer's active follow-up over its touchpoints
// (resolveActiveFollowUp), and its status is followUpStatus against `today`.
// Overdue and due-today follow-ups are listed; upcoming ones are not.
//
// "Today" is a UTC calendar date (YYYY-MM-DD) the caller passes in: the
// schema has no organization time zone, and the job runs once per UTC day
// (its run key). No clock read here.
//
// At risk. A listed case is flagged when it is waiting on the payer
// (`submitted` or `in_review`, the statuses billing readiness estimates a
// decision date for), its `submitted_date` is on or before today, the payer's
// `avg_decision_days` is a positive whole number, and the whole days since
// submission exceed it. A null `avg_decision_days` means no flag.
//
// Who gets what.
//   * A coordinator is a current member assigned (credential_cases.assigned_to)
//     to at least one open case. Their digest lists their own rows.
//   * The step's cc list, resolved in order: a user who is still a member,
//     and every member holding a listed role. A cc'd user who is no longer a
//     member is dropped and counted.
//   * A cc'd member's digest adds the Unassigned rows (no coordinator, or a
//     coordinator who is no longer a member) and one line per coordinator
//     with that coordinator's counts. That is the "copy" a cc'd member gets:
//     one email a day, not a copy of every coordinator's email, and no other
//     coordinator's case rows.
//   * With no cc recipient, Unassigned rows reach no one; they are counted.
//   * A recipient with nothing to show gets no email (suppressed).
//
// What an email may carry: the case number and link, the provider's display
// name, the payer's name, the follow-up date and status, and the at-risk days.
// Never a touch note, an SSN, a date of birth or document contents: those are
// not in the inputs below.
import type { NotificationCcRecipient } from "@/types";
import { isCaseStatus, isOpenCaseStatus } from "./caseStatus";
import { followUpStatus, resolveActiveFollowUp, type FollowUpTouch } from "./followUps";

/** The longest list one section shows; the rest are counted as "more". */
export const MAX_DIGEST_SECTION_ROWS = 100;

/** The statuses that wait on a payer decision, as in billing readiness. */
export const AWAITING_DECISION_STATUSES: readonly string[] = ["submitted", "in_review"];

export type DigestFollowUpStatus = "overdue" | "due_today";

/** One open-or-closed case as the job reads it. Names are display-ready. */
export interface DigestCase {
  id: string;
  caseNumber: number;
  assignedTo: string | null;
  caseStatus: string;
  submittedDate: string | null;
  providerName: string;
  payerName: string;
  avgDecisionDays: number | null;
}

/** A touchpoint's follow-up fields, with its case. */
export interface DigestTouchpoint extends FollowUpTouch {
  caseId: string;
}

/** A current member of the org. */
export interface DigestMember {
  userId: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
}

export interface FollowUpDigestAtRisk {
  daysSinceSubmission: number;
  avgDecisionDays: number;
}

export interface FollowUpDigestRow {
  caseNumber: number;
  caseLink: string;
  providerName: string;
  payerName: string;
  /** YYYY-MM-DD */
  dueDate: string;
  status: DigestFollowUpStatus;
  atRisk: FollowUpDigestAtRisk | null;
}

export interface FollowUpDigestSection {
  /** At most MAX_DIGEST_SECTION_ROWS, overdue first, oldest first. */
  rows: FollowUpDigestRow[];
  /** Rows beyond the cap. */
  more: number;
  /** Counted over every row, shown or not. */
  overdue: number;
  dueToday: number;
  atRisk: number;
}

export interface FollowUpDigestTeamRow {
  coordinatorName: string;
  overdue: number;
  dueToday: number;
  atRisk: number;
}

/** What the followup_digest_daily email renders. */
export interface FollowUpDigestEmailData {
  practiceName: string;
  recipientFirstName: string | null;
  /** The UTC day the digest is for, YYYY-MM-DD. */
  digestDate: string;
  workQueueLink: string;
  /** The recipient's own cases. */
  own: FollowUpDigestSection;
  /** cc'd members only; empty for everyone else. */
  unassigned: FollowUpDigestSection;
  /** cc'd members only: one line per coordinator with something due. */
  team: FollowUpDigestTeamRow[];
}

export interface PlannedDigest {
  recipientUserId: string;
  /** From the member's profile; the sender checks it before sending. */
  email: string | null;
  data: FollowUpDigestEmailData;
}

export interface FollowUpDigestPlan {
  /** One per recipient with something to show, coordinators first. */
  digests: PlannedDigest[];
  /** Recipients with nothing due: no email. */
  suppressed: number;
  /** cc'd users who are no longer members. */
  ccMembersDropped: number;
  /** Unassigned follow-ups that reach no one because no one is cc'd. */
  unassignedUnrouted: number;
}

export interface FollowUpDigestPlanInput {
  practiceName: string;
  /** YYYY-MM-DD, UTC. */
  today: string;
  /** A bare origin such as https://app.example.com. */
  appBaseUrl: string;
  cases: readonly DigestCase[];
  touchpoints: readonly DigestTouchpoint[];
  members: readonly DigestMember[];
  ccRecipients: readonly NotificationCcRecipient[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Whole UTC days since the epoch for a YYYY-MM-DD calendar date, else null. */
function utcDayNumber(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  if (!ISO_DATE.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const time = Date.UTC(y, m - 1, d);
  const check = new Date(time);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return time / DAY_MS;
}

function requireDay(iso: string): number {
  const day = utcDayNumber(iso);
  if (day === null || iso.length !== 10) {
    throw new RangeError(`Expected a YYYY-MM-DD date, got "${iso}"`);
  }
  return day;
}

/**
 * The at-risk flag for a case, or null. See the header for the rule. Day
 * counts are whole UTC calendar days between two dates.
 */
export function caseAtRisk(
  c: Pick<DigestCase, "caseStatus" | "submittedDate" | "avgDecisionDays">,
  today: string,
): FollowUpDigestAtRisk | null {
  const now = requireDay(today);
  if (!AWAITING_DECISION_STATUSES.includes(c.caseStatus)) return null;
  const avg = c.avgDecisionDays;
  if (avg === null || !Number.isSafeInteger(avg) || avg <= 0) return null;
  const submitted = utcDayNumber(c.submittedDate);
  if (submitted === null || submitted > now) return null;
  const days = now - submitted;
  return days > avg ? { daysSinceSubmission: days, avgDecisionDays: avg } : null;
}

export interface DueFollowUp {
  dueDate: string;
  status: DigestFollowUpStatus;
}

/**
 * The open cases whose active follow-up is overdue or due today, by case id.
 * Closed cases, upcoming follow-ups and cases with none are left out.
 */
export function dueFollowUps(
  cases: readonly Pick<DigestCase, "id" | "caseStatus">[],
  touchpoints: readonly DigestTouchpoint[],
  today: string,
): Map<string, DueFollowUp> {
  requireDay(today);
  const open = new Set(
    cases
      .filter((c) => isCaseStatus(c.caseStatus) && isOpenCaseStatus(c.caseStatus))
      .map((c) => c.id),
  );
  const byCase = new Map<string, FollowUpTouch[]>();
  for (const t of touchpoints) {
    if (!open.has(t.caseId)) continue;
    const list = byCase.get(t.caseId) ?? [];
    list.push({
      id: t.id,
      touchDate: t.touchDate.slice(0, 10),
      createdAt: t.createdAt,
      nextFollowUpDate: t.nextFollowUpDate ? t.nextFollowUpDate.slice(0, 10) : null,
      clearsFollowUp: t.clearsFollowUp,
    });
    byCase.set(t.caseId, list);
  }
  const due = new Map<string, DueFollowUp>();
  for (const [caseId, list] of byCase) {
    const active = resolveActiveFollowUp(list);
    if (!active) continue;
    const status = followUpStatus(active.date, today);
    if (status === "overdue" || status === "due_today") {
      due.set(caseId, { dueDate: active.date, status });
    }
  }
  return due;
}

/** A staff member's name for the team summary. */
export function memberDisplayName(member: DigestMember): string {
  const composed = [member.firstName, member.lastName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return composed || member.fullName?.trim() || member.email?.trim() || "Unnamed member";
}

export interface ResolvedCc {
  /** Current members, in cc order, each once. */
  userIds: string[];
  /** cc'd users who are no longer members. */
  droppedFormerMembers: number;
}

/**
 * The step's cc list as current members, in order. A role expands to every
 * member holding it, in member order. Membership is re-checked here, at send
 * time: it can lapse after the step was saved.
 */
export function resolveDigestCc(
  cc: readonly NotificationCcRecipient[],
  members: readonly DigestMember[],
): ResolvedCc {
  const memberIds = new Set(members.map((m) => m.userId));
  const seen = new Set<string>();
  const userIds: string[] = [];
  let droppedFormerMembers = 0;
  const add = (userId: string) => {
    if (seen.has(userId)) return;
    seen.add(userId);
    userIds.push(userId);
  };
  for (const recipient of cc) {
    if (recipient.kind === "user") {
      if (memberIds.has(recipient.userId)) add(recipient.userId);
      else droppedFormerMembers += 1;
    } else {
      for (const member of members) if (member.role === recipient.role) add(member.userId);
    }
  }
  return { userIds, droppedFormerMembers };
}

function compareRows(a: FollowUpDigestRow, b: FollowUpDigestRow): number {
  if (a.status !== b.status) return a.status === "overdue" ? -1 : 1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.caseNumber - b.caseNumber;
}

const EMPTY_SECTION: FollowUpDigestSection = {
  rows: [],
  more: 0,
  overdue: 0,
  dueToday: 0,
  atRisk: 0,
};

function buildSection(rows: readonly FollowUpDigestRow[]): FollowUpDigestSection {
  if (rows.length === 0) return EMPTY_SECTION;
  const sorted = [...rows].sort(compareRows);
  return {
    rows: sorted.slice(0, MAX_DIGEST_SECTION_ROWS),
    more: Math.max(0, sorted.length - MAX_DIGEST_SECTION_ROWS),
    overdue: sorted.filter((r) => r.status === "overdue").length,
    dueToday: sorted.filter((r) => r.status === "due_today").length,
    atRisk: sorted.filter((r) => r.atRisk !== null).length,
  };
}

function sectionIsEmpty(section: FollowUpDigestSection): boolean {
  return section.overdue + section.dueToday === 0;
}

/** Every digest to send for one org on one day, and what was held back. */
export function planFollowUpDigests(input: FollowUpDigestPlanInput): FollowUpDigestPlan {
  const { today, appBaseUrl } = input;
  const due = dueFollowUps(input.cases, input.touchpoints, today);
  const memberById = new Map(input.members.map((m) => [m.userId, m]));

  const rowsByCoordinator = new Map<string, FollowUpDigestRow[]>();
  const unassignedRows: FollowUpDigestRow[] = [];
  const coordinatorIds = new Set<string>();
  for (const c of input.cases) {
    if (!isCaseStatus(c.caseStatus) || !isOpenCaseStatus(c.caseStatus)) continue;
    const owner = c.assignedTo !== null && memberById.has(c.assignedTo) ? c.assignedTo : null;
    if (owner) coordinatorIds.add(owner);
    const followUp = due.get(c.id);
    if (!followUp) continue;
    const row: FollowUpDigestRow = {
      caseNumber: c.caseNumber,
      caseLink: `${appBaseUrl}/cases/${encodeURIComponent(c.id)}`,
      providerName: c.providerName,
      payerName: c.payerName,
      dueDate: followUp.dueDate,
      status: followUp.status,
      atRisk: caseAtRisk(c, today),
    };
    if (owner) {
      const list = rowsByCoordinator.get(owner) ?? [];
      list.push(row);
      rowsByCoordinator.set(owner, list);
    } else {
      unassignedRows.push(row);
    }
  }

  const cc = resolveDigestCc(input.ccRecipients, input.members);
  const ccIds = new Set(cc.userIds);
  const unassigned = buildSection(unassignedRows);

  const team: FollowUpDigestTeamRow[] = [...rowsByCoordinator.entries()]
    .map(([userId, rows]) => {
      const section = buildSection(rows);
      const member = memberById.get(userId) as DigestMember;
      return {
        userId,
        coordinatorName: memberDisplayName(member),
        overdue: section.overdue,
        dueToday: section.dueToday,
        atRisk: section.atRisk,
      };
    })
    .sort(
      (a, b) =>
        a.coordinatorName.localeCompare(b.coordinatorName) || a.userId.localeCompare(b.userId),
    )
    .map(({ userId: _userId, ...row }) => row);

  const recipientIds: string[] = [];
  for (const member of input.members) {
    if (coordinatorIds.has(member.userId)) recipientIds.push(member.userId);
  }
  for (const userId of cc.userIds) if (!coordinatorIds.has(userId)) recipientIds.push(userId);

  const digests: PlannedDigest[] = [];
  let suppressed = 0;
  for (const userId of recipientIds) {
    const member = memberById.get(userId) as DigestMember;
    const isCc = ccIds.has(userId);
    const own = buildSection(rowsByCoordinator.get(userId) ?? []);
    const data: FollowUpDigestEmailData = {
      practiceName: input.practiceName,
      recipientFirstName: member.firstName?.trim() || null,
      digestDate: today,
      workQueueLink: `${appBaseUrl}/work`,
      own,
      unassigned: isCc ? unassigned : EMPTY_SECTION,
      team: isCc ? team : [],
    };
    if (sectionIsEmpty(data.own) && sectionIsEmpty(data.unassigned) && data.team.length === 0) {
      suppressed += 1;
      continue;
    }
    digests.push({ recipientUserId: userId, email: member.email, data });
  }

  return {
    digests,
    suppressed,
    ccMembersDropped: cc.droppedFormerMembers,
    unassignedUnrouted: cc.userIds.length === 0 ? unassignedRows.length : 0,
  };
}

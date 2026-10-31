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
// When it goes out, and what "today" is (digestSlot). The job is called
// every hour. An org's digest is due once the wall clock in its effective time zone
// reaches its effective send hour (both platform-managed, resolved by
// resolveNotificationSequence). "At or after" the hour, so a missed or failed
// run catches up later the same local day; never before it. "Today" is the
// org's local date at the run, and that date is the digest's slot: the
// per-recipient send claim and the org's completion record both key on it,
// so a rerun, a changed hour or a changed zone cannot send a second digest
// for the same local date. The hour is read off the zone's wall clock at the
// run's instant, so a repeated hour (DST ends) stays the same local date, and
// a skipped hour (DST starts) is caught by "at or after". No clock read here:
// `now` is passed in.
//
// Two edges follow from keying on the local date. A send hour of 23 is due in
// one hourly call only, so it gets one attempt a day (keep it at 21 or
// earlier). And a zone change moves the local date with it: moving an org
// west across the date line (Honolulu to Tokyo) can skip a date, and moving
// it east can send a digest for an earlier date hours after the last.
//
// No at-risk flag (Sowmya, Oct 30). `payers.avg_decision_days` has no writer
// yet, so a flag built on it would rarely fire and could not be trusted. It
// returns once MINT-111 ("decision time from closed cases") gives payers a
// real decision time.
//
// Who gets what. Coordinators only (Sowmya, Oct 30; the digest has no cc list
// since MINT-107).
//   * A coordinator is a current member assigned (credential_cases.assigned_to)
//     to at least one open case. Each gets one email with their own rows.
//   * An unassigned follow-up (no coordinator, or a coordinator who is no
//     longer a member) goes to no one. The plan counts it; no row is built.
//   * A coordinator with nothing due gets no email (suppressed).
//
// What an email may carry: the case number and link, the provider's display
// name, the payer's name, and the follow-up date and status. Never a touch
// note, an SSN, a date of birth or document contents: those are not in the
// inputs below.
import { isCaseStatus, isOpenCaseStatus } from "./caseStatus";
import { followUpStatus, resolveActiveFollowUp, type FollowUpTouch } from "./followUps";
import { isIanaTimeZone } from "./notificationSequences";

/** The longest list one digest shows; the rest are counted as "more". */
export const MAX_DIGEST_SECTION_ROWS = 100;

export type DigestFollowUpStatus = "overdue" | "due_today";

/** One case as the job reads it. Names are display-ready. */
export interface DigestCase {
  id: string;
  caseNumber: number;
  assignedTo: string | null;
  caseStatus: string;
  providerName: string;
  payerName: string;
}

/** A touchpoint's follow-up fields, with its case. */
export interface DigestTouchpoint extends FollowUpTouch {
  caseId: string;
}

/** A current member of the org. */
export interface DigestMember {
  userId: string;
  firstName: string | null;
  email: string | null;
}

export interface FollowUpDigestRow {
  caseNumber: number;
  caseLink: string;
  providerName: string;
  payerName: string;
  /** YYYY-MM-DD */
  dueDate: string;
  status: DigestFollowUpStatus;
}

export interface FollowUpDigestSection {
  /** At most MAX_DIGEST_SECTION_ROWS, overdue first, oldest first. */
  rows: FollowUpDigestRow[];
  /** Rows beyond the cap. */
  more: number;
  /** Counted over every row, shown or not. */
  overdue: number;
  dueToday: number;
}

/** What the followup_digest_daily email renders: one coordinator's own rows. */
export interface FollowUpDigestEmailData {
  practiceName: string;
  recipientFirstName: string | null;
  /** The org's local date the digest is for, YYYY-MM-DD. */
  digestDate: string;
  workQueueLink: string;
  followUps: FollowUpDigestSection;
}

export interface PlannedDigest {
  recipientUserId: string;
  /** From the member's profile; the sender checks it before sending. */
  email: string | null;
  data: FollowUpDigestEmailData;
}

export interface FollowUpDigestPlan {
  /** One per coordinator with something due, in member order. */
  digests: PlannedDigest[];
  /** Coordinators with nothing due: no email. */
  suppressed: number;
  /** Overdue or due-today follow-ups on unassigned cases: sent to no one. */
  unassignedFollowUps: number;
}

export interface FollowUpDigestPlanInput {
  practiceName: string;
  /** The org's local date, YYYY-MM-DD (digestSlot). */
  today: string;
  /** A bare origin such as https://app.example.com. */
  appBaseUrl: string;
  cases: readonly DigestCase[];
  touchpoints: readonly DigestTouchpoint[];
  members: readonly DigestMember[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function requireDay(iso: string): void {
  if (!isCalendarDate(iso)) throw new RangeError(`Expected a YYYY-MM-DD date, got "${iso}"`);
}

/* ------------------------------ When it goes out ----------------------------- */

export interface ZonedDateHour {
  /** The wall-clock date in the zone, YYYY-MM-DD. */
  date: string;
  /** The wall-clock hour in the zone, 0 to 23. */
  hour: number;
}

/**
 * The wall-clock date and hour of `now` in an IANA time zone. Throws a
 * RangeError for a zone this runtime cannot format in.
 */
export function zonedDateHour(now: Date, timeZone: string): ZonedDateHour {
  if (!isIanaTimeZone(timeZone)) throw new RangeError(`"${timeZone}" is not a usable time zone`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  // Some engines spell midnight "24" even with h23.
  const hour = Number(part("hour")) % 24;
  if (!isCalendarDate(date) || !Number.isInteger(hour)) {
    throw new RangeError(`Could not read the wall clock in "${timeZone}"`);
  }
  return { date, hour };
}

export interface DigestSlot {
  /** True once the local hour is at or after the send hour. */
  due: boolean;
  /** The org's local date: the digest's "today" and its once-a-day slot. */
  localDate: string;
  localHour: number;
}

/**
 * Whether an org's digest is due at `now`, and for which local date. Pass the
 * effective send time (resolveNotificationSequence). Null when it is unusable:
 * no hour, an hour outside 0 to 23, or a zone this runtime cannot format in.
 */
export function digestSlot(
  sendTime: { sendHour: number | null; sendTimeZone: string | null },
  now: Date,
): DigestSlot | null {
  const { sendHour, sendTimeZone } = sendTime;
  if (sendHour === null || !Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23) {
    return null;
  }
  if (!sendTimeZone || !isIanaTimeZone(sendTimeZone)) return null;
  let local: ZonedDateHour;
  try {
    local = zonedDateHour(now, sendTimeZone);
  } catch {
    return null;
  }
  return { due: local.hour >= sendHour, localDate: local.date, localHour: local.hour };
}

/* -------------------------------- What is listed ------------------------------ */

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

/**
 * Whether a touch can decide a case's active follow-up: it sets a date or
 * clears one. resolveActiveFollowUp skips every other touch (a date-less touch
 * carries the prior follow-up forward), so reading only these touches gives
 * the same answer. src/services/followUpDigest.ts asks PostgREST for exactly
 * these (DIGEST_TOUCH_FILTER).
 */
export function touchCanResolveFollowUp(
  touch: Pick<FollowUpTouch, "nextFollowUpDate" | "clearsFollowUp">,
): boolean {
  return Boolean(touch.nextFollowUpDate) || touch.clearsFollowUp;
}

function compareRows(a: FollowUpDigestRow, b: FollowUpDigestRow): number {
  if (a.status !== b.status) return a.status === "overdue" ? -1 : 1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.caseNumber - b.caseNumber;
}

function buildSection(rows: readonly FollowUpDigestRow[]): FollowUpDigestSection {
  const sorted = [...rows].sort(compareRows);
  return {
    rows: sorted.slice(0, MAX_DIGEST_SECTION_ROWS),
    more: Math.max(0, sorted.length - MAX_DIGEST_SECTION_ROWS),
    overdue: sorted.filter((r) => r.status === "overdue").length,
    dueToday: sorted.filter((r) => r.status === "due_today").length,
  };
}

/** Every digest to send for one org on its local date, and what was held back. */
export function planFollowUpDigests(input: FollowUpDigestPlanInput): FollowUpDigestPlan {
  const { today, appBaseUrl } = input;
  const due = dueFollowUps(input.cases, input.touchpoints, today);
  const memberIds = new Set(input.members.map((m) => m.userId));

  // Every current member assigned an open case, with their due rows (maybe none).
  const rowsByCoordinator = new Map<string, FollowUpDigestRow[]>();
  let unassignedFollowUps = 0;
  for (const c of input.cases) {
    if (!isCaseStatus(c.caseStatus) || !isOpenCaseStatus(c.caseStatus)) continue;
    const owner = c.assignedTo !== null && memberIds.has(c.assignedTo) ? c.assignedTo : null;
    const rows = owner ? (rowsByCoordinator.get(owner) ?? []) : null;
    if (owner && rows) rowsByCoordinator.set(owner, rows);
    const followUp = due.get(c.id);
    if (!followUp) continue;
    if (!rows) {
      // No coordinator to send it to, and no cc list: counted, never sent.
      unassignedFollowUps += 1;
      continue;
    }
    rows.push({
      caseNumber: c.caseNumber,
      caseLink: `${appBaseUrl}/cases/${encodeURIComponent(c.id)}`,
      providerName: c.providerName,
      payerName: c.payerName,
      dueDate: followUp.dueDate,
      status: followUp.status,
    });
  }

  const digests: PlannedDigest[] = [];
  let suppressed = 0;
  for (const member of input.members) {
    const rows = rowsByCoordinator.get(member.userId);
    if (!rows) continue;
    if (rows.length === 0) {
      suppressed += 1;
      continue;
    }
    digests.push({
      recipientUserId: member.userId,
      email: member.email,
      data: {
        practiceName: input.practiceName,
        recipientFirstName: member.firstName?.trim() || null,
        digestDate: today,
        workQueueLink: `${appBaseUrl}/work`,
        followUps: buildSection(rows),
      },
    });
  }

  return { digests, suppressed, unassignedFollowUps };
}

// The daily coordinator follow-up digest job (MINT-108): its registry entry.
//
// Mechanism (Sowmya, Oct 30: the send hour is per org, set by Minted). One
// cron entry runs GET /api/jobs/followup-digest every hour (vercel.json
// `"0 * * * *"`). Each run sends to every org whose digest is on and whose
// local hour, in its effective time zone, is at or after its effective send
// hour, unless that org has already had its digest for that local date.
// "At or after" lets a missed or failed run catch up later the same local
// day; nothing goes out before the hour. See ./followupDigestRun.ts.
//
// MERGE BLOCKER: Vercel runs a cron more often than daily only on the Pro
// plan. On Hobby a sub-daily schedule fails every production deploy. The
// schedule is one line in vercel.json, pinned by crons.test.ts.
//
// Two keys, on purpose:
//   * The run key (job_runs) is the UTC hour (`utcHourKey`), so each hourly
//     call is its own slot: a second call in the same hour is skipped, and a
//     failed run is retried by the next call in that hour.
//   * The send slot (notification_sends, notification_org_slots) is the
//     org's local date. Each coordinator gets at most one digest per org per
//     local date, whatever the hour, the zone or the number of runs.
//
// The work lives in ./followupDigestRun.ts and is imported when the job runs,
// so the registry, the cron route and their tests stay free of the Supabase
// client graph (the api.ts lazy-route precedent).
import type { JobDefinition } from "./types";

export const FOLLOWUP_DIGEST_JOB_NAME = "followup-digest";

/** The UTC hour of `now`, `YYYY-MM-DDTHH`: the digest's run key, one slot per
 *  hourly cron call. It matches RUN_KEY_RE as that stands, so neither the
 *  pattern nor its job_runs CHECK changes. */
export function utcHourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** Every count the digest reports. Integers only (./counts.ts). */
export const FOLLOWUP_DIGEST_COUNT_KEYS = [
  /** Orgs whose digest is on. */
  "orgs_enabled",
  /** Of those, orgs whose local hour is at or after their send hour. */
  "orgs_due",
  /** Orgs whose local hour is still before their send hour: nothing read. */
  "orgs_not_due",
  /** Due orgs that already had their digest for their local date. */
  "orgs_already_completed",
  /** Orgs whose digest for their local date was settled on this attempt. */
  "orgs_completed",
  /** Orgs skipped because their effective send hour or time zone is unusable. */
  "orgs_skipped_send_time",
  /** Orgs skipped because their step's template fails the catalog check. */
  "orgs_skipped_template",
  /** Due orgs whose reads failed; the next hourly run tries them again. */
  "orgs_failed",
  /** Settled orgs whose completion could not be recorded; the next run
   *  re-checks them, and the send ledger keeps it from resending. */
  "orgs_completion_unrecorded",
  /** Emails the provider accepted on this attempt. */
  "digests_sent",
  /** Coordinators an earlier attempt already claimed or sent for the local date. */
  "digests_already_sent",
  /** Coordinators with nothing overdue or due today: no email. */
  "digests_suppressed",
  /** Coordinators with something due but no usable email address on their profile. */
  "recipients_skipped",
  /** Overdue or due-today follow-ups on unassigned cases: sent to no one. */
  "unassigned_follow_ups",
  /** Sends that definitely did not go out: the claim failed, or the mailer
   *  rejected it before or at SendGrid. A later attempt may retry them. */
  "send_failures",
  /** Sends that may have been delivered (network error, timeout, an
   *  unexplained error): left claimed, never resent. */
  "sends_uncertain",
  /** Coordinators whose send already failed three times for the local date. */
  "sends_exhausted",
  /** Sends that went out but whose ledger row could not be finished. */
  "sends_unrecorded",
] as const;

export type FollowUpDigestCountKey = (typeof FOLLOWUP_DIGEST_COUNT_KEYS)[number];
export type FollowUpDigestCounts = Record<FollowUpDigestCountKey, number>;

export const followupDigestJob: JobDefinition = {
  name: FOLLOWUP_DIGEST_JOB_NAME,
  runKey: utcHourKey,
  countKeys: FOLLOWUP_DIGEST_COUNT_KEYS,
  async run(ctx) {
    const { runFollowUpDigest } = await import("./followupDigestRun");
    return runFollowUpDigest(ctx);
  },
};

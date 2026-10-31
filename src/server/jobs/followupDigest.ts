// The daily coordinator follow-up digest job (MINT-108): its registry entry.
//
// GET /api/jobs/followup-digest, called by Vercel cron once a day at 13:00
// UTC (vercel.json `"0 13 * * *"`): 8 to 9 am Eastern, 5 to 6 am Pacific, an
// hour at which the UTC date is every US time zone's local date, so "due
// today" and "overdue" agree with the app. A daily schedule deploys on any
// Vercel plan; Hobby rejects anything more frequent, which would fail every
// production deploy.
//
// The run key is the default UTC day, so a second call that day is skipped
// by job_runs, and a call after a failed run (an operator's, or a schedule
// with retries) runs it again; the per-recipient notification_sends ledger
// keeps that rerun from resending what already went. On the Pro plan,
// `"0 12-23 * * *"` adds hourly retries with no other change.
//
// The work lives in ./followupDigestRun.ts and is imported when the job runs,
// so the registry, the cron route and their tests stay free of the Supabase
// client graph (the api.ts lazy-route precedent).
import type { JobDefinition } from "./types";

export const FOLLOWUP_DIGEST_JOB_NAME = "followup-digest";

/** Every count the digest reports. Integers only (./counts.ts). */
export const FOLLOWUP_DIGEST_COUNT_KEYS = [
  /** Orgs with a follow-up digest sequence row, on or off. */
  "orgs_considered",
  /** Of those, orgs whose digest is on. */
  "orgs_enabled",
  /** Enabled orgs skipped because their step's template fails the catalog check. */
  "orgs_skipped_template",
  /** Enabled orgs whose reads failed; their digests wait for the next attempt. */
  "orgs_failed",
  /** Emails the provider accepted on this attempt. */
  "digests_sent",
  /** Recipients an earlier attempt for the same day already claimed or sent. */
  "digests_already_sent",
  /** Recipients with nothing overdue or due today: no email. */
  "digests_suppressed",
  /** Recipients with something due but no usable email address on their profile. */
  "recipients_skipped",
  /** cc'd users dropped because they are no longer members. */
  "cc_members_dropped",
  /** Unassigned follow-ups that reached no one because no one is cc'd. */
  "unassigned_unrouted",
  /** Sends that definitely did not go out: the claim failed, or the mailer
   *  rejected it before or at SendGrid. A later attempt may retry them. */
  "send_failures",
  /** Sends that may have been delivered (network error, timeout, an
   *  unexplained error): left claimed, never resent. */
  "sends_uncertain",
  /** Recipients whose send already failed three times for the day: not tried again. */
  "sends_exhausted",
  /** Sends that went out but whose ledger row could not be finished. */
  "sends_unrecorded",
] as const;

export type FollowUpDigestCountKey = (typeof FOLLOWUP_DIGEST_COUNT_KEYS)[number];
export type FollowUpDigestCounts = Record<FollowUpDigestCountKey, number>;

export const followupDigestJob: JobDefinition = {
  name: FOLLOWUP_DIGEST_JOB_NAME,
  countKeys: FOLLOWUP_DIGEST_COUNT_KEYS,
  async run(ctx) {
    const { runFollowUpDigest } = await import("./followupDigestRun");
    return runFollowUpDigest(ctx);
  },
};

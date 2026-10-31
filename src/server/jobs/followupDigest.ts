// The daily coordinator follow-up digest job (MINT-108): its registry entry.
//
// GET /api/jobs/followup-digest, called by Vercel cron every hour
// (vercel.json). The run key is the default UTC day, so the first call of a
// UTC day does the work and later calls that day are skipped by job_runs; a
// failed run is retried by the next hourly call, and the per-recipient
// notification_sends ledger keeps a retry from resending what already went.
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
  /** Sends that did not go out (claim, render or provider failure). */
  "send_failures",
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

// The daily coordinator follow-up digest (MINT-108): the run behind
// GET /api/jobs/followup-digest (./followupDigest.ts), called every hour by
// the GitHub Actions tick, plus a daily Vercel cron as a backup.
//
// Each run:
//   1. Discovery, the one cross-org read: every org whose followup_digest
//      sequence is on, with its own steps, and Minted's default
//      (listEnabledNotificationSequences). resolveNotificationSequence gives
//      each org's effective sequence: its send hour, time zone and step.
//   2. The hour gate (digestSlot, src/lib/followUpDigest.ts): an org is due
//      when its local hour is at or after its send hour. Its local date is
//      the digest's "today" and its slot. An org not yet due is counted and
//      nothing of it is read.
//   3. Once per local date: a due org that already has a completion row for
//      (job, org, local date) in notification_org_slots is skipped.
//   4. The step's template_key must pass the consumer contract
//      (templateSendProblem) and have a body here, or the org is skipped and
//      counted. Nothing is sent for it.
//   5. Read the org's name, members, open cases and touchpoints
//      (src/services/followUpDigest.ts), each scoped to the org, and plan the
//      digests (planFollowUpDigests): one per coordinator with something due.
//      Unassigned follow-ups go to no one and are counted.
//   6. For each digest, claim (job, local date, org, recipient) in
//      notification_sends, send followup_digest_daily through sendEmail, and
//      record the send sent or failed.
//   7. When nothing is left that a later run could retry, and no other
//      attempt holds a recent claim for the org, record the org's local date
//      complete, so later hourly runs that day skip it.
//
// Failure semantics. One recipient's failed send, one org's failed read, or
// a send whose ledger row could not be finished never stops the rest: every
// other digest still goes out. An org with a failed read or a retryable send
// gets no completion row, so the next hourly run catches it up the same local
// day; the claims keep that run from resending what already went. If
// anything failed, the run then throws FollowUpDigestIncompleteError, so
// job_runs records the hour failed. Only a definite rejection (a SendGrid 4xx
// other than 408, invalid input, misconfiguration) is retried, at most three
// times per recipient per local date: a network error, a timeout, a SendGrid
// 5xx or 408 (its edge may have accepted the message) or an unexplained error
// may have been delivered, so that send stays claimed and is never resent. A
// claim another attempt took under NOTIFICATION_SEND_RECENT_MINUTES ago is
// left to it: this run neither sends it nor completes the org, so a
// rejection there can still be retried. One edge remains between two
// concurrent runs: if run A completes the org while run B is sending to a
// coordinator A never claimed (B's plan saw a follow-up A's did not), and B's
// send is then definitely rejected, the org is already complete, so that
// rejection is not retried that day. There is still no duplicate. Missing configuration (the SendGrid
// env, or an APP_BASE_URL that is not a bare origin) throws before any send.
// A template problem is one org's setting: it is counted every run until
// fixed, logged once per org per local date (in its first due hour), and
// does not fail the run.
//
// Edges, by design. A send hour of 23 is due in one hourly tick only (the
// next is the next local date), so it gets one attempt a day; Minted should
// keep send hours at 21 or earlier. A zone change can move an org's local
// date: westward across the date line (Honolulu to Tokyo, say) a local date
// can be skipped; eastward the org can get a digest for an earlier date a few
// hours after the last. A failed run's counts are lost: the MINT-106 runner
// records `{}` on failure (a follow-up there, not here).
//
// Logging: ctx.log.error only, with closed snake_case events. Nothing here
// logs an address, a name, a case, a date or a count.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { digestSlot, planFollowUpDigests } from "@/lib/followUpDigest";
import {
  resolveNotificationSequence,
  type EffectiveNotificationSequence,
  type EffectiveStep,
} from "@/lib/notificationSequences";
import { templateSendProblem, type TemplateSendProblem } from "@/lib/notificationTemplates";
import { loadFollowUpDigestOrgData } from "@/services/followUpDigest";
import { listEnabledNotificationSequences } from "@/services/notificationSequences";
import { resolveEmailEnv } from "../email/env";
import {
  EmailError,
  isEmailAddress,
  sendEmail,
  type SendEmailInput,
  type SendEmailResult,
} from "../email/sendgrid";
import type { TemplateKey } from "../email/templates";
import { resolveAppBaseUrl } from "../providerIntakeRoutes";
import {
  FOLLOWUP_DIGEST_COUNT_KEYS,
  FOLLOWUP_DIGEST_JOB_NAME,
  type FollowUpDigestCounts,
} from "./followupDigest";
import {
  NOTIFICATION_SEND_ERROR_CODES,
  supabaseNotificationSendLedger,
  type NotificationOrgSlotKey,
  type NotificationSendErrorCode,
  type NotificationSendKey,
  type NotificationSendLedger,
} from "./notificationSends";
import type { JobContext, JobLogger } from "./types";

/** The one digest body src/server/email/templates.ts registers. */
export const DIGEST_EMAIL_TEMPLATE = "followup_digest_daily" satisfies TemplateKey;

type DigestTemplate = typeof DIGEST_EMAIL_TEMPLATE;

// Thrown values whose class name is the whole log line's explanation.
export class FollowUpDigestNotConfiguredError extends Error {
  override name = "FollowUpDigestNotConfiguredError";
}
export class FollowUpDigestTemplateError extends Error {
  override name = "FollowUpDigestTemplateError";
}
/** Only for a send time the resolver should never return: since #561 the
 *  zone always falls back to a usable one, and the database keeps the hour in
 *  0 to 23 and the default's hour set. Kept as a cheap guard. */
export class FollowUpDigestSendTimeError extends Error {
  override name = "FollowUpDigestSendTimeError";
}
export class NotificationSendFinishLostError extends Error {
  override name = "NotificationSendFinishLostError";
}
export class NotificationSendRetriesExhaustedError extends Error {
  override name = "NotificationSendRetriesExhaustedError";
}
/** Something failed; everything else was sent. Carries the attempt's counts
 *  for tests and callers; the runner records the run failed without them. */
export class FollowUpDigestIncompleteError extends Error {
  override name = "FollowUpDigestIncompleteError";
  readonly counts: FollowUpDigestCounts;
  constructor(counts: FollowUpDigestCounts) {
    super("Some follow-up digests were not sent");
    this.counts = counts;
  }
}

export interface FollowUpDigestConfig {
  /** The bare origin case links point at, or null when unusable. */
  appBaseUrl: string | null;
  /** The reply-to: no person sends the digest. */
  fromEmail: string | null;
  emailReady: boolean;
}

/** APP_BASE_URL through the same check the provider invite links use. */
export function resolveFollowUpDigestConfig(): FollowUpDigestConfig {
  const email = resolveEmailEnv();
  return {
    appBaseUrl: resolveAppBaseUrl(process.env.APP_BASE_URL, Boolean(import.meta.env.DEV)),
    fromEmail: email.fromEmail ?? null,
    emailReady: Boolean(email.apiKey && email.fromEmail),
  };
}

export interface FollowUpDigestDeps {
  config: () => FollowUpDigestConfig;
  send: (input: SendEmailInput<DigestTemplate>) => Promise<SendEmailResult>;
  ledger: (db: SupabaseClient<Database>) => NotificationSendLedger;
}

const DEFAULT_DEPS: FollowUpDigestDeps = {
  config: resolveFollowUpDigestConfig,
  send: (input) => sendEmail(input),
  ledger: supabaseNotificationSendLedger,
};

export type DigestStepProblem =
  TemplateSendProblem | "no_step" | "several_steps" | "not_registered";

/** Why an org's effective digest step cannot be sent, or null. */
export function digestStepProblem(
  steps: readonly Pick<EffectiveStep, "templateKey" | "channel">[],
): DigestStepProblem | null {
  if (steps.length === 0) return "no_step";
  if (steps.length > 1) return "several_steps";
  const [step] = steps;
  const problem = templateSendProblem("followup_digest", step.templateKey, step.channel);
  if (problem) return problem;
  return step.templateKey === DIGEST_EMAIL_TEMPLATE ? null : "not_registered";
}

function zeroCounts(): FollowUpDigestCounts {
  return Object.fromEntries(
    FOLLOWUP_DIGEST_COUNT_KEYS.map((key) => [key, 0]),
  ) as FollowUpDigestCounts;
}

/** SendGrid answers that may come after its edge accepted the message: any
 *  5xx, and 408 (request timeout). */
export function isAmbiguousProviderStatus(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 408;
}

/** The code of a definite rejection, or null when the send may have been
 *  delivered: a network error or timeout, a SendGrid 5xx or 408, or an error
 *  the mailer did not classify. Every other 4xx, 429 included, is definite. */
export function definiteRejectionCode(error: unknown): NotificationSendErrorCode | null {
  if (!(error instanceof EmailError)) return null;
  if (error.kind === "provider_rejected" && isAmbiguousProviderStatus(error.status)) return null;
  const kind: string = error.kind;
  return (NOTIFICATION_SEND_ERROR_CODES as readonly string[]).includes(kind)
    ? (kind as NotificationSendErrorCode)
    : null;
}

type DeliveryOutcome =
  | "sent"
  | "already_sent"
  /** Another attempt claimed it recently and may still be sending it. */
  | "in_flight"
  /** Claimed by an earlier attempt that is over: maybe delivered, never resent. */
  | "held"
  | "failed"
  /** A definite rejection whose failed row could not be written: it stays
   *  claimed, so no later run retries it. */
  | "failed_unrecorded"
  | "uncertain"
  | "exhausted"
  | "unrecorded";

async function deliver(
  log: JobLogger,
  deps: FollowUpDigestDeps,
  ledger: NotificationSendLedger,
  key: NotificationSendKey,
  input: SendEmailInput<DigestTemplate>,
): Promise<DeliveryOutcome> {
  let claimId: string;
  try {
    const claim = await ledger.claim(key);
    if (claim.status === "taken") {
      if (claim.outcome === "sent") return "already_sent";
      return claim.recent ? "in_flight" : "held";
    }
    if (claim.status === "exhausted") {
      log.error("send_retries_exhausted", new NotificationSendRetriesExhaustedError());
      return "exhausted";
    }
    claimId = claim.id;
  } catch (error) {
    // No claim, no send: the ledger is what keeps a retry from resending.
    log.error("send_claim_failed", error);
    return "failed";
  }

  let result: SendEmailResult;
  try {
    result = await deps.send(input);
  } catch (error) {
    const errorCode = definiteRejectionCode(error);
    if (errorCode === null) {
      // It may have been delivered: leave the claim, so it is never resent.
      log.error(`send_uncertain_${error instanceof EmailError ? error.kind : "error"}`, error);
      return "uncertain";
    }
    log.error(`send_failed_${errorCode}`, error);
    try {
      if (await ledger.finish(claimId, { outcome: "failed", errorCode })) return "failed";
      log.error("send_failure_unrecorded", new NotificationSendFinishLostError());
    } catch (finishError) {
      log.error("send_failure_unrecorded", finishError);
    }
    // The claim stays claimed, so this recipient is not retried that day.
    return "failed_unrecorded";
  }

  try {
    const recorded = await ledger.finish(claimId, {
      outcome: "sent",
      providerMessageId: result.messageId,
    });
    if (recorded) return "sent";
    log.error("send_finish_lost", new NotificationSendFinishLostError());
  } catch (error) {
    log.error("send_unrecorded", error);
  }
  // The email went out; the claim still blocks a resend.
  return "unrecorded";
}

/** A due org: its effective sequence and the local date and hour of the run. */
interface DueOrg {
  orgId: string;
  sequence: EffectiveNotificationSequence;
  localDate: string;
  localHour: number;
}

function orgSlot(org: DueOrg): NotificationOrgSlotKey {
  return { job: FOLLOWUP_DIGEST_JOB_NAME, orgId: org.orgId, slot: org.localDate };
}

async function runOrg(
  ctx: JobContext,
  deps: FollowUpDigestDeps,
  ledger: NotificationSendLedger,
  config: { appBaseUrl: string; fromEmail: string },
  org: DueOrg,
  counts: FollowUpDigestCounts,
): Promise<void> {
  const problem = digestStepProblem(org.sequence.steps);
  if (problem) {
    counts.orgs_skipped_template += 1;
    // Counted every run; logged once per local date, in the first due hour.
    // So the line is missing for a date whose due-hour tick was skipped or
    // delayed, or when the org was switched on after its send hour; the
    // counts still show the skip.
    if (org.localHour === org.sequence.sendHour) {
      ctx.log.error(`org_skipped_${problem}`, new FollowUpDigestTemplateError());
    }
    return;
  }

  const data = await loadFollowUpDigestOrgData({ db: ctx.db }, org.orgId);
  const plan = planFollowUpDigests({
    practiceName: data.practiceName,
    today: org.localDate,
    appBaseUrl: config.appBaseUrl,
    cases: data.cases,
    touchpoints: data.touchpoints,
    members: data.members,
  });
  counts.digests_suppressed += plan.suppressed;
  counts.unassigned_follow_ups += plan.unassignedFollowUps;

  // Sends a later run could still make (a failed claim or a recorded definite
  // rejection), or that another attempt may still be making.
  let open = 0;
  for (const digest of plan.digests) {
    const to = digest.email?.trim() ?? "";
    if (!isEmailAddress(to)) {
      counts.recipients_skipped += 1;
      continue;
    }
    const outcome = await deliver(
      ctx.log,
      deps,
      ledger,
      { ...orgSlot(org), recipientUserId: digest.recipientUserId },
      {
        to,
        template: DIGEST_EMAIL_TEMPLATE,
        data: digest.data,
        practiceName: data.practiceName,
        replyTo: { email: config.fromEmail },
      },
    );
    if (outcome === "sent") counts.digests_sent += 1;
    else if (outcome === "already_sent") counts.digests_already_sent += 1;
    else if (outcome === "in_flight") {
      counts.sends_in_flight += 1;
      open += 1;
    } else if (outcome === "held") counts.sends_held += 1;
    else if (outcome === "failed") {
      counts.send_failures += 1;
      open += 1;
    } else if (outcome === "failed_unrecorded") counts.send_failures += 1;
    else if (outcome === "uncertain") counts.sends_uncertain += 1;
    else if (outcome === "exhausted") counts.sends_exhausted += 1;
    else {
      counts.digests_sent += 1;
      counts.sends_unrecorded += 1;
    }
  }

  // Leave the day open for the next hourly run, or for the attempt in flight.
  if (open > 0) return;
  try {
    if (await ledger.completeOrgSlot(orgSlot(org))) counts.orgs_completed += 1;
    // A concurrent attempt recorded it first.
    else counts.orgs_already_completed += 1;
  } catch (error) {
    counts.orgs_completion_unrecorded += 1;
    ctx.log.error("org_completion_unrecorded", error);
  }
}

export async function runFollowUpDigest(
  ctx: JobContext,
  overrides: Partial<FollowUpDigestDeps> = {},
): Promise<FollowUpDigestCounts> {
  const deps: FollowUpDigestDeps = { ...DEFAULT_DEPS, ...overrides };
  const counts = zeroCounts();

  // Before the MINT-107 migration is applied no org can have the digest on.
  const discovery = await listEnabledNotificationSequences({ db: ctx.db }, "followup_digest");
  if (discovery.status === "unavailable") return counts;

  const due: DueOrg[] = [];
  for (const row of discovery.sequences) {
    const sequence = resolveNotificationSequence("followup_digest", row, discovery.platformDefault);
    if (!sequence.enabled) continue;
    counts.orgs_enabled += 1;
    const slot = digestSlot(sequence, ctx.now);
    if (!slot) {
      // Unreachable through data since #561 (see FollowUpDigestSendTimeError),
      // so it is logged every run rather than once a day.
      counts.orgs_skipped_send_time += 1;
      ctx.log.error("org_skipped_send_time", new FollowUpDigestSendTimeError());
    } else if (!slot.due) {
      counts.orgs_not_due += 1;
    } else {
      counts.orgs_due += 1;
      due.push({
        orgId: row.orgId,
        sequence,
        localDate: slot.localDate,
        localHour: slot.localHour,
      });
    }
  }
  if (due.length === 0) return counts;

  const ledger = deps.ledger(ctx.db);
  const pending: DueOrg[] = [];
  for (const org of due) {
    try {
      if (await ledger.isOrgSlotComplete(orgSlot(org))) counts.orgs_already_completed += 1;
      else pending.push(org);
    } catch (error) {
      counts.orgs_failed += 1;
      ctx.log.error("org_failed", error);
    }
  }

  if (pending.length > 0) {
    const config = deps.config();
    if (!config.emailReady || !config.appBaseUrl || !config.fromEmail) {
      throw new FollowUpDigestNotConfiguredError();
    }
    const ready = { appBaseUrl: config.appBaseUrl, fromEmail: config.fromEmail };
    for (const org of pending) {
      try {
        await runOrg(ctx, deps, ledger, ready, org, counts);
      } catch (error) {
        counts.orgs_failed += 1;
        ctx.log.error("org_failed", error);
      }
    }
  }

  // Exhausted sends do not fail the run: nothing is left to try for them.
  if (
    counts.orgs_failed +
      counts.send_failures +
      counts.sends_uncertain +
      counts.sends_unrecorded +
      counts.orgs_completion_unrecorded >
    0
  ) {
    throw new FollowUpDigestIncompleteError(counts);
  }
  return counts;
}

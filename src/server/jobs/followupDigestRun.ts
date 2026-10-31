// The daily coordinator follow-up digest (MINT-108): the run behind
// GET /api/jobs/followup-digest (./followupDigest.ts).
//
// For each org whose followup_digest sequence is on:
//   1. Re-read the sequence through listNotificationSequences, the MINT-107
//      service, scoped to the org. Check its one step's template_key the way
//      the consumer contract says (templateSendProblem): the entry exists,
//      belongs to followup_digest, is selectable and supports the step's
//      channel; and it has a body here. A step that fails skips the org and
//      is counted (orgs_skipped_template). Nothing is sent for it.
//   2. Read the org's members, open cases and touchpoints
//      (src/services/followUpDigest.ts) and plan the digests
//      (planFollowUpDigests, src/lib/followUpDigest.ts).
//   3. For each digest, claim (job, runKey, org, recipient) in
//      notification_sends, send followup_digest_daily through sendEmail, and
//      record the send sent or failed.
//
// "Today" is the UTC day of the run, which is also its run key: the schema
// has no organization time zone, and a server job has no viewer's local
// day. The first call after 00:00 UTC sends, so US inboxes get the next
// day's digest the evening before (after 7 pm Eastern, 4 pm Pacific).
//
// Failure semantics. One recipient's failed send, one org's failed read, or
// a send whose ledger row could not be finished never stops the rest: every
// other digest still goes out. If anything failed, the run then throws
// FollowUpDigestIncompleteError, so job_runs records it failed and the next
// hourly call runs it again. That attempt skips every recipient already
// claimed or sent, so only what failed is retried, until the UTC day ends.
// Missing configuration (the SendGrid env, or an APP_BASE_URL that is not a
// bare origin) throws before any send. A template problem is one org's
// setting: retrying cannot fix it, so it is counted and logged but does not
// fail the run.
//
// Logging: ctx.log.error only, with closed snake_case events. Nothing here
// logs an address, a name, a case or a count.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { planFollowUpDigests } from "@/lib/followUpDigest";
import { templateSendProblem, type TemplateSendProblem } from "@/lib/notificationTemplates";
import { loadFollowUpDigestOrgData, listFollowUpDigestOrgs } from "@/services/followUpDigest";
import { listNotificationSequences } from "@/services/notificationSequences";
import type { NotificationSequenceStep } from "@/types";
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
  supabaseNotificationSendLedger,
  type NotificationSendErrorCode,
  type NotificationSendKey,
  type NotificationSendLedger,
} from "./notificationSends";
import { utcDayKey } from "./registry";
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
export class NotificationSendFinishLostError extends Error {
  override name = "NotificationSendFinishLostError";
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

/** Why an org's digest step cannot be sent, or null. */
export function digestStepProblem(
  steps: readonly Pick<NotificationSequenceStep, "templateKey" | "channel">[],
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

function sendErrorCode(error: unknown): NotificationSendErrorCode {
  return error instanceof EmailError ? error.kind : "send_error";
}

type DeliveryOutcome = "sent" | "already_sent" | "failed" | "unrecorded";

async function deliver(
  log: JobLogger,
  deps: FollowUpDigestDeps,
  ledger: NotificationSendLedger,
  key: NotificationSendKey,
  input: SendEmailInput<DigestTemplate>,
): Promise<DeliveryOutcome> {
  let claimId: string | null;
  try {
    claimId = await ledger.claim(key);
  } catch (error) {
    // No claim, no send: the ledger is what keeps a retry from resending.
    log.error("send_claim_failed", error);
    return "failed";
  }
  if (claimId === null) return "already_sent";

  let result: SendEmailResult;
  try {
    result = await deps.send(input);
  } catch (error) {
    const errorCode = sendErrorCode(error);
    log.error(`send_failed_${errorCode}`, error);
    try {
      await ledger.finish(claimId, { outcome: "failed", errorCode });
    } catch (finishError) {
      // The claim stays claimed, so this recipient is not retried today.
      log.error("send_failure_unrecorded", finishError);
    }
    return "failed";
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

async function runOrg(
  ctx: JobContext,
  deps: FollowUpDigestDeps,
  ledger: NotificationSendLedger,
  config: { appBaseUrl: string; fromEmail: string },
  org: { orgId: string; practiceName: string },
  today: string,
  counts: FollowUpDigestCounts,
): Promise<void> {
  const result = await listNotificationSequences({ db: ctx.db, orgId: org.orgId });
  const sequence = result.status === "available" ? result.sequences.followup_digest : undefined;
  // Switched off since the discovery read.
  if (!sequence?.enabled) return;
  counts.orgs_enabled += 1;

  const problem = digestStepProblem(sequence.steps);
  if (problem) {
    counts.orgs_skipped_template += 1;
    ctx.log.error(`org_skipped_${problem}`, new FollowUpDigestTemplateError());
    return;
  }

  const data = await loadFollowUpDigestOrgData({ db: ctx.db }, org.orgId);
  const plan = planFollowUpDigests({
    practiceName: org.practiceName,
    today,
    appBaseUrl: config.appBaseUrl,
    cases: data.cases,
    touchpoints: data.touchpoints,
    members: data.members,
    ccRecipients: sequence.steps[0].ccRecipients,
  });
  counts.digests_suppressed += plan.suppressed;
  counts.cc_members_dropped += plan.ccMembersDropped;
  counts.unassigned_unrouted += plan.unassignedUnrouted;

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
      {
        job: FOLLOWUP_DIGEST_JOB_NAME,
        runKey: ctx.runKey,
        orgId: org.orgId,
        recipientUserId: digest.recipientUserId,
      },
      {
        to,
        template: DIGEST_EMAIL_TEMPLATE,
        data: digest.data,
        practiceName: org.practiceName,
        replyTo: { email: config.fromEmail },
      },
    );
    if (outcome === "sent") counts.digests_sent += 1;
    else if (outcome === "already_sent") counts.digests_already_sent += 1;
    else if (outcome === "failed") counts.send_failures += 1;
    else {
      counts.digests_sent += 1;
      counts.sends_unrecorded += 1;
    }
  }
}

export async function runFollowUpDigest(
  ctx: JobContext,
  overrides: Partial<FollowUpDigestDeps> = {},
): Promise<FollowUpDigestCounts> {
  const deps: FollowUpDigestDeps = { ...DEFAULT_DEPS, ...overrides };
  const counts = zeroCounts();
  // The run key under the default daily key (registry.ts utcDayKey).
  const today = utcDayKey(ctx.now);

  const orgs = await listFollowUpDigestOrgs({ db: ctx.db });
  counts.orgs_considered = orgs.length;
  const enabled = orgs.filter((org) => org.enabled);
  if (enabled.length === 0) return counts;

  const config = deps.config();
  if (!config.emailReady || !config.appBaseUrl || !config.fromEmail) {
    throw new FollowUpDigestNotConfiguredError();
  }
  const ready = { appBaseUrl: config.appBaseUrl, fromEmail: config.fromEmail };
  const ledger = deps.ledger(ctx.db);

  for (const org of enabled) {
    try {
      await runOrg(ctx, deps, ledger, ready, org, today, counts);
    } catch (error) {
      counts.orgs_failed += 1;
      ctx.log.error("org_failed", error);
    }
  }

  if (counts.orgs_failed + counts.send_failures + counts.sends_unrecorded > 0) {
    throw new FollowUpDigestIncompleteError(counts);
  }
  return counts;
}

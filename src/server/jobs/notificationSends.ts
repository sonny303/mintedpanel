// The notification_sends ledger (MINT-108), reached only through its two
// service-role RPCs (supabase/migrations/20261031060000_notification_sends.sql).
//
// A job run is at-least-once (./types.ts), so a job that emails people claims
// each send on (job, runKey, org, recipient) before sending it. The claim
// answers `taken` when that send is already claimed or sent for the slot, and
// `exhausted` after NOTIFICATION_SEND_MAX_FAILURES failed rows: skip it either
// way.
//
// Only a definite rejection (the codes below: nothing was accepted) is
// finished as failed, and a later attempt may claim it again. A send that may
// have been delivered (a network error or timeout, an unexplained error, a
// function that died mid-send) is never finished and stays claimed: SendGrid
// has no idempotency key, so it is never resent.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Mirrored by notification_sends_error_code_check and finish_notification_send.
 *  The mailer's EmailErrorKind values that prove nothing was accepted: each is
 *  thrown before the request, or is SendGrid's own non-2xx answer. `network`
 *  is not one: a timeout may have been delivered. */
export const NOTIFICATION_SEND_ERROR_CODES = [
  "misconfigured",
  "invalid_input",
  "provider_rejected",
] as const;
export type NotificationSendErrorCode = (typeof NOTIFICATION_SEND_ERROR_CODES)[number];

/** After this many failed rows for a key the claim answers `exhausted`.
 *  Mirrored by claim_notification_send. */
export const NOTIFICATION_SEND_MAX_FAILURES = 3;

/** Mirrored by notification_sends_provider_message_id_check. A message id
 *  outside it is not recorded (null), so a provider oddity cannot make the
 *  finish fail after the email went out. */
export const PROVIDER_MESSAGE_ID_RE = /^[A-Za-z0-9._=-]{1,128}$/;

export interface NotificationSendKey {
  job: string;
  runKey: string;
  orgId: string;
  recipientUserId: string;
}

export type NotificationSendFinish =
  | { outcome: "sent"; providerMessageId: string | null }
  | { outcome: "failed"; errorCode: NotificationSendErrorCode };

export type NotificationSendClaim =
  { status: "claimed"; id: string } | { status: "taken" } | { status: "exhausted" };

export class InvalidNotificationSendClaimError extends Error {
  override name = "InvalidNotificationSendClaimError";
}

/** The claim RPC's jsonb answer, narrowed. Anything else throws. */
export function parseNotificationSendClaim(value: unknown): NotificationSendClaim {
  const answer =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { status?: unknown; id?: unknown })
      : {};
  if (answer.status === "claimed" && typeof answer.id === "string" && answer.id.length > 0) {
    return { status: "claimed", id: answer.id };
  }
  if (answer.status === "taken" || answer.status === "exhausted") return { status: answer.status };
  throw new InvalidNotificationSendClaimError("claim_notification_send answered an unknown shape");
}

export interface NotificationSendLedger {
  claim(key: NotificationSendKey): Promise<NotificationSendClaim>;
  /** False when the row is not claimed. */
  finish(id: string, result: NotificationSendFinish): Promise<boolean>;
}

export function safeProviderMessageId(value: string | null | undefined): string | null {
  return typeof value === "string" && PROVIDER_MESSAGE_ID_RE.test(value) ? value : null;
}

export function supabaseNotificationSendLedger(
  db: SupabaseClient<Database>,
): NotificationSendLedger {
  return {
    async claim(key) {
      const { data, error } = await db.rpc("claim_notification_send", {
        p_job: key.job,
        p_run_key: key.runKey,
        p_org_id: key.orgId,
        p_recipient_user_id: key.recipientUserId,
      });
      if (error) throw error;
      return parseNotificationSendClaim(data);
    },
    async finish(id, result) {
      const messageId =
        result.outcome === "sent" ? safeProviderMessageId(result.providerMessageId) : null;
      const { data, error } = await db.rpc("finish_notification_send", {
        p_id: id,
        p_outcome: result.outcome,
        ...(messageId ? { p_provider_message_id: messageId } : {}),
        ...(result.outcome === "failed" ? { p_error_code: result.errorCode } : {}),
      });
      if (error) throw error;
      return data === true;
    },
  };
}

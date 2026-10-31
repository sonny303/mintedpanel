// The notification_sends ledger (MINT-108), reached only through its two
// service-role RPCs (supabase/migrations/20261031060000_notification_sends.sql).
//
// A job run is at-least-once (./types.ts), so a job that emails people claims
// each send on (job, runKey, org, recipient) before sending it. A claim that
// returns null means that send is already claimed or sent for the slot: skip
// it. A failed send is recorded failed, and a later attempt claims it again.
// A claim that is never finished (the function died mid-send) stays claimed:
// SendGrid has no idempotency key, so it is never resent.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Mirrored by notification_sends_error_code_check and finish_notification_send.
 *  The first four are the mailer's EmailErrorKind values; `send_error` is
 *  anything else. */
export const NOTIFICATION_SEND_ERROR_CODES = [
  "misconfigured",
  "invalid_input",
  "provider_rejected",
  "network",
  "send_error",
] as const;
export type NotificationSendErrorCode = (typeof NOTIFICATION_SEND_ERROR_CODES)[number];

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

export interface NotificationSendLedger {
  /** The new claim's id, or null when the send is already claimed or sent. */
  claim(key: NotificationSendKey): Promise<string | null>;
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
      return typeof data === "string" && data.length > 0 ? data : null;
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

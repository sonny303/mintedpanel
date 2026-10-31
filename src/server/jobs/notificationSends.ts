// The notification ledgers (MINT-108): notification_sends, reached only
// through its two service-role RPCs, and notification_org_slots, read here and
// written only through complete_notification_org_slot
// (supabase/migrations/20261031060000_notification_sends.sql).
//
// A job run is at-least-once (./types.ts), so a job that emails people claims
// each send on (job, slot, org, recipient) before sending it. The slot is what
// the send is once-only for, and it is not the job_runs run key: the hourly
// follow-up digest's slot is the org's local date. The claim answers `taken`
// when that send is already claimed or sent for the slot, and `exhausted`
// after NOTIFICATION_SEND_MAX_FAILURES failed rows: skip it either way.
//
// Only a definite rejection (the codes below: nothing was accepted) is
// finished as failed, and a later attempt may claim it again. A send that may
// have been delivered (a network error or timeout, an unexplained error, a
// function that died mid-send) is never finished and stays claimed: SendGrid
// has no idempotency key, so it is never resent.
//
// Once every planned send for an org's slot is settled (nothing a later run
// could retry), the job records the slot complete; a later run reads that and
// skips the org.
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

/** Mirrored by notification_sends_slot_check and notification_org_slots_slot_check:
 *  the run-key alphabet, though a slot is not a run key. */
export const NOTIFICATION_SLOT_RE = /^[0-9A-Za-z:_-]{1,64}$/;

/** One org's slot for one job: for followup-digest, the org's local date. */
export interface NotificationOrgSlotKey {
  job: string;
  orgId: string;
  slot: string;
}

export interface NotificationSendKey extends NotificationOrgSlotKey {
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
  /** True once the org's sends for the slot were recorded settled. */
  isOrgSlotComplete(key: NotificationOrgSlotKey): Promise<boolean>;
  /** Record the org's sends for the slot settled. False when already recorded. */
  completeOrgSlot(key: NotificationOrgSlotKey): Promise<boolean>;
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
        p_slot: key.slot,
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
    async isOrgSlotComplete(key) {
      // A primary-key lookup: at most one row, so no paging.
      const { data, error } = await db
        .from("notification_org_slots")
        .select("slot")
        .eq("job", key.job)
        .eq("org_id", key.orgId)
        .eq("slot", key.slot);
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },
    async completeOrgSlot(key) {
      const { data, error } = await db.rpc("complete_notification_org_slot", {
        p_job: key.job,
        p_org_id: key.orgId,
        p_slot: key.slot,
      });
      if (error) throw error;
      return data === true;
    },
  };
}

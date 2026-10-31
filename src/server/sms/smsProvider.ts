// MINT-107 — the server-side SMS seam. `resolveSmsProvider` always returns
// the disabled provider, which refuses every message without reading it.
//
// Vendor: Twilio (Sowmya, Oct 30), subject to Sowmya confirming the HIPAA BAA
// tier and the 10DLC registration before anything is signed. Until both are
// confirmed there is no Twilio adapter and SMS stays disabled. The PR that
// adds the adapter implements `SmsProvider` behind `resolveSmsProvider`.
//
// Rules any implementation, and any caller, must keep:
//   * A text goes only to a provider with a live sms_consents row for that
//     exact number. The caller names that row (`consentId`); the provider
//     never decides consent and never sends without one.
//   * Callers name a registered template; the body is rendered from it, never
//     free text, and never carries SSN, DOB or document contents (the cc rule
//     in src/lib/notificationTemplates.ts applies to SMS too).
//   * Neither the number nor the body is logged. A refusal or failure is a
//     result, not a throw, so a sequence records "skipped" and moves on, the
//     way an email delivery failure is reported rather than raised.
//   * Never resend on a retry: `idempotencyKey` is per (step, recipient).
//
// Keep this module's imports relative so a CLI can load it, like src/server/email.

/** An E.164 number: "+" then 8 to 15 digits, no leading zero. Same as sms_consents_phone_check. */
export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export interface SmsMessage {
  orgId: string;
  /** E.164, and the number on the consent row named below. */
  to: string;
  body: string;
  /** The live sms_consents row this send relies on. */
  consentId: string;
  /** Stable per (sequence step, recipient); a vendor dedupes on it. */
  idempotencyKey: string;
}

export type SmsRefusalReason = "sms_disabled" | "invalid_number";

export type SmsSendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "refused"; reason: SmsRefusalReason }
  | { status: "failed"; retryable: boolean };

export interface SmsProvider {
  /** For logs and audit rows: a provider name, never a credential. */
  readonly name: string;
  /** False when the provider cannot send at all, so callers can skip early. */
  readonly canSend: boolean;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** Refuses every message. It does not inspect, store or log the message. */
export const disabledSmsProvider: SmsProvider = Object.freeze({
  name: "disabled",
  canSend: false,
  async send(): Promise<SmsSendResult> {
    return { status: "refused", reason: "sms_disabled" };
  },
});

/**
 * The provider the server should use. Today that is always the disabled one:
 * SMS ships switched off until Twilio's HIPAA BAA tier and 10DLC registration
 * are confirmed. The env parameter is the seam the Twilio PR fills in (keys,
 * sender id); it is unread now, so no environment can switch SMS on.
 */
export function resolveSmsProvider(
  _env: Readonly<Record<string, string | undefined>> = {},
): SmsProvider {
  return disabledSmsProvider;
}

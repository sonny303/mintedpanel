// Story 3: channel-aware touchpoint outcome taxonomy. This lives in code (not
// user config) so it is easy to edit here. A "channel" is the coordinator-facing
// contact method; it maps to the stored `touch_type` (Phone -> call). Each
// channel exposes only the outcomes that make sense for it, so a phone call is
// never marked "Submitted" and an email is never "Left voicemail".
import type { TouchOutcome, TouchType } from "@/types";

export type Channel = "phone" | "email" | "portal" | "fax" | "mail";

export interface OutcomeOption {
  value: TouchOutcome;
  label: string;
}

// Channels in coordinator-facing order, each with its stored touch_type.
export const CHANNELS: { channel: Channel; touchType: TouchType; label: string }[] = [
  { channel: "phone", touchType: "call", label: "Phone" },
  { channel: "email", touchType: "email", label: "Email" },
  { channel: "portal", touchType: "portal", label: "Portal" },
  { channel: "fax", touchType: "fax", label: "Fax" },
  { channel: "mail", touchType: "mail", label: "Mail" },
];

export const OUTCOMES_BY_CHANNEL: Record<Channel, OutcomeOption[]> = {
  email: [
    { value: "sent", label: "Sent" },
    { value: "reply_received", label: "Reply received" },
    { value: "info_requested", label: "Info requested" },
    { value: "approved", label: "Approved" },
    { value: "denied", label: "Denied" },
    { value: "no_response_yet", label: "No response yet" },
  ],
  portal: [
    { value: "submitted", label: "Submitted" },
    { value: "draft_saved", label: "Draft saved" },
    { value: "under_review", label: "Under review" },
    { value: "info_requested", label: "Info requested" },
    { value: "approved", label: "Approved" },
    { value: "denied", label: "Denied" },
    { value: "submission_error", label: "Submission error" },
  ],
  phone: [
    { value: "spoke_with_rep", label: "Spoke with rep" },
    { value: "left_voicemail", label: "Left voicemail" },
    { value: "no_answer", label: "No answer" },
    { value: "callback_scheduled", label: "Callback scheduled" },
    { value: "got_reference_number", label: "Got reference number" },
    { value: "directed_to_portal_or_email", label: "Directed to portal or email" },
  ],
  fax: [
    { value: "sent", label: "Sent" },
    { value: "confirmed_received", label: "Confirmed received" },
    { value: "failed", label: "Failed" },
    { value: "no_confirmation", label: "No confirmation" },
  ],
  mail: [
    { value: "sent", label: "Sent" },
    { value: "delivered", label: "Delivered" },
    { value: "returned", label: "Returned" },
    { value: "no_response", label: "No response" },
  ],
};

// The Phone outcome that prompts to populate payer_reference_id (Story 3 & 8).
export const REFERENCE_NUMBER_OUTCOME: TouchOutcome = "got_reference_number";

// Legacy labels for pre-taxonomy rows that aren't in any current channel list.
const LEGACY_OUTCOME_LABELS: Record<string, string> = {
  reached: "Reached",
  left_voicemail: "Left voicemail",
  no_answer: "No answer",
  response_received: "Response received",
  submitted: "Submitted",
  no_response: "No response",
  form_filled: "Form filled",
};

export const OUTCOME_LABELS: Record<string, string> = {
  ...LEGACY_OUTCOME_LABELS,
  ...Object.fromEntries(
    Object.values(OUTCOMES_BY_CHANNEL)
      .flat()
      .map((o) => [o.value, o.label]),
  ),
};

export function outcomeLabel(code: string | null | undefined): string {
  if (!code) return "";
  return OUTCOME_LABELS[code] ?? code;
}

export function channelForTouchType(touchType: TouchType): Channel {
  return touchType === "call" ? "phone" : (touchType as Channel);
}

export function touchTypeForChannel(channel: Channel): TouchType {
  return channel === "phone" ? "call" : (channel as TouchType);
}

export function outcomesForChannel(channel: Channel): OutcomeOption[] {
  return OUTCOMES_BY_CHANNEL[channel];
}

export function isValidOutcomeForChannel(channel: Channel, outcome: TouchOutcome): boolean {
  return OUTCOMES_BY_CHANNEL[channel].some((o) => o.value === outcome);
}

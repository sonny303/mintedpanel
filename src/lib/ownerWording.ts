// M5.5: owner-facing wording. Every string the client sees is mapped or
// derived here — no hand-written copy anywhere on /progress.
import { differenceInCalendarDays, format, parseISO } from "date-fns";

export interface OwnerWordingInput {
  statusLabel: string | null;
  confirmedEffectiveDate: string | null;
  expectedEffectiveDate: string | null;
  submittedDate: string | null;
  /** payers.avg_decision_days for the case's payer */
  avgDecisionDays: number | null;
  /** latest touch's next_follow_up_date */
  nextFollowUpDate: string | null;
  now?: Date;
}

export interface OwnerState {
  label: string;
  tone: "ok" | "info" | "warn" | "danger" | "pending" | "neutral";
  /** rows the owner never sees (Not Required) */
  omit: boolean;
  billingNow: boolean;
}

function effectiveDate(input: OwnerWordingInput): string | null {
  return input.confirmedEffectiveDate ?? input.expectedEffectiveDate;
}

/** Owner wording map from the M5.5 spec, top-down. */
export function ownerState(input: OwnerWordingInput): OwnerState {
  const now = input.now ?? new Date();
  const eff = effectiveDate(input);
  const effPassed = eff != null && differenceInCalendarDays(parseISO(eff), now) <= 0;
  const label = input.statusLabel;

  if (label === "Not Required") {
    return { label: "", tone: "neutral", omit: true, billingNow: false };
  }
  if (label === "In-Network" || (label === "Approved" && effPassed)) {
    return { label: "Billing now", tone: "ok", omit: false, billingNow: true };
  }
  if (label === "Approved" && eff != null) {
    return {
      label: `Approved · billing starts ${format(parseISO(eff), "MMM d")}`,
      tone: "pending",
      omit: false,
      billingNow: false,
    };
  }
  if (label === "Submitted")
    return { label: "In review", tone: "info", omit: false, billingNow: false };
  if (label === "In Progress")
    return { label: "In preparation", tone: "info", omit: false, billingNow: false };
  if (label === "Waiting on Provider")
    return { label: "Waiting on documents", tone: "warn", omit: false, billingNow: false };
  if (label === "Denied")
    return { label: "Needs attention", tone: "danger", omit: false, billingNow: false };
  if (label === "Not Started")
    return { label: "Not started yet", tone: "neutral", omit: false, billingNow: false };
  // Approved without any effective date, or anything unmapped: neutral internal label.
  if (label === "Approved")
    return { label: "Approved", tone: "pending", omit: false, billingNow: false };
  return { label: label ?? "In preparation", tone: "neutral", omit: false, billingNow: false };
}

/** "When" derivations from the spec, precedence top-down. Blank when nothing fits. */
export function ownerWhen(input: OwnerWordingInput): string {
  const now = input.now ?? new Date();
  if (input.statusLabel === "Submitted" && input.submittedDate && input.avgDecisionDays != null) {
    const est = parseISO(input.submittedDate);
    est.setDate(est.getDate() + input.avgDecisionDays);
    return `Est. ${format(est, "MMM d")}`;
  }
  if (
    input.nextFollowUpDate != null &&
    differenceInCalendarDays(parseISO(input.nextFollowUpDate), now) > 0
  ) {
    return `Next follow-up ${format(parseISO(input.nextFollowUpDate), "MMM d")}`;
  }
  const eff = effectiveDate(input);
  if (input.statusLabel === "Approved" && eff != null) {
    if (differenceInCalendarDays(parseISO(eff), now) > 0) {
      return `Billing starts ${format(parseISO(eff), "MMM d")}`;
    }
  }
  if (input.statusLabel === "Not Started") return "Queued";
  return "";
}

/** Credential expansion for owner-facing display. */
const CREDENTIAL_EXPANSIONS: Record<string, string> = {
  DPT: "Doctor of Physical Therapy",
  PT: "Physical Therapist",
  PTA: "Physical Therapist Assistant",
  OTR: "Occupational Therapist",
  OT: "Occupational Therapist",
  SLP: "Speech-Language Pathologist",
  MD: "Doctor of Medicine",
  DO: "Doctor of Osteopathic Medicine",
  NP: "Nurse Practitioner",
  PA: "Physician Assistant",
};

export function expandCredentials(credentials: string | null): string | null {
  if (!credentials) return null;
  const primary = credentials.split(/[,/]/)[0]?.trim().toUpperCase().replace(/\./g, "");
  return (primary && CREDENTIAL_EXPANSIONS[primary]) ?? credentials;
}

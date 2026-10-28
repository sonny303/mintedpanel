// Provider onboarding R1 view shapes (docs/provider-onboarding/r1-ui-spec.md §5).
// Not table rows: these are what the screens render. The preview feeds them
// from fixtures; the real backend will feed the same shapes.
import type { DocumentKind } from "@/types";

export type OnboardingStage = "invited" | "started" | "submitted" | "ready" | "in_credentialing";
export type WaitingOn = "provider" | "practice" | "minted";

// Milestones are events; the stage is derived from them, never stored (rule 8).
export type OnboardingEventType =
  | "invited"
  | "invitation_resent"
  | "reminder_sent"
  | "signed_in"
  | "consent_signed"
  | "section_saved"
  | "submitted"
  | "help_requested"
  | "told_not_needed"
  | "practice_contacted"
  | "admitted"
  | "first_case_created";

export interface OnboardingEvent {
  type: OnboardingEventType;
  at: string; // ISO timestamp
}

export interface OnboardingHire {
  providerId: string;
  displayName: string;
  invitedEmail: string;
  groupName: string;
  locationName: string | null;
  source: "practice_invite";
  states: string[];
  startDate: string | null; // practice-entered only
  events: OnboardingEvent[];
}

// source null = not yet provided or confirmed by the provider.
export interface FieldValue<T> {
  value: T | null;
  source: { label: string; asOf: string } | null;
}

export interface IntakeLicense {
  state: FieldValue<string>;
  number: FieldValue<string>;
  expiresOn: FieldValue<string>;
}

// Secrets are write-only: the draft only ever knows whether one is on file.
export interface IntakeDraft {
  identity: {
    firstName: FieldValue<string>;
    lastName: FieldValue<string>;
    npi: FieldValue<string>;
    taxonomyCode: FieldValue<string>;
    dateOfBirth: FieldValue<string>;
    caqhId: FieldValue<string>;
    ssnOnFile: boolean;
  };
  contact: {
    email: string;
    mobile: FieldValue<string>;
    homeAddress: FieldValue<string>;
  };
  licenses: IntakeLicense[];
  logins: { caqhOnFile: boolean; pecosOnFile: boolean };
}

export interface DocumentSlot {
  key: string;
  kind: DocumentKind;
  label: string;
  required: boolean;
  licenseState?: string;
  needsExpiration: boolean;
  file: { name: string; sizeBytes: number; expiresOn: string | null } | null;
}

export interface VerificationCheck {
  key: string;
  label: string;
  status: "confirmed" | "pending";
  method: "auto" | "person";
  confirmedBy: string | null; // person checks only
  action: "test_login" | "confirm" | null;
}

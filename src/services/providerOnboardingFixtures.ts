// Sample data for the planned /dev/provider-onboarding preview (r1-ui-spec
// decision 18; not built yet — the derivation tests are the only consumer).
// Synthetic canvas names only, no real PHI. Every count a screen shows is
// computed from these rows, never typed in separately.
import type { IntakeDraft, OnboardingHire, VerificationCheck } from "@/types/providerOnboarding";
export { CONSENT } from "@/lib/intakeConsent";

export const PRACTICE = {
  name: "Shelby Sports Rehab",
  key: "pk_7f3a9c",
  groups: ["Shelby Sports Rehab"],
  locations: ["Charlotte", "Concord"],
  address: "410 Mint St, Charlotte, NC 28202",
};

const hire = (h: Omit<OnboardingHire, "groupName" | "source">): OnboardingHire => ({
  ...h,
  groupName: PRACTICE.groups[0],
  source: "practice_invite",
});

export const HIRES: OnboardingHire[] = [
  hire({
    providerId: "fx-jisoo-kim",
    displayName: "Jisoo Kim, PT",
    invitedEmail: "jisoo.kim@example.test",
    locationName: null,
    states: ["NC"],
    startDate: null,
    events: [
      { type: "invited", at: "2026-10-12T14:00:00Z" },
      { type: "signed_in", at: "2026-10-14T18:20:00Z" },
      { type: "consent_signed", at: "2026-10-14T18:22:00Z" },
      { type: "section_saved", at: "2026-10-14T18:40:00Z" },
      { type: "help_requested", at: "2026-10-15T09:10:00Z" },
    ],
  }),
  hire({
    providerId: "fx-anita-rao",
    displayName: "Anita Rao, PT",
    invitedEmail: "anita.rao@example.test",
    locationName: null,
    states: ["NC"],
    startDate: "2026-11-03",
    events: [{ type: "invited", at: "2026-10-19T14:11:00Z" }],
  }),
  hire({
    providerId: "fx-marcus-bell",
    displayName: "Marcus Bell, DPT",
    invitedEmail: "marcus.bell@example.test",
    locationName: null,
    states: ["NC"],
    startDate: "2026-10-27",
    events: [
      { type: "invited", at: "2026-10-10T13:00:00Z" },
      { type: "reminder_sent", at: "2026-10-12T13:00:00Z" },
      { type: "signed_in", at: "2026-10-12T19:05:00Z" },
      { type: "consent_signed", at: "2026-10-12T19:07:00Z" },
      { type: "section_saved", at: "2026-10-12T19:30:00Z" },
    ],
  }),
  hire({
    providerId: "fx-lena-ortiz",
    displayName: "Lena Ortiz, PTA",
    invitedEmail: "lena.ortiz@example.test",
    locationName: null,
    states: ["NC"],
    startDate: "2026-11-10",
    events: [
      { type: "invited", at: "2026-10-13T13:40:00Z" },
      { type: "reminder_sent", at: "2026-10-15T14:00:00Z" },
      { type: "signed_in", at: "2026-10-15T22:52:00Z" },
      { type: "consent_signed", at: "2026-10-15T22:54:00Z" },
      { type: "submitted", at: "2026-10-16T23:48:00Z" },
    ],
  }),
  hire({
    providerId: "fx-owen-park",
    displayName: "Owen Park, PT",
    invitedEmail: "owen.park@example.test",
    locationName: "Charlotte",
    states: ["NC", "SC"],
    startDate: "2026-10-20",
    events: [
      { type: "invited", at: "2026-10-01T13:00:00Z" },
      { type: "signed_in", at: "2026-10-01T20:00:00Z" },
      { type: "consent_signed", at: "2026-10-01T20:02:00Z" },
      { type: "submitted", at: "2026-10-02T21:00:00Z" },
      { type: "admitted", at: "2026-10-03T15:00:00Z" },
    ],
  }),
];

// Hires already past onboarding, for screen 0's footer count.
export const EARLIER_HIRES_IN_CREDENTIALING = 9;

const ROSTER = { label: "From Shelby's roster", asOf: "2026-08-12" };

// Anita's draft as the form first shows it: the roster supplied her name, the
// license state is a bare prefill, and nothing else is entered yet.
export function initialDraft(email: string): IntakeDraft {
  const empty = { value: null, source: null };
  return {
    identity: {
      firstName: { value: "Anita", source: ROSTER },
      lastName: { value: "Rao", source: ROSTER },
      npi: empty,
      taxonomyCode: empty,
      dateOfBirth: empty,
      caqhId: empty,
      ssnOnFile: false,
    },
    contact: { email, mobile: empty, homeAddress: empty },
    licenses: [{ state: { value: "NC", source: null }, number: empty, expiresOn: empty }],
    logins: { caqhOnFile: false, pecosOnFile: false },
  };
}

const auto = (key: string, label: string): VerificationCheck => ({
  key,
  label,
  status: "confirmed",
  method: "auto",
  confirmedBy: null,
  action: null,
});

// Lena's Verification block (board 6b): ten automatic checks, three for a person.
export const VERIFICATION_CHECKS: VerificationCheck[] = [
  {
    key: "caqh_login",
    label: "CAQH login",
    status: "pending",
    method: "person",
    confirmedBy: null,
    action: "test_login",
  },
  {
    key: "pecos_login",
    label: "PECOS login",
    status: "pending",
    method: "person",
    confirmedBy: null,
    action: "test_login",
  },
  {
    key: "license_nc",
    label: "NC PTA license",
    status: "pending",
    method: "person",
    confirmedBy: null,
    action: "confirm",
  },
  auto("npi", "NPI"),
  auto("caqh_id", "CAQH ID"),
  auto("caqh_attested", "CAQH attested within 120 days"),
  auto("license_per_state", "License per target state · NC"),
  auto("dob_ssn", "Date of birth and SSN on file"),
  auto("logins_on_file", "CAQH and PECOS logins on file"),
  auto("group_docs", "Group W-9, COI, contract, location in state"),
  auto("required_docs", "Required documents on file (CV, license copy)"),
  auto("no_duplicate", "No duplicate NPI in group"),
  auto("group_location", "Group and location assigned"),
];

// Provider Onboarding funnel (Oct 20 review, RC-06; stage names from the PM,
// Oct 30). The funnel is the provider's state, not case status: payer work
// can start only once the profile is in, verified, and assigned to a group
// and a location. That is "Ready for credentialing". Every counted provider
// sits in exactly one stage, derived at read time and never stored:
//
//   Invited                  invited to the intake form, nothing submitted.
//                            Shown only when the intake tables can be read
//                            (input.intakeReadable). Today
//                            provider_intake_invites is service-role only
//                            (MINT-89), so the stage is hidden and nobody is
//                            placed in it. Slice 2 adds the invite rows and
//                            the rule here, then turns intakeReadable on.
//   Profile incomplete       missing NPI, CAQH ID, date of birth, SSN last 4,
//                            or a license (any license with a valid state
//                            code, and one for each state they are assigned
//                            to work in). Not in the PM's Oct 30 list: it
//                            stands in for "not yet submitted" while intake
//                            data cannot be read, and it stays for providers
//                            added by staff or by CSV with no invite. Once
//                            intake data can be read, slice 2 decides which
//                            stage wins for a provider who is both Invited
//                            and Profile incomplete, and merges this
//                            vocabulary with OnboardingStage in
//                            src/types/providerOnboarding.ts (ready,
//                            in_credentialing).
//   Submitted                the information is in but not verified or not
//                            assigned: a working-state license is not
//                            board-verified, is expired, or has no expiration
//                            date; CAQH is not attested within the last 120
//                            days (a future date never counts); the record is
//                            pending verification; there is no current
//                            membership in an active group, or no assignment
//                            to an active location; or any active location
//                            has no valid state on record
//   Ready for credentialing  verified, assigned to a group and a location,
//                            and no case exists yet
//   Credentialing            at least one credentialing case exists, in any
//                            status (a denied case counts). The case board
//                            breaks cases down by status; this funnel does not.
//
// Licenses are judged for the states of the provider's active locations. A
// provider with no active location has every license on file judged instead;
// that fallback only fills the Submitted gap list, since they are never
// Ready. Ready means verified for every place they work, and no license can
// be judged for a location with no valid state. So if ANY active location
// lacks one, the provider stays in Submitted ("Location has no state on
// record"), even when their other locations pass; the all-licenses fallback
// never stands in for that location. Billing Readiness holds such a
// location the same way. (Reference-only locations never reach this input.)
//
// A group membership counts until its end date passes. Its start date is
// ignored on purpose: credentialing happens before a provider starts, so a
// membership that begins in the future already counts here. Billing
// Readiness (src/lib/billingReadiness.ts) and the contract SOP assignments
// (src/services/contractSopAssignments.ts) do require a start date on or
// before today, because they ask who is working now.
//
// Not the provider onboarding (intake) flow in src/lib/providerOnboarding.ts:
// this is the Reporting Center funnel over the provider records themselves.
// PHI rule: demographics arrive as presence booleans only. Pure; "today" is
// passed in.
import { isCaqhCurrent, CAQH_CURRENT_DAYS } from "@/lib/enrollmentReadiness";

export type OnboardingFunnelStage =
  "invited" | "profile_incomplete" | "submitted" | "ready_for_credentialing" | "credentialing";

export interface OnboardingFunnelStageInfo {
  key: OnboardingFunnelStage;
  title: string;
  description: string;
  /** Shown only when the intake tables can be read (Invited). */
  needsIntakeData: boolean;
  /** Providers here are held by gaps the report lists ("What's needed"). */
  listsGaps: boolean;
}

/** Every stage, in funnel order. */
export const ONBOARDING_FUNNEL_STAGES: ReadonlyArray<OnboardingFunnelStageInfo> = [
  {
    key: "invited",
    title: "Invited",
    description: "Invited to the intake form. Nothing submitted yet.",
    needsIntakeData: true,
    listsGaps: false,
  },
  {
    key: "profile_incomplete",
    title: "Profile incomplete",
    description: "Missing NPI, CAQH ID, demographics, or a license.",
    needsIntakeData: false,
    listsGaps: true,
  },
  {
    key: "submitted",
    title: "Submitted",
    description: "Information is in, but not yet verified or assigned to a group and location.",
    needsIntakeData: false,
    listsGaps: true,
  },
  {
    key: "ready_for_credentialing",
    title: "Ready for credentialing",
    description: "Verified and assigned to a group and location. No case yet.",
    needsIntakeData: false,
    listsGaps: false,
  },
  {
    key: "credentialing",
    title: "Credentialing",
    description: "Has at least one credentialing case, in any status.",
    needsIntakeData: false,
    listsGaps: false,
  },
];

/** The stages the report shows. Invited needs the intake tables. */
export function visibleOnboardingFunnelStages(
  intakeReadable: boolean,
): ReadonlyArray<OnboardingFunnelStageInfo> {
  return ONBOARDING_FUNNEL_STAGES.filter((stage) => intakeReadable || !stage.needsIntakeData);
}

export interface OnboardingFunnelProviderFacts {
  providerId: string;
  name: string;
  npi: string | null;
  caqhIdPresent: boolean;
  caqhLastAttestedDate: string | null;
  dobPresent: boolean;
  ssnLast4Present: boolean;
  pendingVerification: boolean;
}

export interface OnboardingFunnelLicenseInput {
  providerId: string | null;
  state: string;
  verifiedStatus: string;
  expirationDate: string | null;
}

export interface OnboardingFunnelInput {
  providers: readonly OnboardingFunnelProviderFacts[];
  licenses: readonly OnboardingFunnelLicenseInput[];
  /** One row per assignment to an active, non-reference location, with its state. */
  workStates: ReadonlyArray<{ providerId: string | null; state: string | null }>;
  /** Memberships in active groups; one that ended before today does not count,
   * and the start date is deliberately not read (see the header). */
  groupMemberships: ReadonlyArray<{ providerId: string | null; endDate: string | null }>;
  cases: ReadonlyArray<{ providerId: string | null; state: string | null }>;
  /** False while the intake tables cannot be read (MINT-89): Invited stays hidden. */
  intakeReadable: boolean;
}

export interface OnboardingFunnelRow {
  providerId: string;
  name: string;
  npi: string | null;
  stage: OnboardingFunnelStage;
  /** What keeps the provider in their stage; empty for the last two stages. */
  gaps: string[];
  states: string[];
}

function code(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function groupByProvider<T extends { providerId: string | null }>(rows: readonly T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.providerId) continue;
    map.set(row.providerId, [...(map.get(row.providerId) ?? []), row]);
  }
  return map;
}

function assignmentGaps(hasGroup: boolean, hasLocation: boolean): string[] {
  if (hasGroup && hasLocation) return [];
  if (!hasGroup && !hasLocation) return ["Needs a group and a location"];
  return [hasGroup ? "Needs a location" : "Needs a group"];
}

export function buildOnboardingFunnelRows(
  input: OnboardingFunnelInput,
  today: string,
): OnboardingFunnelRow[] {
  const licensesBy = groupByProvider(input.licenses);
  const workBy = groupByProvider(input.workStates);
  const casesBy = groupByProvider(input.cases);
  const grouped = new Set(
    input.groupMemberships
      .filter((m) => m.endDate === null || m.endDate.slice(0, 10) >= today)
      .map((m) => m.providerId)
      .filter((id): id is string => id !== null),
  );

  return input.providers
    .map((p): OnboardingFunnelRow => {
      const licenses = licensesBy.get(p.providerId) ?? [];
      const hasLocation = workBy.has(p.providerId);
      const statelessLocation = (workBy.get(p.providerId) ?? []).some(
        (row) => code(row.state) === null,
      );
      const workStates = [
        ...new Set((workBy.get(p.providerId) ?? []).map((row) => code(row.state))),
      ].filter((s): s is string => s !== null);
      const cases = casesBy.get(p.providerId) ?? [];
      const states = [
        ...new Set(
          [
            ...workStates,
            ...licenses.map((l) => code(l.state)),
            ...cases.map((c) => code(c.state)),
          ].filter((s): s is string => s !== null),
        ),
      ].sort();
      const base = { providerId: p.providerId, name: p.name, npi: p.npi, states };
      // Any case, whatever its status, means credentialing has started.
      if (cases.length > 0) return { ...base, stage: "credentialing", gaps: [] };

      // A license only counts once its state code is valid: one with a blank or
      // unknown state can never be checked against a working state.
      const stateLicenses = licenses.filter((l) => code(l.state) !== null);
      const licenseStates = new Set(stateLicenses.map((l) => code(l.state) as string));
      const profileGaps = [
        ...(p.npi?.trim() ? [] : ["No NPI"]),
        ...(p.caqhIdPresent ? [] : ["No CAQH ID"]),
        ...(p.dobPresent ? [] : ["No date of birth"]),
        ...(p.ssnLast4Present ? [] : ["No SSN last 4"]),
        ...(stateLicenses.length === 0
          ? [licenses.length === 0 ? "No state license" : "License state is missing or invalid"]
          : []),
        ...(stateLicenses.length === 0
          ? []
          : workStates.filter((s) => !licenseStates.has(s)).map((s) => `No ${s} license`)),
      ];
      if (profileGaps.length > 0)
        return { ...base, stage: "profile_incomplete", gaps: profileGaps };

      // Judge the licenses for the states they work in; with no location
      // yet, every license on file. A location with no valid state gets no
      // fallback: its gap below keeps the provider out of Ready, whatever
      // their other locations show.
      const judged = hasLocation ? workStates : [...licenseStates];
      const submittedGaps: string[] = [];
      for (const state of judged) {
        const best = stateLicenses
          .filter((l) => code(l.state) === state)
          .sort(
            (a, b) =>
              Number(b.verifiedStatus === "verified") - Number(a.verifiedStatus === "verified") ||
              (b.expirationDate ?? "").localeCompare(a.expirationDate ?? ""),
          )[0];
        if (!best) continue;
        if (best.verifiedStatus !== "verified")
          submittedGaps.push(`${state} license not board-verified`);
        // As in the enrollment readiness matrix, a license with no expiration
        // date is not unexpired.
        if (!best.expirationDate) submittedGaps.push(`${state} license has no expiration date`);
        else if (best.expirationDate.slice(0, 10) < today)
          submittedGaps.push(`${state} license expired`);
      }
      const attested = p.caqhLastAttestedDate?.slice(0, 10) ?? null;
      if (!isCaqhCurrent(attested, today)) {
        submittedGaps.push(
          !attested
            ? "CAQH never attested"
            : attested > today
              ? "CAQH attestation date is in the future"
              : `CAQH attestation older than ${CAQH_CURRENT_DAYS} days`,
        );
      }
      if (p.pendingVerification) submittedGaps.push("Record pending verification");
      // Verified is not enough: Ready needs a group and a location.
      submittedGaps.push(...assignmentGaps(grouped.has(p.providerId), hasLocation));
      if (statelessLocation) submittedGaps.push("Location has no valid state on record");
      if (submittedGaps.length > 0) return { ...base, stage: "submitted", gaps: submittedGaps };
      return { ...base, stage: "ready_for_credentialing", gaps: [] };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.providerId.localeCompare(b.providerId));
}

export function onboardingFunnelStageCounts(
  rows: readonly OnboardingFunnelRow[],
): Record<OnboardingFunnelStage, number> {
  const counts: Record<OnboardingFunnelStage, number> = {
    invited: 0,
    profile_incomplete: 0,
    submitted: 0,
    ready_for_credentialing: 0,
    credentialing: 0,
  };
  for (const row of rows) counts[row.stage] += 1;
  return counts;
}

/** Every state any provider touches (work, license, or case), A→Z. */
export function onboardingFunnelStates(rows: readonly OnboardingFunnelRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.states))].sort();
}

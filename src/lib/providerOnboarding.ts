// Provider Onboarding funnel (Oct 20 review, RC-06). Onboarding = a provider
// record exists but is incomplete, fails readiness, or cannot start
// enrollment (PM definition 2026-10-20). Every counted provider sits in
// exactly one of four stages, derived at read time and never stored:
//
//   1. Profile incomplete     missing NPI, CAQH ID, date of birth, SSN last 4,
//                             or a license (any license, and one for each
//                             state they are assigned to work in)
//   2. Awaiting verification  profile complete, but a working-state license is
//                             not board-verified or is expired, CAQH is not
//                             attested within 120 days, or the record is
//                             pending verification
//   3. Ready to credential    every check passes and no case exists yet
//   4. Credentialing          at least one credentialing case exists
//
// "Invited" joins ahead of stage 1 once provider invites ship (RC-14).
// PHI rule: demographics arrive as presence booleans only. Pure; "today" is
// passed in.
import { isCaqhCurrent, CAQH_CURRENT_DAYS } from "@/lib/enrollmentReadiness";

export type OnboardingStage =
  "profile_incomplete" | "awaiting_verification" | "ready_to_credential" | "credentialing";

export const ONBOARDING_STAGES: ReadonlyArray<{
  key: OnboardingStage;
  title: string;
  description: string;
}> = [
  {
    key: "profile_incomplete",
    title: "Profile incomplete",
    description: "Missing NPI, CAQH ID, demographics, or a license.",
  },
  {
    key: "awaiting_verification",
    title: "Awaiting verification",
    description: "License, CAQH attestation, or record still needs verification.",
  },
  {
    key: "ready_to_credential",
    title: "Ready to credential",
    description: "Everything checks out. No enrollment started yet.",
  },
  {
    key: "credentialing",
    title: "Credentialing",
    description: "At least one payer enrollment is underway or done.",
  },
];

export interface OnboardingProviderFacts {
  providerId: string;
  name: string;
  npi: string | null;
  caqhIdPresent: boolean;
  caqhLastAttestedDate: string | null;
  dobPresent: boolean;
  ssnLast4Present: boolean;
  pendingVerification: boolean;
}

export interface OnboardingLicenseInput {
  providerId: string | null;
  state: string;
  verifiedStatus: string;
  expirationDate: string | null;
}

export interface OnboardingInput {
  providers: readonly OnboardingProviderFacts[];
  licenses: readonly OnboardingLicenseInput[];
  /** States of the active locations each provider is assigned to. */
  workStates: ReadonlyArray<{ providerId: string | null; state: string | null }>;
  cases: ReadonlyArray<{ providerId: string | null; state: string | null }>;
}

export interface OnboardingRow {
  providerId: string;
  name: string;
  npi: string | null;
  stage: OnboardingStage;
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

export function buildOnboardingRows(input: OnboardingInput, today: string): OnboardingRow[] {
  const licensesBy = groupByProvider(input.licenses);
  const workBy = groupByProvider(input.workStates);
  const casesBy = groupByProvider(input.cases);

  return input.providers
    .map((p): OnboardingRow => {
      const licenses = licensesBy.get(p.providerId) ?? [];
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
      if (cases.length > 0) return { ...base, stage: "credentialing", gaps: [] };

      const licenseStates = new Set(licenses.map((l) => code(l.state)));
      const profileGaps = [
        ...(p.npi?.trim() ? [] : ["No NPI"]),
        ...(p.caqhIdPresent ? [] : ["No CAQH ID"]),
        ...(p.dobPresent ? [] : ["No date of birth"]),
        ...(p.ssnLast4Present ? [] : ["No SSN last 4"]),
        ...(licenses.length === 0 ? ["No state license"] : []),
        ...(licenses.length === 0
          ? []
          : workStates.filter((s) => !licenseStates.has(s)).map((s) => `No ${s} license`)),
      ];
      if (profileGaps.length > 0)
        return { ...base, stage: "profile_incomplete", gaps: profileGaps };

      // Judge the licenses for the states they work in; with no assignment
      // yet, every license on file.
      const judged = workStates.length > 0 ? workStates : [...licenseStates].filter(Boolean);
      const verificationGaps: string[] = [];
      for (const state of judged as string[]) {
        const best = licenses
          .filter((l) => code(l.state) === state)
          .sort(
            (a, b) =>
              Number(b.verifiedStatus === "verified") - Number(a.verifiedStatus === "verified") ||
              (b.expirationDate ?? "").localeCompare(a.expirationDate ?? ""),
          )[0];
        if (!best) continue;
        if (best.verifiedStatus !== "verified")
          verificationGaps.push(`${state} license not board-verified`);
        if (!best.expirationDate || best.expirationDate.slice(0, 10) < today)
          verificationGaps.push(`${state} license expired`);
      }
      if (!isCaqhCurrent(p.caqhLastAttestedDate, today)) {
        verificationGaps.push(
          p.caqhLastAttestedDate
            ? `CAQH attestation older than ${CAQH_CURRENT_DAYS} days`
            : "CAQH never attested",
        );
      }
      if (p.pendingVerification) verificationGaps.push("Record pending verification");
      if (verificationGaps.length > 0)
        return { ...base, stage: "awaiting_verification", gaps: verificationGaps };
      return { ...base, stage: "ready_to_credential", gaps: [] };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.providerId.localeCompare(b.providerId));
}

export function onboardingStageCounts(
  rows: readonly OnboardingRow[],
): Record<OnboardingStage, number> {
  const counts: Record<OnboardingStage, number> = {
    profile_incomplete: 0,
    awaiting_verification: 0,
    ready_to_credential: 0,
    credentialing: 0,
  };
  for (const row of rows) counts[row.stage] += 1;
  return counts;
}

/** Every state any provider touches (work, license, or case), A→Z. */
export function onboardingStates(rows: readonly OnboardingRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.states))].sort();
}

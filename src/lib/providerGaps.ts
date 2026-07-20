// E6.4 F6.4.1 — the roster's ambient gap pills. NOT a new gap engine: every
// derivation here re-states an existing rule over data the roster already
// loads — the readiness lib's CAQH window (CAQH_CURRENT_DAYS) and license
// expiry semantics, the fixit-fields presence check for NPI/CAQH id, and the
// E2.0 candidacy rule that a provider without a facility assignment can never
// generate a case. Pure and date-only: `today` is always passed in, never
// read from a clock. Reference-only and terminated providers never gap.
import { CAQH_CURRENT_DAYS } from "@/lib/enrollmentReadiness";
import type { Provider } from "@/types";

export type ProviderGapKey =
  | "no_facility"
  | "missing_npi"
  | "missing_caqh"
  | "stale_caqh"
  | "license_expired"
  | "license_expiring";

export interface ProviderGap {
  key: ProviderGapKey;
  label: string;
  /** The record section the pill deep-links (F6.4.1: pill → focused section). */
  section: "identity" | "groups-facilities" | "licenses";
}

export interface ProviderGapInputs {
  provider: Pick<
    Provider,
    "id" | "status" | "referenceOnly" | "npi" | "caqhId" | "caqhLastAttestedDate"
  >;
  /** Does the provider have ≥1 provider_facility_assignments row? */
  hasFacilityAssignment: boolean;
  /** The soonest license expiration date (ISO) among the provider's licenses,
   * or null when they hold no dated licenses. */
  soonestLicenseExpiry: string | null;
  /** ISO date for "today" — date-only math, never a clock read here. */
  today: string;
}

export const LICENSE_EXPIRING_DAYS = 90;

const dayDiff = (aIso: string, bIso: string): number => {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
};

/** Derive the ordered gap list for one roster row. Order = severity the PM
 * cares about: can't-generate first (no facility), identity blanks, then the
 * date-driven staleness pills. */
export function deriveProviderGaps(inputs: ProviderGapInputs): ProviderGap[] {
  const { provider, hasFacilityAssignment, soonestLicenseExpiry, today } = inputs;
  if (provider.referenceOnly || provider.status === "terminated") return [];

  const gaps: ProviderGap[] = [];
  if (!hasFacilityAssignment) {
    // E2.0 candidacy: no assignment ⇒ not generatable — the F6.4.1 flag.
    gaps.push({
      key: "no_facility",
      label: "No facility assignment",
      section: "groups-facilities",
    });
  }
  if (!provider.npi) {
    gaps.push({ key: "missing_npi", label: "Missing NPI", section: "identity" });
  }
  if (!provider.caqhId) {
    gaps.push({ key: "missing_caqh", label: "Missing CAQH ID", section: "identity" });
  } else if (
    !provider.caqhLastAttestedDate ||
    dayDiff(today, provider.caqhLastAttestedDate) > CAQH_CURRENT_DAYS
  ) {
    gaps.push({ key: "stale_caqh", label: "CAQH attestation stale", section: "identity" });
  }
  if (soonestLicenseExpiry) {
    const days = dayDiff(soonestLicenseExpiry, today);
    if (days < 0) {
      gaps.push({ key: "license_expired", label: "License expired", section: "licenses" });
    } else if (days <= LICENSE_EXPIRING_DAYS) {
      gaps.push({ key: "license_expiring", label: "License expiring soon", section: "licenses" });
    }
  }
  return gaps;
}

/** A→Z by last name, then first name, then id — the fixed roster sort
 * (stated on screen; search and filters never change it). */
export function sortRosterAz<T extends { lastName: string; firstName: string; id: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" }) ||
      a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

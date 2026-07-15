// E4.2 F4.2.6 / TE-13 — upstream profile gating ("phantom provider" fix).
// An SOP can declare REQUIRED provider-profile attributes from THIS governed
// key list (never free-text field paths). During generation preview the pure
// candidate filter evaluates the gate and surfaces providers missing the
// specific attributes, instead of generating a case that stalls mid-pipeline.
// No stored "blocked" state — the gate is re-derived every preview.
//
// Keys map onto the presence booleans the readiness-facts service already
// computes at the PHI boundary (values never leave the service), so gating adds
// no new PHI read.

import type { ProviderReadinessFacts } from "./enrollmentReadiness";

export type ProfileAttributeKey =
  | "caqh_id"
  | "caqh_attested"
  | "npi"
  | "dob"
  | "ssn_last4"
  | "home_address"
  | "malpractice_coverage";

interface ProfileAttributeDef {
  key: ProfileAttributeKey;
  /** Human label shown in the SOP config and the preview skip reason. */
  label: string;
  /** Satisfied when the provider's profile carries this attribute. */
  satisfied: (facts: ProviderReadinessFacts) => boolean;
}

// The governed catalog. Order is the display order in the SOP config picker.
export const PROFILE_ATTRIBUTES: readonly ProfileAttributeDef[] = [
  { key: "caqh_id", label: "CAQH ID", satisfied: (f) => f.caqhIdPresent },
  {
    key: "caqh_attested",
    label: "CAQH attestation on file",
    satisfied: (f) => f.caqhLastAttestedDate !== null,
  },
  { key: "npi", label: "NPI", satisfied: (f) => f.npiPresent },
  { key: "dob", label: "Date of birth", satisfied: (f) => f.dobPresent },
  { key: "ssn_last4", label: "SSN (last 4)", satisfied: (f) => f.ssnLast4Present },
  { key: "home_address", label: "Home address", satisfied: (f) => f.homeAddressPresent },
  {
    key: "malpractice_coverage",
    label: "Malpractice coverage",
    satisfied: (f) => f.malpracticeCoverageEnd !== null,
  },
];

const BY_KEY = new Map<ProfileAttributeKey, ProfileAttributeDef>(
  PROFILE_ATTRIBUTES.map((a) => [a.key, a]),
);

export const PROFILE_ATTRIBUTE_KEYS: readonly ProfileAttributeKey[] = PROFILE_ATTRIBUTES.map(
  (a) => a.key,
);

export function isProfileAttributeKey(value: unknown): value is ProfileAttributeKey {
  return typeof value === "string" && BY_KEY.has(value as ProfileAttributeKey);
}

export function profileAttributeLabel(key: ProfileAttributeKey): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Coerce a raw stored `required_profile_attributes` jsonb into the governed
 * key set — anything not in the catalog is dropped, deduped, order-preserved. */
export function normalizeRequiredAttributes(raw: unknown): ProfileAttributeKey[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileAttributeKey[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (isProfileAttributeKey(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export interface UnmetAttribute {
  key: ProfileAttributeKey;
  label: string;
}

export interface ProfileGateResult {
  passed: boolean;
  /** Empty when passed; otherwise the specific missing attributes, in catalog
   * order, for the preview skip reason + outreach-task title. */
  unmet: UnmetAttribute[];
}

/** Evaluate a provider against an SOP's required attributes. Pure. */
export function evaluateProfileGate(
  required: readonly ProfileAttributeKey[],
  facts: ProviderReadinessFacts,
): ProfileGateResult {
  const unmet: UnmetAttribute[] = [];
  for (const attr of PROFILE_ATTRIBUTES) {
    if (required.includes(attr.key) && !attr.satisfied(facts)) {
      unmet.push({ key: attr.key, label: attr.label });
    }
  }
  return { passed: unmet.length === 0, unmet };
}

/** Compose the outreach-task title (TE-13) from the unmet attributes — the
 * task the operator can spawn per blocked provider. */
export function outreachTaskTitle(providerName: string, unmet: readonly UnmetAttribute[]): string {
  const labels = unmet.map((u) => u.label).join(", ");
  return `Collect missing info from ${providerName}: ${labels}`;
}

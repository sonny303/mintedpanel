// Closed NUCC taxonomy catalog for provider create/edit pickers.
// PT/PTA codes are the historical default set; additional specialties are
// appended as product needs them (e.g. dietitian). Validation is soft —
// the picker is the gate; unknown free-text values are no longer hard-blocked
// outside of "must be one of the offered codes" when a value is present.

// code → human label. Order: PT base, PT specializations, PTA, then other.
export const PROVIDER_TAXONOMY_CODES: Readonly<Record<string, string>> = {
  "225100000X": "Physical Therapist",
  "2251C2600X": "Physical Therapist, Cardiopulmonary",
  "2251E1200X": "Physical Therapist, Ergonomics",
  "2251E1300X": "Physical Therapist, Clinical Electrophysiology",
  "2251G0304X": "Physical Therapist, Geriatrics",
  "2251H1200X": "Physical Therapist, Hand",
  "2251H1300X": "Physical Therapist, Human Factors",
  "2251N0400X": "Physical Therapist, Neurology",
  "2251P0200X": "Physical Therapist, Pediatrics",
  "2251S0007X": "Physical Therapist, Sports",
  "2251X0800X": "Physical Therapist, Orthopedic",
  "225200000X": "Physical Therapist Assistant",
  "133V00000X": "Dietitian, Nutrition, Registered",
} as const;

export type ProviderTaxonomyOption = { code: string; label: string };

/** Ordered options for select UIs (code + label). */
export const PROVIDER_TAXONOMY_OPTIONS: readonly ProviderTaxonomyOption[] = Object.entries(
  PROVIDER_TAXONOMY_CODES,
).map(([code, label]) => ({ code, label }));

// Normalize user input for comparison: trim and upper-case (the trailing check
// digit is a letter, and specialization codes embed letters).
export function normalizeTaxonomyCode(code: string): string {
  return code.trim().toUpperCase();
}

/** True when the code is in the offered provider taxonomy catalog. */
export function isKnownTaxonomyCode(code: string): boolean {
  return normalizeTaxonomyCode(code) in PROVIDER_TAXONOMY_CODES;
}

/** The label for a catalog code, else null. */
export function taxonomyLabel(code: string): string | null {
  return PROVIDER_TAXONOMY_CODES[normalizeTaxonomyCode(code)] ?? null;
}

/**
 * Options for a select that already holds `current`. If the stored value is
 * outside the catalog (legacy free-text), surface it so the control can still
 * display — the user can keep it or pick a catalog code.
 */
export function taxonomyOptionsForValue(
  current: string | null | undefined,
): readonly ProviderTaxonomyOption[] {
  const normalized = current ? normalizeTaxonomyCode(current) : "";
  if (!normalized || isKnownTaxonomyCode(normalized)) return PROVIDER_TAXONOMY_OPTIONS;
  return [...PROVIDER_TAXONOMY_OPTIONS, { code: normalized, label: "Current value (not in catalog)" }];
}

// Physical Therapy provider taxonomy (NUCC) — the closed set of codes valid for
// a PT platform. Physical Therapists live under the 2251* branch (base +
// specializations); Physical Therapist Assistants are 225200000X. Used to
// validate the provider's taxonomy code so a non-PT classification never
// advances in the credentialing queue.

// code → human label, ordered PT base, PT specializations, then PTA.
export const PT_TAXONOMY_CODES: Readonly<Record<string, string>> = {
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
} as const;

// Normalize user input for comparison: trim and upper-case (the trailing check
// digit is a letter, and specialization codes embed letters).
export function normalizeTaxonomyCode(code: string): string {
  return code.trim().toUpperCase();
}

// True when the code is one of the recognized PT/PTA taxonomy codes.
export function isPtTaxonomyCode(code: string): boolean {
  return normalizeTaxonomyCode(code) in PT_TAXONOMY_CODES;
}

// The label for a recognized PT/PTA taxonomy code, else null.
export function ptTaxonomyLabel(code: string): string | null {
  return PT_TAXONOMY_CODES[normalizeTaxonomyCode(code)] ?? null;
}

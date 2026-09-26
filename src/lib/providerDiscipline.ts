// Pure NUCC taxonomy crosswalk mapping provider taxonomy codes to clinical disciplines.
// Standard therapy disciplines: PT, PTA, OT, OTA, SLP.
// Recognized non-therapy codes (e.g. Dietitian) map to Other.
// Unrecognized or blank codes map to Unknown.

import { isKnownTaxonomyCode, normalizeTaxonomyCode } from "./providerTaxonomy";

export type ProviderDiscipline = "PT" | "PTA" | "OT" | "OTA" | "SLP" | "Other" | "Unknown";

export const DISCIPLINE_LABELS: Record<ProviderDiscipline, string> = {
  PT: "Physical Therapist (PT)",
  PTA: "Physical Therapist Assistant (PTA)",
  OT: "Occupational Therapist (OT)",
  OTA: "Occupational Therapy Assistant (OTA)",
  SLP: "Speech-Language Pathologist (SLP)",
  Other: "Other",
  Unknown: "Unknown",
};

export const CLINICAL_DISCIPLINES: readonly ProviderDiscipline[] = [
  "PT",
  "PTA",
  "OT",
  "OTA",
  "SLP",
  "Other",
  "Unknown",
] as const;

// NUCC Prefix & Code mappings
// PT: 2251... (base + specializations)
// PTA: 2252...
// OT: 225X... (base + specializations)
// OTA: 224Z... (base + specializations)
// SLP: 235Z... (Speech-Language Pathology) or 2355...
export function deriveProviderDiscipline(taxonomyCode: string | null | undefined): ProviderDiscipline {
  if (!taxonomyCode || !taxonomyCode.trim()) {
    return "Unknown";
  }

  const normalized = normalizeTaxonomyCode(taxonomyCode);

  // Physical Therapist
  if (normalized.startsWith("2251")) {
    return "PT";
  }

  // Physical Therapist Assistant
  if (normalized.startsWith("2252")) {
    return "PTA";
  }

  // Occupational Therapist
  if (normalized.startsWith("225X")) {
    return "OT";
  }

  // Occupational Therapy Assistant
  if (normalized.startsWith("224Z")) {
    return "OTA";
  }

  // Speech-Language Pathologist
  if (normalized.startsWith("235Z") || normalized.startsWith("2355")) {
    return "SLP";
  }

  // Check if known non-therapy code in the system catalog (e.g. Dietitian 133V00000X)
  if (isKnownTaxonomyCode(normalized)) {
    return "Other";
  }

  return "Unknown";
}

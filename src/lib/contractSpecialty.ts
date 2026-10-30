// The specialty grain of a group contract (`contracts.specialty_key`).
//
// A contract record covers one specialty, or `all` — one agreement covering
// every specialty of that group in that state. Whoever asks "which contract
// applies here?" for a specialty gets that specialty's own record first and the
// group's `all` record second; a caller with no known specialty gets only the
// `all` record. The matrix, the contract dialog and the readiness check all
// resolve through this module so they can never disagree.
//
// A provider's specialty comes from an exact NUCC taxonomy code, never a
// prefix guess (see providerDiscipline.ts). No I/O and no clock reads.
import { providerDisciplineForTaxonomy } from "@/lib/providerDiscipline";
import { NUCC_TAXONOMY_CODES } from "@/lib/nuccTaxonomyCodes";
import { normalizeTaxonomyCode } from "@/lib/providerTaxonomy";
import type { ContractSpecialtyKey } from "@/types";

export type { ContractSpecialtyKey };

/** A specialty a single record can be narrowed to (everything but `all`). */
export type ContractSpecialty = Exclude<ContractSpecialtyKey, "all">;

export const CONTRACT_SPECIALTY_KEYS: readonly ContractSpecialtyKey[] = [
  "all",
  "pt",
  "ot",
  "slp",
  "nutrition",
  "chiro",
];

/** The specialties the matrix renders a table for, in display order. v1 is
 * Physical therapy and Nutrition (PM decision D15, Oct 29, 2026). */
export const MATRIX_SPECIALTIES: readonly ContractSpecialty[] = ["pt", "nutrition"];

export const CONTRACT_SPECIALTY_LABELS: Readonly<Record<ContractSpecialtyKey, string>> = {
  all: "All specialties",
  pt: "Physical therapy",
  ot: "Occupational therapy",
  slp: "Speech-language pathology",
  nutrition: "Nutrition",
  chiro: "Chiropractic",
};

const NUTRITION_CODES: ReadonlySet<string> = new Set(
  [...NUCC_TAXONOMY_CODES].filter((code) => code.startsWith("133V") || code.startsWith("133N")),
);

const CHIRO_CODES: ReadonlySet<string> = new Set(
  [...NUCC_TAXONOMY_CODES].filter((code) => code.startsWith("111N")),
);

export function isContractSpecialtyKey(value: unknown): value is ContractSpecialtyKey {
  return (
    typeof value === "string" && (CONTRACT_SPECIALTY_KEYS as readonly string[]).includes(value)
  );
}

/** A record's specialty. A missing or unrecognized key reads as `all`. */
export function contractSpecialtyKeyOf(contract: {
  specialtyKey?: string | null;
}): ContractSpecialtyKey {
  return isContractSpecialtyKey(contract.specialtyKey) ? contract.specialtyKey : "all";
}

/** The contract specialty a provider's taxonomy code belongs to, or null when
 * the code is blank, unknown, or outside every contract specialty. PTA counts
 * as Physical therapy and OTA as Occupational therapy. */
export function contractSpecialtyForTaxonomy(
  taxonomyCode: string | null | undefined,
): ContractSpecialty | null {
  switch (providerDisciplineForTaxonomy(taxonomyCode)) {
    case "PT":
    case "PTA":
      return "pt";
    case "OT":
    case "OTA":
      return "ot";
    case "SLP":
      return "slp";
    case "Other": {
      const code = normalizeTaxonomyCode(taxonomyCode ?? "");
      if (NUTRITION_CODES.has(code)) return "nutrition";
      if (CHIRO_CODES.has(code)) return "chiro";
      return null;
    }
    default:
      return null;
  }
}

interface ContractKeyFields {
  groupId: string | null;
  payerId: string | null;
  state: string;
}

/** The group × payer × state part of the key, state upper-cased. */
export function contractTripleKey(key: ContractKeyFields): string {
  return `${key.groupId ?? ""}|${key.payerId ?? ""}|${key.state.toUpperCase()}`;
}

export type ContractSpecialtyIndex<T> = ReadonlyMap<string, ReadonlyMap<ContractSpecialtyKey, T>>;

/** Build once per derivation: triple key → specialty key → record. */
export function indexContractsBySpecialty<
  T extends ContractKeyFields & { specialtyKey?: string | null },
>(contracts: readonly T[]): ContractSpecialtyIndex<T> {
  const index = new Map<string, Map<ContractSpecialtyKey, T>>();
  for (const contract of contracts) {
    const triple = contractTripleKey(contract);
    const bySpecialty = index.get(triple) ?? new Map<ContractSpecialtyKey, T>();
    bySpecialty.set(contractSpecialtyKeyOf(contract), contract);
    index.set(triple, bySpecialty);
  }
  return index;
}

export interface ResolvedContract<T> {
  contract: T;
  /** True when the record is the group's `all` agreement, not one for this
   * specialty alone. */
  shared: boolean;
}

/** The record that applies to `specialty` at `key`: its own record first, then
 * the `all` record. A null specialty (unknown provider) gets only `all`. */
export function resolveContractForSpecialty<T>(
  index: ContractSpecialtyIndex<T>,
  key: ContractKeyFields,
  specialty: ContractSpecialtyKey | null,
): ResolvedContract<T> | null {
  const bySpecialty = index.get(contractTripleKey(key));
  if (!bySpecialty) return null;
  if (specialty && specialty !== "all") {
    const own = bySpecialty.get(specialty);
    if (own) return { contract: own, shared: false };
  }
  const shared = bySpecialty.get("all");
  return shared ? { contract: shared, shared: specialty !== "all" } : null;
}

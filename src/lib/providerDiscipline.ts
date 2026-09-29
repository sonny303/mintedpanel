import { normalizeTaxonomyCode } from "@/lib/providerTaxonomy";
import { NUCC_TAXONOMY_CODES } from "@/lib/nuccTaxonomyCodes";

export type ProviderDiscipline = "PT" | "PTA" | "OT" | "OTA" | "SLP" | "Other" | "Unknown";

/** Exact official taxonomy snapshot used by server-side discipline filters. */
export const KNOWN_NUCC_CODES: readonly string[] = Object.freeze([...NUCC_TAXONOMY_CODES].sort());

const PT_CODES = new Set([
  "225100000X",
  "2251C2600X",
  "2251E1200X",
  "2251E1300X",
  "2251G0304X",
  "2251H1200X",
  "2251H1300X",
  "2251N0400X",
  "2251P0200X",
  "2251S0007X",
  "2251X0800X",
]);

const PTA_CODES = new Set(["225200000X"]);

const OT_CODES = new Set([
  "225X00000X",
  "225XR0403X",
  "225XE0001X",
  "225XE1200X",
  "225XF0002X",
  "225XG0600X",
  "225XH1200X",
  "225XH1300X",
  "225XL0004X",
  "225XM0800X",
  "225XN1300X",
  "225XP0200X",
  "225XP0019X",
]);

const OTA_CODES = new Set(["224Z00000X", "224ZR0403X", "224ZE0001X", "224ZF0002X", "224ZL0004X"]);

const SLP_CODES = new Set(["235Z00000X"]);

const DISCIPLINE_CODES: Readonly<
  Record<Exclude<ProviderDiscipline, "Unknown">, readonly string[]>
> = Object.freeze({
  PT: Object.freeze([...PT_CODES].sort()),
  PTA: Object.freeze([...PTA_CODES].sort()),
  OT: Object.freeze([...OT_CODES].sort()),
  OTA: Object.freeze([...OTA_CODES].sort()),
  SLP: Object.freeze([...SLP_CODES].sort()),
  Other: Object.freeze(
    KNOWN_NUCC_CODES.filter(
      (code) =>
        !PT_CODES.has(code) &&
        !PTA_CODES.has(code) &&
        !OT_CODES.has(code) &&
        !OTA_CODES.has(code) &&
        !SLP_CODES.has(code),
    ),
  ),
});

/** Return the exact known codes for one non-Unknown category. Unknown is the
 * complement predicate: null/blank or a normalized value outside this catalog.
 */
export function getNuccCodesForDiscipline(
  discipline: Exclude<ProviderDiscipline, "Unknown">,
): readonly string[] {
  return DISCIPLINE_CODES[discipline];
}

/** Map only exact NUCC codes; prefixes are not reliable discipline evidence. */
export function providerDisciplineForTaxonomy(
  taxonomyCode: string | null | undefined,
): ProviderDiscipline {
  const code = normalizeTaxonomyCode(taxonomyCode ?? "");
  if (!code || !NUCC_TAXONOMY_CODES.has(code)) return "Unknown";
  if (PT_CODES.has(code)) return "PT";
  if (PTA_CODES.has(code)) return "PTA";
  if (OT_CODES.has(code)) return "OT";
  if (OTA_CODES.has(code)) return "OTA";
  if (SLP_CODES.has(code)) return "SLP";
  return "Other";
}

// Compatibility re-exports — catalog moved to providerTaxonomy.ts (PT + dietitian).
// Prefer importing from @/lib/providerTaxonomy.
export {
  PROVIDER_TAXONOMY_CODES as PT_TAXONOMY_CODES,
  isKnownTaxonomyCode as isPtTaxonomyCode,
  taxonomyLabel as ptTaxonomyLabel,
  normalizeTaxonomyCode,
} from "@/lib/providerTaxonomy";

// E6.9 F6.9.4/D8 — the grouped-by-family token picker presentation.
//
// Extracted from `TemplateWizard`, where it was a local `useMemo`, so the SOP
// authoring picker and the field-registry picker render the same catalog the
// same way. The epic's criterion is explicit that the helper is shared rather
// than duplicated: two copies of a grouping rule drift, and the registry's
// picker is meant to be the Data-fields picker, not a lookalike.
//
// Pure and catalog-agnostic: it groups whatever token list it is handed. The
// two callers legitimately hand it DIFFERENT lists — SOP authoring narrows to
// the ~19 keys `sopResolver.buildTokenMap` can resolve at case-creation time,
// while the registry maps against the full catalog the extension fills from —
// so this module deliberately does no filtering of its own.

/** One entry of the `get_sop_field_tokens()` catalog. Declared here rather
 * than in `@/types` because it is an RPC projection, not a table row — and it
 * was previously duplicated verbatim in two component files. */
export interface SopFieldToken {
  token: string;
  table: string;
  column: string;
}

export interface TokenGroup {
  prefix: string;
  label: string;
  items: SopFieldToken[];
}

export const TOKEN_GROUP_LABELS: Record<string, string> = {
  provider: "Provider",
  group: "Group",
  facility: "Facility",
  payer: "Payer",
  mso: "MSO",
  contract: "Contract",
  license: "License",
  assignment: "Assignment",
  groupInsurance: "Group Insurance",
  user: "User",
  billingContact: "Billing Contact",
  credentialingContact: "Credentialing Contact",
  contractingSigner: "Contracting Signer",
};

export const TOKEN_GROUP_ORDER = [
  "provider",
  "group",
  "facility",
  "payer",
  "mso",
  "contract",
  "license",
  "assignment",
  "groupInsurance",
  "user",
  "billingContact",
  "credentialingContact",
  "contractingSigner",
];

/**
 * Group tokens by their family prefix for a picker.
 *
 * Known families lead in the curated order; ANY unexpected prefix follows,
 * alphabetically, rather than being dropped — a token the catalog serves but
 * this list has not heard of must still be selectable, or a new column silently
 * becomes unmappable.
 */
export function groupTokens(tokens: readonly SopFieldToken[]): TokenGroup[] {
  const byPrefix = new Map<string, SopFieldToken[]>();
  for (const token of tokens) {
    const prefix = token.token.split(".")[0];
    const bucket = byPrefix.get(prefix) ?? [];
    bucket.push(token);
    byPrefix.set(prefix, bucket);
  }
  const known = TOKEN_GROUP_ORDER.filter((prefix) => byPrefix.has(prefix));
  const extra = [...byPrefix.keys()].filter((p) => !TOKEN_GROUP_ORDER.includes(p)).sort();
  return [...known, ...extra].map((prefix) => ({
    prefix,
    label: TOKEN_GROUP_LABELS[prefix] ?? prefix,
    items: byPrefix.get(prefix) ?? [],
  }));
}

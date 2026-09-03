// DYN-TOKEN — which token families each FILL surface can actually resolve.
//
// `listTokenCatalog()` serves one 157-token catalog to three pickers. The SOP
// authoring picker has narrowed it since E1.7b (`sopAuthoringTokens.ts` →
// `isResolvableToken`); the two MAPPING pickers never did, so they offered
// tokens no fill could resolve and the payer-PDF sample fill happily mocked a
// value for them. This module is the mapping side of the same idea.
//
// Family-based, like the authoring filter, so a new column widens a surface on
// its own. What a surface can reach is decided by which ROWS it holds, and
// that is a property of the family, never of the individual column.
//
// Measured and reasoned in `docs/ops/dyn-token-00-parity-spike.md`. Keep this
// module and that document in step.

/**
 * Families the REAL payer-PDF fill resolves.
 *
 * `buildProviderTokenValues` (`src/lib/pdfFill.ts`) passes exactly
 * `{ provider, group, facility }` — the entities the case page already holds,
 * deliberately, so the fill needs no extra fetch and PHI stays in the browser.
 *
 * This is NOT `ENTITY_TOKEN_FAMILIES`, which also lists `mso` because the SOP
 * resolver passes an MSO row. Reusing that constant here would claim a reach
 * the PDF path does not have.
 */
export const PDF_FILL_FAMILIES: readonly string[] = ["provider", "group", "facility"];

/**
 * Families the web profile resolves — the six source rows
 * `getProviderProfile` picks, plus `user.*` appended by the route.
 *
 * The org-contact families (`billingContact.*` and friends) also resolve
 * there, but are deliberately absent: `get_sop_field_tokens()` never emits
 * them, so no picker offers them and nothing can be mapped to them.
 */
export const WEB_FILL_FAMILIES: readonly string[] = [
  "provider",
  "group",
  "facility",
  "license",
  "assignment",
  "groupInsurance",
  "user",
];

/**
 * Families no fill resolves, on either surface.
 *
 * `payers` / `contracts` / `msos` are case-scoped: the web profile route has
 * no case in hand and returns null with a named reason, and the PDF path never
 * loads them at all. Offering them in a mapping picker can only ever produce a
 * field that stays blank.
 *
 * PM decision 2026-09-03: WITHDRAW rather than mark. Zero `portal_field_maps`
 * rows referenced these families in any status when the decision was taken, so
 * nothing was orphaned.
 *
 * NOTE the asymmetry with SOP authoring, which legitimately admits `mso.*`:
 * `buildSopTokenMap` does pass an MSO row. That is why this filter belongs to
 * the mapping surfaces and must never be pushed down into
 * `listTokenCatalog()`, whose third consumer would silently lose tokens.
 */
export const UNFILLABLE_FAMILIES: readonly string[] = ["payer", "contract", "mso"];

function familyOf(token: string): string {
  return token.split(".")[0] ?? "";
}

/** Can the real payer-PDF fill put a value in this field? */
export function isPdfFillableToken(token: string): boolean {
  return PDF_FILL_FAMILIES.includes(familyOf(token));
}

/** Can the web portal fill put a value in this field? */
export function isWebFillableToken(token: string): boolean {
  return WEB_FILL_FAMILIES.includes(familyOf(token));
}

/** True when NO fill surface can ever resolve this token. The mapping pickers
 * withdraw these; everything else stays offered, including tokens only one
 * surface reaches — narrowing per-surface is a separate, later decision. */
export function isUnfillableToken(token: string): boolean {
  return UNFILLABLE_FAMILIES.includes(familyOf(token));
}

/**
 * The catalog slice a MAPPING picker may offer — web or payer PDF.
 *
 * Deliberately only drops the never-fillable families. A token one surface
 * reaches and the other does not (`license.*`, `user.*`) is still offered on
 * both: whether to narrow or merely mark those is DYN-TOKEN-02, and hiding
 * them here would quietly remove working web mappings.
 */
export function filterMappingTokens<T extends { token: string }>(catalog: readonly T[]): T[] {
  return catalog.filter((entry) => !isUnfillableToken(entry.token));
}

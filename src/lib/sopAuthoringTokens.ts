// E1.7b TE-7 — the SOP authoring picker's token filter. get_sop_field_tokens()
// advertises the full 130+ token catalog; the client resolver
// (src/lib/sopResolver.ts) can substitute only the families whose row it holds
// at case creation, and a dataFields entry it cannot substitute is silently
// filtered at resolution. The template wizard therefore advertises only
// resolver-resolvable tokens. The full catalog stays available to its other
// consumers (mapping review, the extension's server-side profile resolution) —
// this filter is authoring-only.
//
// The filter is now family-based (see isResolvableToken), so a column added to
// providers/provider_groups/facilities/msos widens the picker on its own. What
// remains hand-listed is the one exclusion below, which is a policy choice
// rather than a resolution limit.
import { isEmailValuedToken, isResolvableToken } from "@/lib/sopResolver";

/** Resolvable, but deliberately NOT authorable in a SOP.
 *
 * `provider.ssnLast4` resolves (the column is ordinary, E4.4 vault rules bind
 * the full SSN only) and the extension's quick cards offer it, because a payer
 * form asks for it at fill time. Computed payer-form name/address aliases are
 * also fill-time only: the SOP resolver does not build these values. A SOP body
 * is different: resolution BAKES values into tasks.sop_content and drafted
 * email bodies, so only tokens actually supported there are authorable. */
export const AUTHORING_EXCLUDED_TOKENS: readonly string[] = [
  "provider.ssnLast4",
  "provider.fullName",
  "provider.fullNameWithCredentials",
  "provider.lastFirst",
  "facility.streetAddress",
  "facility.fullAddress",
];

export function filterAuthoringTokens<T extends { token: string }>(catalog: T[]): T[] {
  const excluded = new Set(AUTHORING_EXCLUDED_TOKENS);
  return catalog.filter((entry) => isResolvableToken(entry.token) && !excluded.has(entry.token));
}

/** The catalog slice a draft-email To/Cc row may address: the email columns of
 * the entities in hand (provider.email, group.credentialingEmail, …). */
export function filterEmailRecipientTokens<T extends { token: string }>(catalog: T[]): T[] {
  return catalog.filter((entry) => isEmailValuedToken(entry.token));
}

/** A recipient typed as `{{group.credentialingEmail}}` into the literal-address
 * box is a TOKEN recipient the author spelled by hand. Returning the token lets
 * the editor retag the row instead of failing address validation on it. */
export function emailTokenFromLiteral(raw: string): string | null {
  const match = /^\s*{{\s*([a-zA-Z0-9_.]+)\s*}}\s*$/.exec(raw);
  const token = match?.[1];
  return token && isEmailValuedToken(token) ? token : null;
}

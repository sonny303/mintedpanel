// E1.7b TE-7 — the SOP authoring picker's token filter. get_sop_field_tokens()
// advertises the full 132-token catalog, but the client resolver
// (src/lib/sopResolver.ts) substitutes only its own closed map; a dataFields
// entry whose token is not in that map is silently filtered at resolution.
// The template wizard therefore advertises only resolver-resolvable tokens.
// The full catalog stays available to its other consumers (mapping review,
// the extension's server-side profile resolution) — this filter is
// authoring-only.
import { resolvableTokenKeys } from "@/lib/sopResolver";

export function filterAuthoringTokens<T extends { token: string }>(catalog: T[]): T[] {
  const resolvable = new Set(resolvableTokenKeys());
  return catalog.filter((entry) => resolvable.has(entry.token));
}

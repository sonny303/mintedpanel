// Canonical token form for the extension fill engine: BARE "family.field"
// (e.g. "provider.firstName") — exactly what get_sop_field_tokens() emits.
//
// Humans seed portal_field_maps.token by pasting from SOP templates, where
// tokens are written braced ("{{provider.firstName}}"), so the DB holds both
// forms. The SERVER owns normalization, at the API read boundary: every /api
// response that carries a token key (profile tokens via providerProfile.ts +
// userTokens.ts, field-map rows via portalFieldMaps.ts) emits the bare form,
// so the extension's field-map → profile-token join is a plain string match.
// The extension must never need to strip braces itself.
//
// SOP template TEXT interpolation is a different concern — templates embed
// {{tokens}} inside prose and go through sopResolver's TOKEN_PATTERN, not
// through this helper.
export function normalizeTokenKey(raw: string): string;
export function normalizeTokenKey(raw: string | null | undefined): string | null;
export function normalizeTokenKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  const braced = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(trimmed);
  return braced ? braced[1] : trimmed;
}

// E0.10 F0.10.5 (TE-5). The DB now enforces ^[A-Z]{2}$ on the jurisdiction /
// state columns (migration 20260710160000), so services normalize valid user
// input at the write boundary — ` tx ` becomes `TX` instead of being rejected
// on casing/whitespace alone. Presence stays a separate concern (the F0.10.1
// NOT-NULL keys); these helpers never invent a value.

/** Trim + uppercase a required state code. `""` stays `""` (the DB check
 *  rejects it — presence validation belongs upstream). */
export function normalizeStateCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Trim + uppercase an optional state code; blank/null/undefined fold to null
 *  so a nullable column stores NULL instead of a check-violating "". */
export function normalizeOptionalStateCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.toUpperCase() : null;
}

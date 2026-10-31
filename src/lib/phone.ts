// US phone rule (MINT-91): the ONE entry-time check behind every phone input
// and the import create paths. Pure and I/O-free. Blank-value policy stays with
// each caller — most phone fields are optional; the contact forms require one.
// Roster export keeps its own digit-count check: it runs over stored rows,
// which this rule never re-validates.

// An optional trailing extension: x123, ext 123, ext. 123, #123. No leading
// \s*: the space before it is a separator, and a leading \s* goes quadratic
// on a long run of spaces.
const EXTENSION_RE = /(?:x|ext\.?|#)\s*\d+$/i;
// The separators a typed number may carry; anything else left over fails.
const SEPARATORS_RE = /[\s().-]/g;

export const US_PHONE_MESSAGE = "Enter a 10-digit US phone number";

/** 10 digits, or 11 starting with 1, once spaces and `( ) - .` are removed,
 * with an optional trailing extension. A leading `+` is a country code, so it
 * must be +1 then 10 digits. Any other letter fails. */
export function isValidUsPhone(value: string): boolean {
  const number = value.trim().replace(EXTENSION_RE, "");
  const digits = number.replace(/^\+/, "").replace(SEPARATORS_RE, "");
  return (number.startsWith("+") ? /^1\d{10}$/ : /^1?\d{10}$/).test(digits);
}

/** Existing-data rule (the MINT-7 NPI rule): blank passes, and on an edit a
 * value equal to the stored one is not re-checked, so a legacy phone never
 * blocks an unrelated save. Create flows omit `stored`. Returns the error copy
 * or null. */
export function usPhoneError(value: string, stored?: string | null): string | null {
  const next = value.trim();
  if (!next) return null;
  if (stored !== undefined && next === (stored ?? "").trim()) return null;
  return isValidUsPhone(next) ? null : US_PHONE_MESSAGE;
}

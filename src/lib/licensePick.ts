// Which state license the `license.*` tokens resolve from — ONE definition,
// shared by the web fill (`services/providerProfile.ts`, server-side) and the
// payer-PDF fill (`lib/pdfFill.ts`, browser-side).
//
// It lives here because the two surfaces must never disagree about which
// license a token means. A provider commonly holds several (a PT licensed in
// KS and MO), and "the license number" is not a question with one answer until
// a state is named.
//
// The rule NEVER GUESSES. It will not fall back to the newest license, the
// first alphabetically, or the only "active" one — the same posture
// `selectFacility` takes next door, and for the same reason: a plausible wrong
// license number on a payer application is worse than a visible blank. A
// caller with no state and several licenses gets null plus a reason saying so.

/** The shape the rule reads. Deliberately minimal: `state` is spelled the same
 * in the server's snake_case rows and the browser's camelCase `StateLicense`,
 * so one generic serves both without a conversion at the boundary. */
export interface LicenseLike {
  state?: unknown;
}

export interface LicensePickResult<T> {
  /** The chosen license, or null when the rule declines to choose. */
  row: T | null;
  /** Why nothing was chosen. Absent on a successful pick. */
  reason?: string;
}

/**
 * Pick the license for `state`.
 *
 * - no licenses → null, "provider has no state licenses"
 * - a state, and it matches → that license
 * - a state, no match → null, "provider has no XX license"
 * - no state, exactly one license → that one (there is nothing to disambiguate)
 * - no state, several → null, and the reason says to name a state
 *
 * `state` is compared case-insensitively; every state the panel stores is
 * already a two-letter code.
 */
export function pickLicenseForState<T extends LicenseLike>(
  licenses: readonly T[],
  state: string | null | undefined,
): LicensePickResult<T> {
  if (licenses.length === 0) return { row: null, reason: "provider has no state licenses" };

  const wanted = (state ?? "").trim().toUpperCase();
  if (wanted) {
    const match = licenses.find((l) => String(l.state ?? "").toUpperCase() === wanted);
    if (!match) return { row: null, reason: `provider has no ${wanted} license` };
    return { row: match };
  }

  if (licenses.length === 1) return { row: licenses[0] as T };
  return {
    row: null,
    reason: `provider has ${licenses.length} state licenses; pass ?state=XX to select one`,
  };
}

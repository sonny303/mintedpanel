// E4.4 F4.4.1 — universal SSN masking. Every application surface (provider
// profile, lists, exports, API payloads, extension detail views) renders at
// most the mask `***--1234`, sourced from providers.ssn_last4 — never the full
// value, which lives only in the server-only vault. This is the single place
// the mask string is shaped, so the format stays uniform everywhere.

const EM_DASH = "—";

/**
 * Mask a provider's SSN for display from its last four digits.
 * `1234` -> `***--1234`; absent/blank -> em-dash. Anything longer than four
 * digits is defensively truncated to the last four so a mistakenly-full value
 * can never render in full.
 */
export function maskSsn(ssnLast4: string | null | undefined): string {
  const digits = (ssnLast4 ?? "").replace(/\D/g, "");
  if (digits.length === 0) return EM_DASH;
  return `***--${digits.slice(-4)}`;
}

/**
 * Format a full 9-digit SSN as `NNN-NN-NNNN` for the admin reveal window ONLY.
 * Never used for storage or logging; the returned string is displayed briefly
 * and then discarded (auto-rehide). Non-digits are stripped; a value that is
 * not exactly nine digits is returned digits-only rather than mis-grouped.
 */
export function formatFullSsn(ssn: string | null | undefined): string {
  const digits = (ssn ?? "").replace(/\D/g, "");
  if (digits.length !== 9) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

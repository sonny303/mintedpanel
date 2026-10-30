// Provider identity rules (MINT-7 / audit CRUD-01): the ONE implementation of
// the NPI check digit, the DEA checksum, and the strict ISO calendar-date
// check. Pure and I/O-free; the Add Provider form, the roster form, the CSV
// import scans, and roster export all call these instead of re-declaring
// regexes. Blank-value policy stays with each caller (NPI is optional on Add
// Provider, required on the roster form and the provider import).

const NPI_DIGITS_RE = /^\d{10}$/;
const DEA_RE = /^[A-Z]{2}\d{7}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const NPI_CHECK_DIGIT_MESSAGE = "NPI check digit is invalid — re-check the number";
export const DEA_FORMAT_MESSAGE = "DEA must be 2 letters followed by 7 digits";
export const DEA_CHECK_DIGIT_MESSAGE = "DEA check digit is invalid — re-check the number";

/** The NPI check digit for its first nine digits: Luhn over the CMS `80840`
 * card-issuer prefix. Null when `first9` is not exactly nine digits. */
export function npiCheckDigit(first9: string): number | null {
  if (!/^\d{9}$/.test(first9)) return null;
  const prefixed = `80840${first9}`;
  let sum = 0;
  // The check digit sits to the right, so the rightmost payload digit doubles.
  let double = true;
  for (let index = prefixed.length - 1; index >= 0; index -= 1) {
    let digit = Number(prefixed[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** Exactly 10 digits (surrounding whitespace ignored) whose last digit is the
 * CMS check digit. Dashes or spaces inside the number fail; strip them first. */
export function isValidNpi(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const digits = String(value).trim();
  if (!NPI_DIGITS_RE.test(digits)) return false;
  return npiCheckDigit(digits.slice(0, 9)) === Number(digits[9]);
}

export type DeaProblem = "format" | "check_digit";

/** Why a DEA number fails, or null when it passes: 2 letters + 7 digits, and
 * the 7th digit equals the last digit of (d1 + d3 + d5) + 2 × (d2 + d4 + d6).
 * The second letter is NOT matched to the registrant's last name (open PM
 * question), so any two letters pass the format. */
export function deaProblem(value: unknown): DeaProblem | null {
  if (typeof value !== "string") return "format";
  const dea = value.trim();
  if (!DEA_RE.test(dea)) return "format";
  const d = dea.slice(2).split("").map(Number);
  const sum = d[0] + d[2] + d[4] + 2 * (d[1] + d[3] + d[5]);
  return sum % 10 === d[6] ? null : "check_digit";
}

export function isValidDea(value: unknown): boolean {
  return deaProblem(value) === null;
}

/** Strict `YYYY-MM-DD` that names a real calendar date (no Feb 30, no month 13). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Existing-data rule: an identity field is validated only when it is entered
 * or changed. On an edit, a value equal to the stored one (after `normalize`)
 * is left alone, so a stored NPI or DEA that predates these checks never blocks
 * an unrelated save. Create flows pass `stored` as undefined. */
export function identityFieldChanged(
  next: string,
  stored: string | null | undefined,
  normalize: (value: string) => string = (value) => value.trim(),
): boolean {
  if (stored === undefined) return true;
  return normalize(next) !== normalize(stored ?? "");
}

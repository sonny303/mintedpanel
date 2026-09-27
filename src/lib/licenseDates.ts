export const LICENSE_DATE_ORDER_ERROR = "Expiration date must be on or after issue date.";

// Date inputs and state_licenses dates use YYYY-MM-DD, so lexical order is chronological.
export function hasValidLicenseDateOrder(
  issueDate: string | null | undefined,
  expirationDate: string | null | undefined,
): boolean {
  return !issueDate || !expirationDate || expirationDate >= issueDate;
}

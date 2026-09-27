export const POLICY_DATE_ORDER_ERROR = "End date must be on or after start date";

// Date inputs and policy date columns both use YYYY-MM-DD, so lexical order is chronological.
export function hasValidPolicyDateOrder(startDate: string, endDate: string): boolean {
  return !startDate || !endDate || startDate <= endDate;
}

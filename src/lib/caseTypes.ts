/** Closed business-purpose set for case and portal routing. */
export const CASE_TYPES = ["contract", "enrollment", "recredentialing"] as const;

export type CaseType = (typeof CASE_TYPES)[number];

const CASE_TYPE_SET: ReadonlySet<string> = new Set(CASE_TYPES);

export function isCaseType(value: unknown): value is CaseType {
  return typeof value === "string" && CASE_TYPE_SET.has(value);
}

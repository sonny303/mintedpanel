// MINT-93 — the manual case modal's four required key fields. One predicate
// feeds both the modal's selection (Create case stays disabled until it is
// empty) and the footer hint that names what is still missing, so the hint
// can never disagree with the button.
const MANUAL_CASE_KEY_FIELDS = ["provider", "group", "payer", "state"] as const;

export type ManualCaseKeyField = (typeof MANUAL_CASE_KEY_FIELDS)[number];

/** The key fields still at the select's empty sentinel, in form order. */
export function missingManualCaseFields(
  values: Record<ManualCaseKeyField, string>,
  unset: string,
): ManualCaseKeyField[] {
  return MANUAL_CASE_KEY_FIELDS.filter((field) => values[field] === unset);
}

/** "Choose a payer and state to create the case." — null once nothing is missing. */
export function missingManualCaseFieldsHint(missing: readonly ManualCaseKeyField[]): string | null {
  if (missing.length === 0) return null;
  const last = missing[missing.length - 1];
  const list =
    missing.length === 1
      ? last
      : missing.length === 2
        ? `${missing[0]} and ${last}`
        : `${missing.slice(0, -1).join(", ")}, and ${last}`;
  return `Choose a ${list} to create the case.`;
}

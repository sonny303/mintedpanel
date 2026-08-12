// E4.2 SOP resolution hardening — the org-authored SOP match-key contract, pure
// so the authoring surface and its tests share ONE rule. The supported runtime
// match grain is payer + state + group: an organization-authored SOP MUST target
// a payer AND a state ("Any payer" / null "Any state" are not valid), while the
// group stays optional ("Any group"). Specialty is preserved as legacy metadata
// but is never a runtime match key. The platform-managed global generic fallback
// remains the ONLY payerless fallback.
//
// 3M Slice 3 / D3.1 A: the literal sentinel `All` is a valid complete state
// (wildcard for every two-letter case state). It is NOT null / "Any state".

/** Stored `sop_templates.state` value for an All-states template (D3.2). */
export const ALL_STATES_SENTINEL = "All" as const;

export interface OrgSopMatchKey {
  /** null = "Any payer" (unsupported for an org SOP). */
  payerId: string | null;
  /** The template's state SET. Empty/null = "Any state" (unsupported). A lone
   * {@link ALL_STATES_SENTINEL} is the All-states wildcard. */
  states: readonly string[] | null;
}

/** Returns a blocking error message when an organization SOP's match key is an
 * unsupported wildcard combination, or null when it is valid. Group is optional
 * and never validated here. A lone `'All'` is a valid complete state set. */
export function orgSopMatchKeyError(key: OrgSopMatchKey): string | null {
  if (!key.payerId) {
    return "Select a payer — a template must target a specific payer.";
  }
  if (!key.states || key.states.length === 0) {
    return "Select at least one state — a template must target the states it applies to.";
  }
  if (key.states.length > 1 && key.states.includes(ALL_STATES_SENTINEL)) {
    // 'All' already covers every state; mixing is contradictory, and storing it
    // would break the specificity ranking (see pickTemplate).
    return "“All states” already covers every state — remove it or clear the individual states.";
  }
  return null;
}

/** Convenience predicate: is this a supported org match key? */
export function isSupportedOrgSopMatchKey(key: OrgSopMatchKey): boolean {
  return orgSopMatchKeyError(key) === null;
}

/** Is this state set the All-states wildcard? */
export function isAllStates(states: readonly string[] | null | undefined): boolean {
  return Array.isArray(states) && states.length === 1 && states[0] === ALL_STATES_SENTINEL;
}

/** The stored state set for a template, tolerating the pre-multi-state scalar.
 * `states` is authoritative; the frozen `state` mirror is the fallback so a row
 * written before the multi-state migration still resolves. */
export function templateStates(
  template: { states?: readonly string[] | null; state?: string | null } | null | undefined,
): string[] {
  if (!template) return [];
  if (Array.isArray(template.states) && template.states.length > 0) {
    return [...template.states];
  }
  return template.state ? [template.state] : [];
}

/** Display label for a stored SOP state set — "All states", a single code, or
 * a comma-joined list. Codes sort so the label is stable regardless of the
 * order the author picked them in. */
export function formatSopStateLabel(states: string | readonly string[] | null | undefined): string {
  const list = typeof states === "string" ? [states] : Array.isArray(states) ? [...states] : [];
  if (list.length === 0) return "—";
  if (isAllStates(list)) return "All states";
  return list.sort((a, b) => a.localeCompare(b)).join(", ");
}

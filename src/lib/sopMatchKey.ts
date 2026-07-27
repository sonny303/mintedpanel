// E4.2 SOP resolution hardening — the org-authored SOP match-key contract, pure
// so the authoring surface and its tests share ONE rule. The supported runtime
// match grain is payer + state + group: an organization-authored SOP MUST target
// a payer AND a state ("Any payer" / "Any state" are not valid), while the group
// stays optional ("Any group"). Specialty is preserved as legacy metadata but is
// never a runtime match key. The platform-managed global generic fallback remains
// the ONLY payerless fallback.

export interface OrgSopMatchKey {
  /** null = "Any payer" (unsupported for an org SOP). */
  payerId: string | null;
  /** null = "Any state" (unsupported for an org SOP). */
  state: string | null;
}

/** Returns a blocking error message when an organization SOP's match key is an
 * unsupported wildcard combination, or null when it is valid. Group is optional
 * and never validated here. */
export function orgSopMatchKeyError(key: OrgSopMatchKey): string | null {
  if (!key.payerId) {
    return "Select a payer — a template must target a specific payer.";
  }
  if (!key.state) {
    return "Select a state — a template must target a specific state.";
  }
  return null;
}

/** Convenience predicate: is this a supported org match key? */
export function isSupportedOrgSopMatchKey(key: OrgSopMatchKey): boolean {
  return orgSopMatchKeyError(key) === null;
}

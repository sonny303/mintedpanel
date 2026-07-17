// E4.3 TE-16 — the CLOSED, server-owned catalog of fields a user may put on an
// extension quick card, and the validator the PUT /api/me/view-prefs route
// enforces. This is a curated allowlist DERIVED from the fields the provider
// profile endpoint already exposes (the non-case-scoped tables it resolves) —
// it is NOT the raw get_sop_field_tokens() catalog and NOT client-defined.
//
// Structural exclusions (TE-16): `provider.ssnLast4` and the entire E4.4
// fill-only / vault token category are omitted from the list itself, so a
// hand-crafted PUT naming an excluded key can never validate — the exclusion
// is enforced at the catalog, not merely hidden in a picker. Case-scoped
// tokens (payer.* / mso.* / contract.*) are excluded too: they never resolve
// on a provider profile. Internal/audit columns
// (launchId, terminatedDate, verificationState, isTestProvider, referenceOnly,
// statusId, license.verifiedBy/verifiedAt/verificationSourceUrl) are omitted
// as non-card data.
//
// Keys are BARE catalog token keys in the camelCase `family.field` form the
// profile endpoint emits (e.g. `license.licenseNumber`) — the extension's
// field-key → profile-token join is a literal string match. Add a field by
// adding its key here (and only here); nothing else makes a field selectable.

/** The user_table_prefs page_key the extension quick-card layout is stored
 * under. Stable across machines/browsers (server-side, user-scoped). */
export const EXTENSION_QUICK_CARDS_PAGE_KEY = "extension.quickCards";

/** TE-15 upper bound on a saved layout (default layout is ~9 fields + up to a
 * few custom; 32 is a generous, safe ceiling). */
export const MAX_QUICK_CARD_FIELDS = 32;

// The closed catalog, grouped by source for review. Order here is only the
// catalog listing order; a saved layout carries its OWN order.
export const QUICK_CARD_FIELD_CATALOG: readonly string[] = [
  // provider (Type 1 identity, credentials, demographics) — ssnLast4 excluded
  "provider.firstName",
  "provider.lastName",
  "provider.middleInitial",
  "provider.suffix",
  "provider.credentials",
  "provider.npi",
  "provider.caqhId",
  "provider.caqhLastAttestedDate",
  "provider.taxonomyCode",
  "provider.specialty",
  "provider.subSpecialty",
  "provider.deaNumber",
  "provider.deaExpirationDate",
  "provider.dateOfBirth",
  "provider.email",
  "provider.phone",
  "provider.gender",
  "provider.ethnicity",
  "provider.startDate",
  "provider.homeState",
  "provider.boardCertified",
  "provider.medicaidAttested",
  "provider.languages",
  "provider.degree",
  "provider.schoolName",
  "provider.graduationDate",
  "provider.malpracticeCarrier",
  "provider.malpracticePolicyNumber",
  "provider.malpracticeCoverageStart",
  "provider.malpracticeCoverageEnd",
  "provider.licenseNumber",
  "provider.licenseState",
  "provider.licenseIssueDate",
  "provider.licenseExpirationDate",
  // state_licenses (the ?state-selected primary license)
  "license.licenseNumber",
  "license.state",
  "license.licenseType",
  "license.issueDate",
  "license.expirationDate",
  "license.verifiedStatus",
  // provider_groups (Type 2)
  "group.name",
  "group.tin",
  "group.npiType2",
  "group.taxIdType",
  "group.websiteUrl",
  "group.billingContactName",
  "group.billingPhone",
  "group.billingEmail",
  "group.billingState",
  "group.contractingContactName",
  "group.contractingContactEmail",
  "group.credentialingContactName",
  "group.credentialingPhone",
  "group.credentialingEmail",
  "group.contractSignerName",
  "group.contractSignerEmail",
  // group_insurance_policies (malpractice)
  "groupInsurance.insurerName",
  "groupInsurance.policyNumber",
  "groupInsurance.policyStartDate",
  "groupInsurance.policyEndDate",
  "groupInsurance.insuranceType",
  // facilities (the selected practice location)
  "facility.name",
  "facility.street",
  "facility.suite",
  "facility.city",
  "facility.state",
  "facility.zip",
  "facility.phone",
  "facility.fax",
  "facility.county",
  "facility.contactName",
  "facility.appointmentPhone",
  // provider_facility_assignments (the link row of the selected facility)
  "assignment.startDate",
  "assignment.isPrimary",
  "assignment.practiceFrequency",
];

const CATALOG_SET: ReadonlySet<string> = new Set(QUICK_CARD_FIELD_CATALOG);

/** Is `key` a selectable quick-card field? False for any excluded/sensitive
 * key (they are simply absent from the catalog). */
export function isQuickCardField(key: string): boolean {
  return CATALOG_SET.has(key);
}

export type QuickCardFieldsValidation =
  { ok: true; fields: string[] } | { ok: false; message: string };

/** Validate a PUT body's `fields` into a bounded, deduplicated, ORDERED array
 * of closed-catalog keys (TE-15/TE-16). The order is preserved as given (the
 * user's layout order); a duplicate, an unknown/excluded key, a non-string
 * element, or more than MAX_QUICK_CARD_FIELDS is a hard reject — anything
 * that isn't a clean layout is a 422 at the route. */
export function validateQuickCardFields(raw: unknown): QuickCardFieldsValidation {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "fields must be an array of catalog field keys" };
  }
  if (raw.length > MAX_QUICK_CARD_FIELDS) {
    return { ok: false, message: `fields may not exceed ${MAX_QUICK_CARD_FIELDS} entries` };
  }
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { ok: false, message: "every field must be a string catalog key" };
    }
    if (!CATALOG_SET.has(item)) {
      return { ok: false, message: `unknown or excluded field key: ${item}` };
    }
    if (seen.has(item)) {
      return { ok: false, message: `duplicate field key: ${item}` };
    }
    seen.add(item);
    fields.push(item);
  }
  return { ok: true, fields };
}

// Pure assembly for the cross-org provider dossier (spike).
//
// The Type-1 NPI is the identity anchor. A person can have one providers row
// per org they work in; this module turns those rows, plus the licenses,
// group assignments, and facility assignments nested under them, into one
// footprint. It does not fetch. The service owns the single read.
//
// Dedup rules, decided here so they can be tested without a database:
//
// - Affiliations are never merged. "Which org" is part of the answer.
// - A license with a number collapses across orgs on
//   (state, license number, license type). A row with no number stays alone —
//   two blank numbers in the same state are not evidence of one license.
// - When collapsed copies disagree on expiration, status, or verified status,
//   the row is a conflict. The grid shows the latest expiration and names
//   every org's value. Nothing is silently discarded.
// - Groups and facilities stay one row per assignment. A TIN that appears on
//   more than one group is flagged, not merged: the same billing entity in
//   two orgs is still two places to manage.
// - A row whose org is outside the caller's membership map is dropped, and so
//   are its children. That narrowing is defense in depth. RLS is the wall.

import { fmtDate } from "@/lib/format";

/** Columns the dossier read is allowed to select. One providers read, children
 *  embedded. No PHI, no DEA, no contact channels. */
export const PROVIDER_DOSSIER_COLUMNS = [
  "id",
  "org_id",
  "first_name",
  "last_name",
  "credentials",
  "npi",
  "status",
  "organizations(name)",
  "state_licenses(id,org_id,state,license_number,license_type,expiration_date,status,verified_status)",
  "provider_group_assignments(id,org_id,is_primary,provider_groups(id,name,npi_type2,tin))",
  "provider_facility_assignments(id,org_id,is_primary,facilities(id,name,city,state))",
].join(",");

/** Tokens that must never appear in PROVIDER_DOSSIER_COLUMNS. */
export const FORBIDDEN_DOSSIER_COLUMNS = [
  "date_of_birth",
  "ssn_last4",
  "dea_number",
  "dea_expiration_date",
  "home_street",
  "home_city",
  "home_state",
  "home_zip",
  "phone",
  "email",
  "fax",
  "street",
  "billing_email",
  "billing_phone",
] as const;

const TYPE1_NPI = /^\d{10}$/;

export function isType1Npi(value: string | null | undefined): value is string {
  return typeof value === "string" && TYPE1_NPI.test(value);
}

export interface DossierAffiliation {
  providerId: string;
  orgId: string;
  orgName: string;
  name: string;
  firstName: string;
  lastName: string;
  credentials: string | null;
  status: string;
}

export interface DossierLicenseSource {
  licenseId: string;
  orgId: string;
  orgName: string;
  providerId: string;
  expirationDate: string | null;
  status: string | null;
  verifiedStatus: string | null;
}

export type DossierConflictField = "expiration" | "status" | "verified";

export interface DossierLicense {
  state: string;
  licenseNumber: string | null;
  licenseType: string | null;
  /** Latest expiration across copies, as YYYY-MM-DD, when any copy has one. */
  expirationDate: string | null;
  /** Shared status when every copy agrees. Null when they do not. */
  status: string | null;
  verifiedStatus: string | null;
  conflictFields: DossierConflictField[];
  sources: DossierLicenseSource[];
}

export interface DossierGroup {
  assignmentId: string;
  groupId: string;
  orgId: string;
  orgName: string;
  providerId: string;
  name: string;
  npiType2: string | null;
  tin: string | null;
  isPrimary: boolean;
  /** True when another group in this dossier has the same TIN digits. */
  sharedTin: boolean;
}

export interface DossierFacility {
  assignmentId: string;
  facilityId: string;
  orgId: string;
  orgName: string;
  providerId: string;
  name: string;
  city: string | null;
  state: string | null;
  isPrimary: boolean;
}

export interface ProviderDossier {
  npi: string;
  affiliations: DossierAffiliation[];
  licenses: DossierLicense[];
  groups: DossierGroup[];
  facilities: DossierFacility[];
}

export interface DossierHeader {
  name: string;
  credentials: string | null;
  otherNames: string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  const s = text(value).trim();
  return s.length > 0 ? s : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function embeddedOne(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function dateKey(value: string | null): string {
  if (!value) return "";
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : value.trim();
}

function norm(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function tinDigits(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

interface LicenseDraft {
  state: string;
  licenseNumber: string | null;
  licenseType: string | null;
  sources: DossierLicenseSource[];
}

export function aggregateProviderDossier(
  rows: readonly unknown[],
  authorizedOrgNames: ReadonlyMap<string, string>,
  npi: string,
): ProviderDossier {
  const affiliations: DossierAffiliation[] = [];
  const licenseDrafts = new Map<string, LicenseDraft>();
  const groups: DossierGroup[] = [];
  const facilities: DossierFacility[] = [];

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const providerId = text(row.id);
    const orgId = text(row.org_id);
    const orgName = authorizedOrgNames.get(orgId);
    if (!providerId || !orgId || orgName === undefined) continue;
    if (text(row.npi).trim() !== npi) continue;

    const firstName = text(row.first_name).trim();
    const lastName = text(row.last_name).trim();
    const embeddedOrg = embeddedOne(row.organizations);
    affiliations.push({
      providerId,
      orgId,
      orgName: orgName || nullableText(embeddedOrg?.name) || "",
      name: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      credentials: nullableText(row.credentials),
      status: text(row.status) || "unknown",
    });

    for (const rawLicense of asArray(row.state_licenses)) {
      const license = asRecord(rawLicense);
      if (!license) continue;
      const licenseOrgId = text(license.org_id) || orgId;
      if (!authorizedOrgNames.has(licenseOrgId)) continue;
      const licenseId = text(license.id);
      const state = text(license.state).trim().toUpperCase();
      if (!licenseId || !state) continue;
      const licenseNumber = nullableText(license.license_number);
      const licenseType = nullableText(license.license_type);
      const source: DossierLicenseSource = {
        licenseId,
        orgId: licenseOrgId,
        orgName: authorizedOrgNames.get(licenseOrgId) || orgName,
        providerId,
        expirationDate: nullableText(license.expiration_date),
        status: nullableText(license.status),
        verifiedStatus: nullableText(license.verified_status),
      };
      // A missing number cannot prove two rows are the same license.
      const key = licenseNumber
        ? `${state}|${norm(licenseNumber)}|${norm(licenseType)}`
        : `id:${licenseId}`;
      const draft = licenseDrafts.get(key);
      if (draft) {
        draft.sources.push(source);
      } else {
        licenseDrafts.set(key, { state, licenseNumber, licenseType, sources: [source] });
      }
    }

    for (const rawAssignment of asArray(row.provider_group_assignments)) {
      const assignment = asRecord(rawAssignment);
      if (!assignment) continue;
      const assignmentOrgId = text(assignment.org_id) || orgId;
      if (!authorizedOrgNames.has(assignmentOrgId)) continue;
      const group = embeddedOne(assignment.provider_groups);
      const groupId = text(group?.id);
      const assignmentId = text(assignment.id);
      if (!group || !groupId || !assignmentId) continue;
      groups.push({
        assignmentId,
        groupId,
        orgId: assignmentOrgId,
        orgName: authorizedOrgNames.get(assignmentOrgId) || orgName,
        providerId,
        name: text(group.name).trim() || "Group",
        npiType2: nullableText(group.npi_type2),
        tin: nullableText(group.tin),
        isPrimary: assignment.is_primary === true,
        sharedTin: false,
      });
    }

    for (const rawAssignment of asArray(row.provider_facility_assignments)) {
      const assignment = asRecord(rawAssignment);
      if (!assignment) continue;
      const assignmentOrgId = text(assignment.org_id) || orgId;
      if (!authorizedOrgNames.has(assignmentOrgId)) continue;
      const facility = embeddedOne(assignment.facilities);
      const facilityId = text(facility?.id);
      const assignmentId = text(assignment.id);
      if (!facility || !facilityId || !assignmentId) continue;
      facilities.push({
        assignmentId,
        facilityId,
        orgId: assignmentOrgId,
        orgName: authorizedOrgNames.get(assignmentOrgId) || orgName,
        providerId,
        name: text(facility.name).trim() || "Facility",
        city: nullableText(facility.city),
        state: nullableText(facility.state),
        isPrimary: assignment.is_primary === true,
      });
    }
  }

  const tinGroups = new Map<string, Set<string>>();
  for (const group of groups) {
    const digits = tinDigits(group.tin);
    if (!digits) continue;
    let set = tinGroups.get(digits);
    if (!set) {
      set = new Set();
      tinGroups.set(digits, set);
    }
    set.add(group.groupId);
  }
  for (const group of groups) {
    const digits = tinDigits(group.tin);
    group.sharedTin = Boolean(digits) && (tinGroups.get(digits)?.size ?? 0) > 1;
  }

  const licenses = [...licenseDrafts.values()].map(finishLicense);

  affiliations.sort(
    (a, b) => a.orgName.localeCompare(b.orgName) || a.providerId.localeCompare(b.providerId),
  );
  licenses.sort(
    (a, b) =>
      a.state.localeCompare(b.state) ||
      (a.licenseNumber ?? "").localeCompare(b.licenseNumber ?? "") ||
      (a.licenseType ?? "").localeCompare(b.licenseType ?? ""),
  );
  groups.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.orgName.localeCompare(b.orgName) ||
      a.name.localeCompare(b.name) ||
      a.assignmentId.localeCompare(b.assignmentId),
  );
  facilities.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.orgName.localeCompare(b.orgName) ||
      a.name.localeCompare(b.name) ||
      a.assignmentId.localeCompare(b.assignmentId),
  );

  return { npi, affiliations, licenses, groups, facilities };
}

function finishLicense(draft: LicenseDraft): DossierLicense {
  const sources = [...draft.sources].sort(
    (a, b) => a.orgName.localeCompare(b.orgName) || a.licenseId.localeCompare(b.licenseId),
  );
  const expirations = new Set(sources.map((source) => dateKey(source.expirationDate)));
  const statuses = new Set(sources.map((source) => norm(source.status)));
  const verified = new Set(sources.map((source) => norm(source.verifiedStatus)));
  const conflictFields: DossierConflictField[] = [];
  if (expirations.size > 1) conflictFields.push("expiration");
  if (statuses.size > 1) conflictFields.push("status");
  if (verified.size > 1) conflictFields.push("verified");

  const latest = [...expirations].filter(Boolean).sort().at(-1) ?? null;
  const agreedStatus = statuses.size === 1 ? (sources[0].status ?? null) : null;
  const agreedVerified = verified.size === 1 ? (sources[0].verifiedStatus ?? null) : null;

  return {
    state: draft.state,
    licenseNumber: draft.licenseNumber,
    licenseType: draft.licenseType,
    expirationDate: latest,
    status: agreedStatus,
    verifiedStatus: agreedVerified,
    conflictFields,
    sources,
  };
}

/** Header follows the row the coordinator inspected. Other recorded names
 *  stay visible so a shared NPI that is actually two people is obvious. */
export function dossierHeader(
  dossier: ProviderDossier,
  anchorProviderId: string | null,
): DossierHeader {
  const anchor =
    dossier.affiliations.find((row) => row.providerId === anchorProviderId) ??
    dossier.affiliations[0];
  const name = anchor?.name || "Provider";
  const otherNames = [
    ...new Set(
      dossier.affiliations
        .map((row) => row.name)
        .filter((rowName) => rowName && rowName.toLowerCase() !== name.toLowerCase()),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return { name, credentials: anchor?.credentials ?? null, otherNames };
}

export function formatLicensesForCopy(licenses: readonly DossierLicense[]): string {
  return licenses
    .map((license) => {
      const parts = [
        license.state,
        license.licenseNumber ?? "no number",
        license.licenseType,
        license.expirationDate ? `expires ${fmtDate(license.expirationDate)}` : "no expiration",
      ].filter((part): part is string => Boolean(part));
      const line = parts.join(" · ");
      return license.conflictFields.length > 0 ? `${line} · differs across organizations` : line;
    })
    .join("\n");
}

export function formatGroupTinsForCopy(groups: readonly DossierGroup[]): string {
  return groups
    .filter((group) => group.tin)
    .map((group) => [group.name, group.tin, group.orgName].filter(Boolean).join(" · "))
    .join("\n");
}

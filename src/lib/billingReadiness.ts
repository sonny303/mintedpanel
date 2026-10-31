import { canonicalLabel } from "@/lib/canonicalStatuses";
import { isStatusHistorySeed } from "@/lib/caseStatus";
import { APPROVED_LABEL, IN_NETWORK_LABEL } from "@/lib/statusLabels";
import { taxonomyLabel } from "@/lib/providerTaxonomy";
import type { ProviderStatus } from "@/types";

export type BillingReadinessStatus = "ready" | "hold" | "stop";
export type BillingFeedKind = "approval" | "facility_added" | "termination" | "license_expiration";
export type BillingFeedRange = 7 | 30 | 90;

export interface BillingProvider {
  id: string;
  firstName: string;
  lastName: string;
  npi: string | null;
  taxonomyCode: string | null;
  status: ProviderStatus;
  verificationState: string | null;
  isTestProvider: boolean;
}

export interface BillingGroup {
  id: string;
  name: string;
  tin: string | null;
  npiType2: string | null;
  isActive: boolean;
}

export interface BillingFacility {
  id: string;
  name: string;
  groupId: string | null;
  state: string | null;
  isActive: boolean;
}

export interface BillingPayer {
  id: string;
  name: string;
  status: string;
  isActive: boolean | null;
  avgDecisionDays: number | null;
}

export interface BillingGroupMembership {
  providerId: string;
  groupId: string;
  startDate: string | null;
  endDate: string | null;
}

export interface BillingFacilityAssignment {
  providerId: string | null;
  facilityId: string | null;
  startDate: string | null;
}

export interface BillingLicense {
  providerId: string | null;
  state: string;
  licenseNumber: string | null;
  licenseType: string | null;
  status: string | null;
  verifiedStatus: string;
  issueDate: string | null;
  expirationDate: string | null;
}

export interface BillingCase {
  id: string;
  providerId: string;
  groupId: string | null;
  payerId: string;
  state: string;
  caseStatus: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  confirmedEffectiveDate: string | null;
  expectedEffectiveDate: string | null;
  terminationDate: string | null;
  createdAt: string | null;
}

export interface BillingCaseFacility {
  caseId: string;
  facilityId: string;
  createdAt: string;
  createdBy: string | null;
}

export interface BillingStatusTransition {
  id: string;
  caseId: string;
  fromStatus: string | null;
  toStatus: string;
  actorKind: string | null;
  changedAt: string;
}

export interface BillingLegacyStatusTransition {
  id: string;
  caseId: string | null;
  track: string;
  toStatusLabel: string | null;
  changedAt: string | null;
}

export interface BillingReadinessSnapshot {
  providers: BillingProvider[];
  groups: BillingGroup[];
  facilities: BillingFacility[];
  payers: BillingPayer[];
  groupMemberships: BillingGroupMembership[];
  facilityAssignments: BillingFacilityAssignment[];
  licenses: BillingLicense[];
  cases: BillingCase[];
  caseFacilities: BillingCaseFacility[];
  statusTransitions: BillingStatusTransition[];
  legacyStatusTransitions: BillingLegacyStatusTransition[];
}

export interface BillingSelection {
  providerId: string;
  facilityId: string;
  payerId: string;
}

export interface BillingReason {
  severity: Exclude<BillingReadinessStatus, "ready">;
  label: string;
}

export interface BillingSupervisorCandidate {
  providerId: string;
  name: string;
  npi: string | null;
  taxonomyCode: string;
}

export interface BillingAssessment {
  status: BillingReadinessStatus;
  label: "Billable Ready" | "Hold" | "Do Not Bill";
  provider: BillingProvider;
  group: BillingGroup | null;
  facility: BillingFacility;
  payer: BillingPayer;
  state: string | null;
  case: BillingCase | null;
  confirmedEffectiveDate: string | null;
  expectedEffectiveDate: string | null;
  estimatedDecisionDate: string | null;
  retroEligibility: "Not recorded";
  isPta: boolean;
  isOta: boolean;
  supervisorCandidates: BillingSupervisorCandidate[];
  reasons: BillingReason[];
}

export interface BillingFeedEvent {
  id: string;
  kind: BillingFeedKind;
  title: string;
  eventDate: string;
  recorded: boolean;
  providerId: string;
  providerName: string;
  npi: string | null;
  facilityId: string | null;
  facilityName: string | null;
  payerId: string | null;
  payerName: string | null;
  groupId: string | null;
  state: string | null;
  caseId: string | null;
}

export interface BillingFeedFilters {
  range: BillingFeedRange;
  facilityId?: string;
  payerId?: string;
  kind?: BillingFeedKind;
}

/** Change-type filter options, in display order. */
export const BILLING_FEED_KIND_LABELS: Record<BillingFeedKind, string> = {
  approval: "Enrollment approved",
  facility_added: "Facility linked",
  termination: "Termination effective",
  license_expiration: "License expired",
};

const PTA_TAXONOMY = "225200000X";
const OTA_TAXONOMY_PREFIX = "224Z";
const FEED_WINDOW_DAYS = 90;
const KNOWN_CASE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "in_review",
  "action_required",
  "approved",
  "denied",
  "not_pursuing",
] as const;

function validIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function validDateTime(value: string | null | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

function stateCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function isDateReached(date: string, today: string): boolean {
  return date <= today;
}

function shiftDays(date: string, days: number): string | null {
  if (!validIsoDate(date) || !Number.isFinite(days)) return null;
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + Math.ceil(days));
  return value.toISOString().slice(0, 10);
}

// A membership with no start date counts as started (PM decision 2026-10-20),
// as in the enrollment readiness matrix (`evaluateEnrollmentReadiness`), which
// drops a membership only once its end date has passed. Here a recorded future
// start still holds, and a passed end date takes the clinician off the group.
function isCurrentMembership(
  row: BillingGroupMembership,
  today: string,
): { current: boolean; invalid: boolean } {
  if (
    (row.startDate !== null && !validIsoDate(row.startDate)) ||
    (row.endDate !== null && !validIsoDate(row.endDate))
  ) {
    return { current: false, invalid: true };
  }
  return {
    current:
      (row.startDate === null || row.startDate <= today) &&
      (row.endDate === null || row.endDate >= today),
    invalid: false,
  };
}

function isPtTaxonomy(code: string | null): code is string {
  if (!code) return false;
  const label = taxonomyLabel(code);
  return Boolean(
    label?.startsWith("Physical Therapist") && label !== "Physical Therapist Assistant",
  );
}

interface SnapshotIndex {
  providers: Map<string, BillingProvider>;
  groups: Map<string, BillingGroup>;
  facilities: Map<string, BillingFacility>;
  payers: Map<string, BillingPayer>;
  casesByProvider: Map<string, BillingCase[]>;
  caseFacilitiesByCase: Map<string, BillingCaseFacility[]>;
  membershipsByProvider: Map<string, BillingGroupMembership[]>;
  assignmentsByProvider: Map<string, BillingFacilityAssignment[]>;
  assignmentsByFacility: Map<string, BillingFacilityAssignment[]>;
  licensesByProvider: Map<string, BillingLicense[]>;
}

const INDEXED_ARRAYS = [
  "providers",
  "groups",
  "facilities",
  "payers",
  "groupMemberships",
  "facilityAssignments",
  "licenses",
  "cases",
  "caseFacilities",
] as const;

const snapshotIndexes = new WeakMap<
  BillingReadinessSnapshot,
  { arrays: readonly unknown[][]; lengths: number[]; index: SnapshotIndex }
>();

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return map;
}

function groupRows<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (value === null) continue;
    const current = map.get(value);
    if (current) current.push(row);
    else map.set(value, [row]);
  }
  return map;
}

// At Luna scale (thousands of clinicians, tens of thousands of cases) an
// assessment must not rescan the whole snapshot. The index is rebuilt whenever
// one of the snapshot's arrays is replaced or changes length. Rows are shared
// by reference, so an in-place edit to a field the index does not key on is
// seen; an in-place edit to a keyed field (id, providerId, caseId, facilityId)
// is not, until the array is replaced. Snapshots from the service are never
// edited in place.
function snapshotIndex(snapshot: BillingReadinessSnapshot): SnapshotIndex {
  const arrays = INDEXED_ARRAYS.map((key) => snapshot[key] as unknown[]);
  const cached = snapshotIndexes.get(snapshot);
  if (
    cached &&
    arrays.every((rows, i) => rows === cached.arrays[i] && rows.length === cached.lengths[i])
  ) {
    return cached.index;
  }
  const index: SnapshotIndex = {
    providers: byId(snapshot.providers),
    groups: byId(snapshot.groups),
    facilities: byId(snapshot.facilities),
    payers: byId(snapshot.payers),
    casesByProvider: groupRows(snapshot.cases, (row) => row.providerId),
    caseFacilitiesByCase: groupRows(snapshot.caseFacilities, (row) => row.caseId),
    membershipsByProvider: groupRows(snapshot.groupMemberships, (row) => row.providerId),
    assignmentsByProvider: groupRows(snapshot.facilityAssignments, (row) => row.providerId),
    assignmentsByFacility: groupRows(snapshot.facilityAssignments, (row) => row.facilityId),
    licensesByProvider: groupRows(snapshot.licenses, (row) => row.providerId),
  };
  snapshotIndexes.set(snapshot, { arrays, lengths: arrays.map((rows) => rows.length), index });
  return index;
}

function currentStateLicense(
  licenses: BillingLicense[],
  providerId: string,
  state: string,
  today: string,
): { reason: BillingReason | null; expirationDate: string | null } {
  const rows = licenses.filter(
    (license) => license.providerId === providerId && stateCode(license.state) === state,
  );
  if (rows.length === 0) {
    return {
      reason: { severity: "hold", label: `No ${state} license evidence is recorded.` },
      expirationDate: null,
    };
  }

  const active = rows.filter((row) => (row.status ?? "").toLowerCase() === "active");
  if (active.length === 0) {
    return {
      reason: { severity: "stop", label: `No active ${state} license is recorded.` },
      expirationDate: null,
    };
  }
  const failed = active.some((row) => row.verifiedStatus === "failed");
  const unverified = active.some(
    (row) => row.verifiedStatus !== "verified" && row.verifiedStatus !== "failed",
  );
  const verified = active.filter((row) => row.verifiedStatus === "verified");
  const malformed = verified.some((row) => {
    if (!row.licenseNumber?.trim() || !row.expirationDate || !validIsoDate(row.expirationDate))
      return true;
    if (row.issueDate !== null && (!validIsoDate(row.issueDate) || row.issueDate > today))
      return true;
    return row.issueDate !== null && row.expirationDate < row.issueDate;
  });
  const valid = verified.filter(
    (row) =>
      row.licenseNumber?.trim() &&
      row.expirationDate &&
      validIsoDate(row.expirationDate) &&
      (row.issueDate === null ||
        (validIsoDate(row.issueDate) &&
          row.issueDate <= today &&
          row.issueDate <= row.expirationDate)),
  );
  const unexpired = valid.filter((row) => row.expirationDate! >= today);

  // Conflicting active records fail closed even if one sibling looks usable.
  if (unexpired.length > 0 && (failed || unverified || malformed)) {
    return {
      reason: {
        severity: "hold",
        label: `Conflicting active ${state} license records need review.`,
      },
      expirationDate: null,
    };
  }
  if (failed && unexpired.length === 0) {
    return {
      reason: { severity: "stop", label: `The ${state} license failed verification.` },
      expirationDate: null,
    };
  }
  if (malformed || unverified) {
    return {
      reason: { severity: "hold", label: `The ${state} license record is incomplete or invalid.` },
      expirationDate: null,
    };
  }
  if (unexpired.length === 0) {
    const expiry =
      valid
        .map((row) => row.expirationDate!)
        .sort()
        .at(-1) ?? null;
    return {
      reason: { severity: "stop", label: `The ${state} license is expired.` },
      expirationDate: expiry,
    };
  }
  return {
    reason: null,
    expirationDate: unexpired.sort((a, b) => a.expirationDate!.localeCompare(b.expirationDate!))[0]
      .expirationDate,
  };
}

function clinicianReasons(provider: BillingProvider): BillingReason[] {
  const reasons: BillingReason[] = [];
  // Only a terminated clinician is Do Not Bill. "onboarding" is the create
  // default and rarely flipped, so it holds rather than stops (PM decision
  // 2026-10-20): an approved, effective enrollment must never read as a stop.
  if (provider.status === "terminated") {
    reasons.push({ severity: "stop", label: "The clinician is terminated." });
  } else if (provider.status === "onboarding") {
    reasons.push({
      severity: "hold",
      label:
        "Clinician is still marked Onboarding. Mark them Active once they start seeing patients.",
    });
  } else if (provider.status !== "active") {
    // Unreachable under today's providers_status_check; a status added later
    // holds until this rule learns it.
    reasons.push({ severity: "hold", label: "The clinician status is not recognized." });
  }
  if (provider.verificationState !== "verified") {
    reasons.push({ severity: "hold", label: "Clinician verification is incomplete." });
  }
  if (provider.isTestProvider) {
    reasons.push({
      severity: "stop",
      label: "Test clinicians are excluded from billing readiness.",
    });
  }
  return reasons;
}

function providerFacilityEvidence(
  snapshot: BillingReadinessSnapshot,
  provider: BillingProvider,
  facility: BillingFacility,
  group: BillingGroup | null,
  state: string | null,
  today: string,
  includeCase: boolean,
): BillingReason[] {
  const reasons: BillingReason[] = clinicianReasons(provider);
  if (!facility.isActive) reasons.push({ severity: "stop", label: "The facility is inactive." });
  if (!group) reasons.push({ severity: "hold", label: "The facility has no linked group." });
  else if (!group.isActive)
    reasons.push({ severity: "stop", label: "The facility's group is inactive." });
  if (!state)
    reasons.push({ severity: "hold", label: "The facility state is missing or invalid." });

  const index = snapshotIndex(snapshot);
  if (group) {
    const memberships = (index.membershipsByProvider.get(provider.id) ?? []).filter(
      (row) => row.groupId === group.id,
    );
    const states = memberships.map((row) => isCurrentMembership(row, today));
    if (states.some((result) => result.invalid)) {
      reasons.push({ severity: "hold", label: "The group membership dates are invalid." });
    } else if (states.some((result) => result.current)) {
      if (states.filter((result) => result.current).length > 1) {
        reasons.push({
          severity: "hold",
          label: "Conflicting current group memberships are recorded.",
        });
      }
    } else {
      reasons.push({ severity: "hold", label: "Current group membership is not established." });
    }
  }

  const assignments = (index.assignmentsByProvider.get(provider.id) ?? []).filter(
    (row) => row.facilityId === facility.id,
  );
  if (assignments.length === 0) {
    reasons.push({
      severity: "hold",
      label: "A clinician-to-facility assignment is not recorded.",
    });
  } else if (assignments.length > 1) {
    reasons.push({
      severity: "hold",
      label: "Conflicting clinician-to-facility assignments are recorded.",
    });
  } else if (!assignments[0].startDate) {
    reasons.push({ severity: "hold", label: "The facility assignment start date is missing." });
  } else if (!validIsoDate(assignments[0].startDate)) {
    reasons.push({ severity: "hold", label: "The facility assignment start date is invalid." });
  } else if (assignments[0].startDate > today) {
    reasons.push({ severity: "hold", label: "The facility assignment has not started." });
  }

  if (includeCase && state) {
    const licenses = currentStateLicense(
      index.licensesByProvider.get(provider.id) ?? [],
      provider.id,
      state,
      today,
    );
    if (licenses.reason) reasons.push(licenses.reason);
  }
  return reasons;
}

function isApprovedCase(billingCase: BillingCase): boolean {
  const status = billingCase.caseStatus?.trim().toLowerCase() ?? "";
  return status === "approved" || status === "in_network";
}

function statusFor(reasons: BillingReason[]): BillingReadinessStatus {
  if (reasons.some((reason) => reason.severity === "stop")) return "stop";
  if (reasons.some((reason) => reason.severity === "hold")) return "hold";
  return "ready";
}

function supervisorCandidates(
  snapshot: BillingReadinessSnapshot,
  selectedProviderId: string,
  facility: BillingFacility,
  group: BillingGroup | null,
  state: string | null,
  today: string,
): BillingSupervisorCandidate[] {
  if (!group || !state || !facility.isActive || !group.isActive) return [];
  const index = snapshotIndex(snapshot);
  // Candidates must be assigned to this facility, so only its roster is read.
  const rosterIds = new Set(
    (index.assignmentsByFacility.get(facility.id) ?? []).map((row) => row.providerId),
  );
  return snapshot.providers
    .filter((provider) => rosterIds.has(provider.id))
    .filter((provider) => provider.id !== selectedProviderId && isPtTaxonomy(provider.taxonomyCode))
    .filter(
      (provider) =>
        provider.status === "active" &&
        provider.verificationState === "verified" &&
        !provider.isTestProvider &&
        providerFacilityEvidence(snapshot, provider, facility, group, state, today, true).length ===
          0,
    )
    .map((provider) => ({
      providerId: provider.id,
      name: `${provider.firstName} ${provider.lastName}`.trim(),
      npi: provider.npi,
      taxonomyCode: provider.taxonomyCode!,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The case's own status and date reasons, with the payer decision estimate
 * for a case still under review. Shared by the evaluator and by Lookup rows
 * that cannot be fully assessed. */
function enrollmentCaseReasons(
  enrollment: BillingCase,
  payer: BillingPayer,
  today: string,
): { reasons: BillingReason[]; estimatedDecisionDate: string | null } {
  const reasons: BillingReason[] = [];
  let estimatedDecisionDate: string | null = null;
  if (isApprovedCase(enrollment)) {
    if (
      enrollment.caseStatus?.toLowerCase() === "in_network" &&
      !enrollment.confirmedEffectiveDate
    ) {
      reasons.push({
        severity: "hold",
        label: "The legacy in-network record has no confirmed effective date.",
      });
    }
  } else if (enrollment.caseStatus === "submitted" || enrollment.caseStatus === "in_review") {
    reasons.push({
      severity: "hold",
      label: `Enrollment is ${enrollment.caseStatus.replace("_", " ")}.`,
    });
    if (
      validIsoDate(enrollment.submittedDate) &&
      enrollment.submittedDate <= today &&
      payer.avgDecisionDays !== null &&
      Number.isFinite(payer.avgDecisionDays) &&
      payer.avgDecisionDays > 0
    ) {
      estimatedDecisionDate = shiftDays(enrollment.submittedDate, payer.avgDecisionDays);
    }
  } else if (enrollment.caseStatus === null || enrollment.caseStatus === "") {
    reasons.push({ severity: "hold", label: "Current enrollment status is missing." });
  } else if (
    !KNOWN_CASE_STATUSES.includes(enrollment.caseStatus as (typeof KNOWN_CASE_STATUSES)[number])
  ) {
    reasons.push({ severity: "hold", label: "Current enrollment status is unknown." });
  } else {
    reasons.push({
      severity: "stop",
      label: `Enrollment status is ${enrollment.caseStatus.replaceAll("_", " ")}.`,
    });
  }

  const confirmedEffectiveDate = enrollment.confirmedEffectiveDate;
  const expectedEffectiveDate = enrollment.expectedEffectiveDate;
  if (confirmedEffectiveDate === null) {
    reasons.push({
      severity: "hold",
      label: expectedEffectiveDate
        ? "Only an expected effective date is recorded."
        : "A confirmed effective date is missing.",
    });
  } else if (!validIsoDate(confirmedEffectiveDate)) {
    reasons.push({ severity: "hold", label: "The confirmed effective date is invalid." });
  } else if (!isDateReached(confirmedEffectiveDate, today)) {
    reasons.push({
      severity: "hold",
      label: "The confirmed effective date has not been reached.",
    });
  }
  if (expectedEffectiveDate !== null && !validIsoDate(expectedEffectiveDate)) {
    reasons.push({ severity: "hold", label: "The expected effective date is invalid." });
  }
  if (enrollment.approvedDate !== null) {
    if (!validIsoDate(enrollment.approvedDate)) {
      reasons.push({ severity: "hold", label: "The recorded approval date is invalid." });
    } else if (enrollment.approvedDate > today) {
      reasons.push({
        severity: "hold",
        label: "The recorded approval date has not been reached.",
      });
    }
  }
  if (enrollment.terminationDate !== null) {
    if (!validIsoDate(enrollment.terminationDate)) {
      reasons.push({ severity: "hold", label: "The termination date is invalid." });
    } else if (isDateReached(enrollment.terminationDate, today)) {
      reasons.push({ severity: "stop", label: "Enrollment termination is effective." });
    }
  }
  return { reasons, estimatedDecisionDate };
}

function payerReasons(payer: BillingPayer): BillingReason[] {
  return payer.status !== "active" || payer.isActive !== true
    ? [{ severity: "stop", label: "The payer is inactive." }]
    : [];
}

function statusLabelFor(status: BillingReadinessStatus): BillingAssessment["label"] {
  return status === "ready" ? "Billable Ready" : status === "stop" ? "Do Not Bill" : "Hold";
}

export function evaluateBillingReadiness(
  snapshot: BillingReadinessSnapshot,
  selection: BillingSelection,
  today: string,
): BillingAssessment | null {
  if (!validIsoDate(today)) return null;
  const index = snapshotIndex(snapshot);
  const provider = index.providers.get(selection.providerId);
  const facility = index.facilities.get(selection.facilityId);
  const payer = index.payers.get(selection.payerId);
  if (!provider || !facility || !payer) return null;

  const group = facility.groupId ? (index.groups.get(facility.groupId) ?? null) : null;
  const state = stateCode(facility.state);
  const reasons = providerFacilityEvidence(
    snapshot,
    provider,
    facility,
    group,
    state,
    today,
    false,
  );
  const exactCases = (index.casesByProvider.get(provider.id) ?? []).filter(
    (row) =>
      row.groupId === (facility.groupId ?? null) &&
      row.payerId === payer.id &&
      state !== null &&
      stateCode(row.state) === state,
  );
  const selectedCase: BillingCase | null = exactCases.length === 1 ? exactCases[0] : null;
  let confirmedEffectiveDate: string | null = null;
  let expectedEffectiveDate: string | null = null;
  let estimatedDecisionDate: string | null = null;

  if (exactCases.length === 0) {
    reasons.push({ severity: "stop", label: "No exact payer enrollment case is recorded." });
  } else if (exactCases.length > 1) {
    reasons.push({
      severity: "hold",
      label: "Conflicting enrollment cases match this clinician, group, payer, and state.",
    });
  } else if (selectedCase) {
    const enrollment = selectedCase;
    const linked = (index.caseFacilitiesByCase.get(enrollment.id) ?? []).some(
      (row) => row.facilityId === facility.id,
    );
    if (!linked)
      reasons.push({
        severity: "hold",
        label: "This facility is not linked to the enrollment case.",
      });

    const caseReasons = enrollmentCaseReasons(enrollment, payer, today);
    reasons.push(...caseReasons.reasons);
    estimatedDecisionDate = caseReasons.estimatedDecisionDate;
    confirmedEffectiveDate = enrollment.confirmedEffectiveDate;
    expectedEffectiveDate = enrollment.expectedEffectiveDate;
    if (state) {
      const license = currentStateLicense(
        index.licensesByProvider.get(provider.id) ?? [],
        provider.id,
        state,
        today,
      );
      if (license.reason) reasons.push(license.reason);
    }
  }

  reasons.push(...payerReasons(payer));

  const normalizedTaxonomy = provider.taxonomyCode?.trim().toUpperCase() ?? "";
  const isPta = normalizedTaxonomy === PTA_TAXONOMY;
  const isOta = normalizedTaxonomy.startsWith(OTA_TAXONOMY_PREFIX);
  const candidates = isPta
    ? supervisorCandidates(snapshot, provider.id, facility, group, state, today)
    : [];
  if (isPta) {
    reasons.push({
      severity: "hold",
      label: "PTA supervision is unverified; confirm payer and service requirements.",
    });
  }
  if (isOta) {
    reasons.push({
      severity: "hold",
      label:
        "OTA supervision and CO modifier requirements are unverified; confirm payer and service rules.",
    });
  }

  const status = statusFor(reasons);
  return {
    status,
    label: statusLabelFor(status),
    provider,
    group,
    facility,
    payer,
    state,
    case: selectedCase,
    confirmedEffectiveDate,
    expectedEffectiveDate,
    estimatedDecisionDate,
    retroEligibility: "Not recorded",
    isPta,
    isOta,
    supervisorCandidates: candidates,
    reasons: [
      ...new Map(reasons.map((reason) => [`${reason.severity}:${reason.label}`, reason])).values(),
    ],
  };
}

function eventDateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  if (validIsoDate(value)) return Date.parse(`${value}T00:00:00.000Z`);
  if (!validDateTime(value)) return null;
  return Date.parse(value);
}

function eventDateLabel(value: string): string {
  return validIsoDate(value) ? value : new Date(value).toISOString();
}

function eventLocalCalendarDate(value: string): string | null {
  if (validIsoDate(value)) return value;
  if (!validDateTime(value)) return null;
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function eventWithinRange(
  event: BillingFeedEvent,
  range: BillingFeedRange,
  today: string,
): boolean {
  if (!validIsoDate(today)) return false;
  const startDate = shiftDays(today, -(range - 1));
  if (!startDate) return false;
  if (validIsoDate(event.eventDate)) {
    // Date-derived warnings belong to the stated calendar date, independent
    // of the viewer's UTC offset.
    return event.eventDate >= startDate && event.eventDate <= today;
  }
  const eventValue = eventDateValue(event.eventDate);
  if (eventValue === null) return false;
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = today.split("-").map(Number);
  const startValue = new Date(startYear, startMonth - 1, startDay).getTime();
  const endValue = new Date(endYear, endMonth - 1, endDay + 1).getTime() - 1;
  return eventValue >= startValue && eventValue <= endValue;
}

function makeFeedEvent(
  snapshot: BillingReadinessSnapshot,
  fields: Omit<BillingFeedEvent, "providerName" | "npi" | "facilityName" | "payerName">,
): BillingFeedEvent | null {
  const index = snapshotIndex(snapshot);
  const provider = index.providers.get(fields.providerId);
  if (!provider) return null;
  const facility = fields.facilityId ? (index.facilities.get(fields.facilityId) ?? null) : null;
  const payer = fields.payerId ? (index.payers.get(fields.payerId) ?? null) : null;
  return {
    ...fields,
    eventDate: eventDateLabel(fields.eventDate),
    providerName: `${provider.firstName} ${provider.lastName}`.trim(),
    npi: provider.npi,
    facilityName: facility?.name ?? null,
    payerName: payer?.name ?? null,
  };
}

export function buildBillingFeed(
  snapshot: BillingReadinessSnapshot,
  today: string,
): BillingFeedEvent[] {
  if (!validIsoDate(today)) return [];
  const index = snapshotIndex(snapshot);
  const casesById = new Map(snapshot.cases.map((row) => [row.id, row]));
  const linkedFacilitiesByCase = new Map<string, BillingCaseFacility[]>();
  for (const link of snapshot.caseFacilities) {
    const current = linkedFacilitiesByCase.get(link.caseId) ?? [];
    current.push(link);
    linkedFacilitiesByCase.set(link.caseId, current);
  }
  const events: BillingFeedEvent[] = [];
  const canonicalApprovalTimes = new Set<string>();

  const addCaseEvent = (
    kind: BillingFeedKind,
    title: string,
    row: BillingCase,
    eventDate: string,
    recorded: boolean,
  ) => {
    for (const link of linkedFacilitiesByCase.get(row.id) ?? []) {
      const event = makeFeedEvent(snapshot, {
        id: `${kind}:${row.id}:${link.facilityId}:${eventDate}`,
        kind,
        title,
        eventDate,
        recorded,
        providerId: row.providerId,
        facilityId: link.facilityId,
        payerId: row.payerId,
        groupId: row.groupId,
        state: stateCode(row.state),
        caseId: row.id,
      });
      if (event) events.push(event);
    }
  };

  for (const transition of snapshot.statusTransitions) {
    if (
      transition.toStatus !== "approved" ||
      !validDateTime(transition.changedAt) ||
      transition.fromStatus === undefined ||
      transition.actorKind === undefined ||
      !transition.actorKind ||
      // A NULL→current system seed describes where the case stood (the
      // unified-history migration snapshot, or creation), not an approval
      // that happened at changed_at.
      isStatusHistorySeed(transition)
    )
      continue;
    const row = casesById.get(transition.caseId);
    if (!row) continue;
    canonicalApprovalTimes.add(`${row.id}:approved:${Date.parse(transition.changedAt)}`);
    addCaseEvent("approval", "Enrollment approved", row, transition.changedAt, true);
  }

  for (const transition of snapshot.legacyStatusTransitions) {
    if (
      transition.track !== "credentialing" ||
      !transition.caseId ||
      !transition.toStatusLabel ||
      !validDateTime(transition.changedAt)
    )
      continue;
    const label = canonicalLabel(transition.toStatusLabel);
    if (label !== APPROVED_LABEL && label !== IN_NETWORK_LABEL) continue;
    const row = casesById.get(transition.caseId);
    if (!row) continue;
    const identity = `${row.id}:approved:${Date.parse(transition.changedAt)}`;
    if (canonicalApprovalTimes.has(identity)) continue;
    addCaseEvent(
      "approval",
      "Enrollment approved (legacy record)",
      row,
      transition.changedAt,
      true,
    );
  }

  for (const link of snapshot.caseFacilities) {
    if (!link.createdBy || !validDateTime(link.createdAt)) continue;
    const row = casesById.get(link.caseId);
    if (!row) continue;
    const event = makeFeedEvent(snapshot, {
      id: `facility:${row.id}:${link.facilityId}:${link.createdAt}`,
      kind: "facility_added",
      title: "Facility linked to enrollment case",
      eventDate: link.createdAt,
      recorded: true,
      providerId: row.providerId,
      facilityId: link.facilityId,
      payerId: row.payerId,
      groupId: row.groupId,
      state: stateCode(row.state),
      caseId: row.id,
    });
    if (event) events.push(event);
  }

  for (const row of snapshot.cases) {
    if (row.terminationDate && validIsoDate(row.terminationDate) && row.terminationDate <= today) {
      addCaseEvent(
        "termination",
        "Enrollment termination effective",
        row,
        row.terminationDate,
        false,
      );
    }
  }

  for (const license of snapshot.licenses) {
    const effectiveExpiredDate = license.expirationDate
      ? shiftDays(license.expirationDate, 1)
      : null;
    if (
      !license.providerId ||
      !license.expirationDate ||
      !validIsoDate(license.expirationDate) ||
      !effectiveExpiredDate ||
      effectiveExpiredDate > today
    )
      continue;
    const providerId = license.providerId;
    const matchingAssignments = (index.assignmentsByProvider.get(providerId) ?? []).filter(
      (row) =>
        row.facilityId && row.startDate && validIsoDate(row.startDate) && row.startDate <= today,
    );
    for (const assignment of matchingAssignments) {
      const facility = assignment.facilityId
        ? index.facilities.get(assignment.facilityId)
        : undefined;
      if (!facility || stateCode(facility.state) !== stateCode(license.state)) continue;
      const payerCases = (index.casesByProvider.get(providerId) ?? []).filter(
        (row) =>
          row.groupId === facility.groupId && stateCode(row.state) === stateCode(license.state),
      );
      const contextCases = payerCases.length > 0 ? payerCases : [null];
      for (const row of contextCases) {
        const event = makeFeedEvent(snapshot, {
          id: `license:${license.providerId}:${license.state}:${license.expirationDate}:${facility.id}:${row?.payerId ?? ""}`,
          kind: "license_expiration",
          title: `${license.state} license expired`,
          eventDate: effectiveExpiredDate,
          recorded: false,
          providerId: license.providerId,
          facilityId: facility.id,
          payerId: row?.payerId ?? null,
          groupId: facility.groupId,
          state: stateCode(license.state),
          caseId: row?.id ?? null,
        });
        if (event) events.push(event);
      }
    }
  }

  const deduped = new Map<string, BillingFeedEvent>();
  for (const event of events) {
    const identity = `${event.kind}:${event.caseId ?? ""}:${event.facilityId ?? ""}:${event.providerId}:${event.payerId ?? ""}:${event.eventDate}`;
    const existing = deduped.get(identity);
    if (!existing || (event.recorded && !existing.recorded)) deduped.set(identity, event);
  }
  return [...deduped.values()].sort((a, b) => {
    const byDate = (eventDateValue(b.eventDate) ?? 0) - (eventDateValue(a.eventDate) ?? 0);
    return byDate || a.id.localeCompare(b.id);
  });
}

export function filterBillingFeed(
  events: BillingFeedEvent[],
  filters: BillingFeedFilters,
  today: string,
): BillingFeedEvent[] {
  return events.filter(
    (event) =>
      eventWithinRange(event, filters.range, today) &&
      (!filters.facilityId || event.facilityId === filters.facilityId) &&
      (!filters.payerId || event.payerId === filters.payerId) &&
      (!filters.kind || event.kind === filters.kind),
  );
}

export interface DigestRow {
  providerName: string;
  providerNpi: string;
  groupName: string;
  groupTin: string;
  groupNpi: string;
  facilityId: string;
  facilityName: string;
  payerId: string;
  payerName: string;
  state: string;
  confirmedEffectiveDate: string;
  eventDate: string;
  asOf: string;
}

function safeCsvCell(value: string): string {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildNewlyBillableDigestCsv(
  snapshot: BillingReadinessSnapshot,
  events: BillingFeedEvent[],
  today: string,
): string {
  const columns: Array<keyof DigestRow> = [
    "providerName",
    "providerNpi",
    "groupName",
    "groupTin",
    "groupNpi",
    "facilityId",
    "facilityName",
    "payerId",
    "payerName",
    "state",
    "confirmedEffectiveDate",
    "eventDate",
    "asOf",
  ];
  const headings: Record<keyof DigestRow, string> = {
    providerName: "Clinician",
    providerNpi: "Provider NPI",
    groupName: "Group",
    groupTin: "Group TIN",
    groupNpi: "Group NPI",
    facilityId: "Facility ID",
    facilityName: "Facility",
    payerId: "Payer ID",
    payerName: "Payer",
    state: "State",
    confirmedEffectiveDate: "Recorded confirmed effective date",
    eventDate: "Approval/link event date",
    asOf: "Assessed as of",
  };
  const rows = new Map<string, DigestRow>();
  for (const event of events) {
    const eventCalendarDate = eventLocalCalendarDate(event.eventDate);
    if (
      (event.kind !== "approval" && event.kind !== "facility_added") ||
      !event.caseId ||
      !event.facilityId ||
      !event.payerId ||
      !eventCalendarDate
    )
      continue;
    const assessment = evaluateBillingReadiness(
      snapshot,
      { providerId: event.providerId, facilityId: event.facilityId, payerId: event.payerId },
      today,
    );
    if (
      assessment?.status !== "ready" ||
      !assessment.group ||
      !assessment.state ||
      !assessment.confirmedEffectiveDate ||
      assessment.case?.id !== event.caseId ||
      assessment.group.id !== event.groupId
    )
      continue;
    const row: DigestRow = {
      providerName: `${assessment.provider.firstName} ${assessment.provider.lastName}`.trim(),
      providerNpi: assessment.provider.npi ?? "",
      groupName: assessment.group.name,
      groupTin: assessment.group.tin ?? "",
      groupNpi: assessment.group.npiType2 ?? "",
      facilityId: assessment.facility.id,
      facilityName: assessment.facility.name,
      payerId: assessment.payer.id,
      payerName: assessment.payer.name,
      state: assessment.state,
      confirmedEffectiveDate: assessment.confirmedEffectiveDate,
      eventDate: eventCalendarDate,
      asOf: today,
    };
    const key = `${assessment.case?.id ?? event.caseId}:${assessment.facility.id}`;
    const existing = rows.get(key);
    if (!existing || row.eventDate > existing.eventDate) rows.set(key, row);
  }
  return [
    columns.map((column) => safeCsvCell(headings[column])).join(","),
    ...[...rows.values()].map((row) => columns.map((column) => safeCsvCell(row[column])).join(",")),
  ].join("\r\n");
}

export function billingFeedWindowStart(today: string): string | null {
  if (!validIsoDate(today)) return null;
  return shiftDays(today, -(FEED_WINDOW_DAYS - 1));
}

export function billingFeedQueryWindowStart(today: string): string | null {
  const start = billingFeedWindowStart(today);
  return start ? shiftDays(start, -1) : null;
}

export function isPtaTaxonomy(code: string | null): boolean {
  return code?.trim().toUpperCase() === PTA_TAXONOMY;
}

/** The current assessment for a feed event's own case and facility, or null
 * when that pair no longer resolves to the same case (moved group, conflict). */
export function assessFeedEvent(
  snapshot: BillingReadinessSnapshot,
  event: BillingFeedEvent,
  today: string,
): BillingAssessment | null {
  if (!event.payerId || !event.facilityId) return null;
  const assessment = evaluateBillingReadiness(
    snapshot,
    { providerId: event.providerId, facilityId: event.facilityId, payerId: event.payerId },
    today,
  );
  if (
    !assessment?.case ||
    assessment.case.id !== event.caseId ||
    assessment.case.groupId !== event.groupId
  ) {
    return null;
  }
  return assessment;
}

/** Every visible change-feed row with its current readiness, for export. */
export function buildChangeFeedCsv(
  snapshot: BillingReadinessSnapshot,
  events: BillingFeedEvent[],
  today: string,
): string {
  const headings = [
    "Date",
    "Change",
    "Source",
    "Clinician",
    "Provider NPI",
    "Facility",
    "Payer",
    "State",
    "Current readiness",
    "Reasons",
    "Recorded confirmed effective date",
    "Assessed as of",
  ];
  const rows = events.map((event) => {
    const assessment = assessFeedEvent(snapshot, event, today);
    return [
      eventLocalCalendarDate(event.eventDate) ?? event.eventDate,
      event.title,
      event.recorded ? "Recorded" : "Date-derived",
      event.providerName,
      event.npi ?? "",
      event.facilityName ?? "",
      event.payerName ?? "",
      event.state ?? "",
      assessment?.label ?? "Unable to assess",
      assessment?.reasons.map((reason) => reason.label).join(" ") ?? "",
      assessment?.confirmedEffectiveDate ?? "",
      today,
    ];
  });
  return [headings, ...rows]
    .map((row) => row.map((cell) => safeCsvCell(cell)).join(","))
    .join("\r\n");
}

export interface BillingProviderMatch {
  provider: BillingProvider;
  name: string;
  groupNames: string[];
  states: string[];
}

export interface BillingProviderSearch {
  matches: BillingProviderMatch[];
  total: number;
}

const SEARCH_RESULT_LIMIT = 50;

/** One search box for the clearance lookup: clinician name, NPI, state code,
 * location, or group. Results carry group and state so duplicate names can be
 * told apart; at most 50 are returned with the full match count. */
export function searchBillingProviders(
  snapshot: BillingReadinessSnapshot,
  query: string,
  today: string,
): BillingProviderSearch {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: [], total: 0 };
  const index = snapshotIndex(snapshot);
  const tokens = needle.split(/\s+/);
  const digits = needle.replace(/\D/g, "");
  const isNumeric = /^[\d\s-]+$/.test(needle) && digits.length >= 3;
  const stateQuery = /^[a-z]{2}$/.test(needle) ? needle.toUpperCase() : null;

  const ranked: Array<{ rank: number; match: BillingProviderMatch }> = [];
  for (const provider of snapshot.providers) {
    const name = `${provider.firstName} ${provider.lastName}`.trim();
    const memberships = index.membershipsByProvider.get(provider.id) ?? [];
    const current = memberships.filter((row) => isCurrentMembership(row, today).current);
    const groupNames = [
      ...new Set(
        (current.length > 0 ? current : memberships)
          .map((row) => index.groups.get(row.groupId)?.name)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort();
    const facilities = (index.assignmentsByProvider.get(provider.id) ?? [])
      .map((row) => (row.facilityId ? index.facilities.get(row.facilityId) : undefined))
      .filter((row): row is BillingFacility => Boolean(row));
    const states = [
      ...new Set(
        [
          ...facilities.map((row) => stateCode(row.state)),
          ...(index.casesByProvider.get(provider.id) ?? []).map((row) => stateCode(row.state)),
        ].filter((value): value is string => value !== null),
      ),
    ].sort();

    const words = name.toLowerCase().split(/\s+/);
    let rank: number | null = null;
    if (isNumeric && provider.npi?.includes(digits)) rank = provider.npi === digits ? 0 : 1;
    else if (name.toLowerCase() === needle) rank = 0;
    else if (tokens.every((token) => words.some((word) => word.startsWith(token)))) rank = 2;
    else if (stateQuery && states.includes(stateQuery)) rank = 3;
    else if (
      needle.length >= 3 &&
      (facilities.some((row) => row.name.toLowerCase().includes(needle)) ||
        groupNames.some((group) => group.toLowerCase().includes(needle)))
    )
      rank = 4;
    if (rank === null) continue;
    ranked.push({ rank, match: { provider, name, groupNames, states } });
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.match.name.localeCompare(b.match.name) ||
      a.match.provider.id.localeCompare(b.match.provider.id),
  );
  return {
    matches: ranked.slice(0, SEARCH_RESULT_LIMIT).map((row) => row.match),
    total: ranked.length,
  };
}

export interface BillingPayerStatusRow {
  key: string;
  caseId: string;
  payer: BillingPayer;
  facility: BillingFacility | null;
  /** The location as the Lookup names it: the facility, or why there is none. */
  locationLabel: string;
  state: string | null;
  status: BillingReadinessStatus;
  label: BillingAssessment["label"];
  reasons: BillingReason[];
  confirmedEffectiveDate: string | null;
  expectedEffectiveDate: string | null;
  assessment: BillingAssessment | null;
}

const NO_LINKED_LOCATION = "No linked location";
const LOCATION_NOT_ON_RECORD = "Location not on record";

/** Payer-by-payer readiness for one clinician: one row per enrollment case and
 * linked location, alphabetical by payer then location. A case with no linked
 * location still gets a row, held, so it never silently disappears. */
export function providerPayerStatuses(
  snapshot: BillingReadinessSnapshot,
  providerId: string,
  today: string,
): BillingPayerStatusRow[] {
  if (!validIsoDate(today)) return [];
  const index = snapshotIndex(snapshot);
  const provider = index.providers.get(providerId) ?? null;
  const rows: BillingPayerStatusRow[] = [];

  // A row that cannot be fully assessed against a location still carries
  // every stop that does not depend on the location (the clinician, the case
  // itself, the payer), so a terminated or denied enrollment never reads as a
  // mere Hold. The location reason is added as a hold.
  const unassessedRow = (
    row: BillingCase,
    payer: BillingPayer,
    key: string,
    facility: BillingFacility | null,
    locationLabel: string,
    locationReason: string,
  ): BillingPayerStatusRow => {
    const stops = [
      ...(provider ? clinicianReasons(provider) : []),
      ...enrollmentCaseReasons(row, payer, today).reasons,
      ...payerReasons(payer),
    ].filter((reason) => reason.severity === "stop");
    const reasons: BillingReason[] = [...stops, { severity: "hold", label: locationReason }];
    const status = statusFor(reasons);
    return {
      key,
      caseId: row.id,
      payer,
      facility,
      locationLabel,
      state: stateCode(row.state),
      status,
      label: statusLabelFor(status),
      reasons,
      confirmedEffectiveDate: row.confirmedEffectiveDate,
      expectedEffectiveDate: row.expectedEffectiveDate,
      assessment: null,
    };
  };

  for (const row of index.casesByProvider.get(providerId) ?? []) {
    const payer = index.payers.get(row.payerId);
    if (!payer) continue;
    const facilityIds = [
      ...new Set((index.caseFacilitiesByCase.get(row.id) ?? []).map((link) => link.facilityId)),
    ];
    if (facilityIds.length === 0) {
      rows.push(
        unassessedRow(
          row,
          payer,
          `${row.id}:none`,
          null,
          NO_LINKED_LOCATION,
          "No location is linked to this enrollment case.",
        ),
      );
      continue;
    }
    for (const facilityId of facilityIds) {
      const key = `${row.id}:${facilityId}`;
      const facility = index.facilities.get(facilityId) ?? null;
      if (!facility) {
        rows.push(
          unassessedRow(
            row,
            payer,
            key,
            null,
            LOCATION_NOT_ON_RECORD,
            "The location linked to this enrollment case is not on record.",
          ),
        );
        continue;
      }
      // The evaluator finds a case by the location's CURRENT group and state.
      // A location that moved group, or one in another state, would resolve to
      // "no exact case" and read Do Not Bill on an approved case, so the row
      // gets its own location reason instead (the guard assessFeedEvent
      // applies).
      const facilityState = stateCode(facility.state);
      if (facilityState === null) {
        rows.push(
          unassessedRow(
            row,
            payer,
            key,
            facility,
            facility.name,
            "This location has no valid state on record.",
          ),
        );
        continue;
      }
      if ((facility.groupId ?? null) !== row.groupId || facilityState !== stateCode(row.state)) {
        rows.push(
          unassessedRow(
            row,
            payer,
            key,
            facility,
            facility.name,
            "This location's group or state no longer matches the enrollment case.",
          ),
        );
        continue;
      }
      const assessment = evaluateBillingReadiness(
        snapshot,
        { providerId, facilityId, payerId: row.payerId },
        today,
      );
      if (!assessment) continue;
      rows.push({
        key,
        caseId: row.id,
        payer,
        facility: assessment.facility,
        locationLabel: assessment.facility.name,
        state: assessment.state,
        status: assessment.status,
        label: assessment.label,
        reasons: assessment.reasons,
        confirmedEffectiveDate: assessment.confirmedEffectiveDate,
        expectedEffectiveDate: assessment.expectedEffectiveDate,
        assessment,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      a.payer.name.localeCompare(b.payer.name) ||
      (a.facility?.name ?? "").localeCompare(b.facility?.name ?? "") ||
      a.key.localeCompare(b.key),
  );
}

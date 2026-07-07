// Domain types for Minted Panel. App code uses camelCase; database rows are
// converted to/from snake_case by src/lib/case.ts at the service boundary.

export type AppRole = "specialist" | "billing" | "admin";
export type StatusTrack = "credentialing" | "contracting" | "location";
export type TouchType = "call" | "email" | "portal" | "fax" | "mail";
// Channel-aware outcome codes (Story 3). Labels + per-channel grouping live in
// src/lib/touchOutcomes.ts; this union is the closed set the DB check allows.
export type TouchOutcome =
  // legacy (kept so pre-taxonomy rows stay valid)
  | "reached"
  | "left_voicemail"
  | "no_answer"
  | "response_received"
  | "submitted"
  | "no_response"
  | "form_filled"
  // email
  | "sent"
  | "reply_received"
  | "info_requested"
  | "approved"
  | "denied"
  | "no_response_yet"
  // portal
  | "draft_saved"
  | "under_review"
  | "submission_error"
  // phone
  | "spoke_with_rep"
  | "callback_scheduled"
  | "got_reference_number"
  | "directed_to_portal_or_email"
  // fax
  | "confirmed_received"
  | "failed"
  | "no_confirmation"
  // mail
  | "delivered"
  | "returned";
// Touchlog discriminator (Story 1): one append-only table, four entry kinds.
export type TouchEntryType = "touchpoint" | "note" | "system_event" | "task_update";
export type ProviderStatus = "onboarding" | "active" | "terminated";
export type TaskStatus = "not_started" | "in_progress" | "completed" | "blocked";
export type NoteEntityType = "case" | "task" | "provider";
export type AuditActionType =
  "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE" | "TOUCH_LOGGED" | "TERMINATION" | "READ";
export type MsoRouteType = "direct" | "mso";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
}

export interface ProviderGroup {
  id: string;
  orgId: string;
  name: string;
  tin: string | null;
  npiType2: string | null;
  states: string[] | null;
  isActive: boolean;
  createdAt: string;
}

export type LaunchStatus =
  | "prospect"
  | "interviewing"
  | "planned"
  | "pending_fulfillment"
  | "ready_for_launch"
  | "live"
  | "cancelled";

export interface Launch {
  id: string;
  orgId: string;
  groupId: string;
  name: string;
  gymName: string | null;
  address: string | null;
  city: string | null;
  state: string;
  status: LaunchStatus;
  targetMonth: string | null;
  confirmedStartDate: string | null;
  clinicDirectorProviderId: string | null;
  clinicDirectorName: string | null;
  facilityId: string | null;
  createdAt: string;
}

export interface Facility {
  id: string;
  orgId: string;
  groupId: string | null;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  isActive: boolean;
  /** location-track status_configs id; a launch is a location in a pre-Live status */
  statusId: string | null;
  /** target/start date; label switches by status (Target pre-fulfillment, Starts after) */
  effectiveDate: string | null;
  /** migrated/onboard-existing location: reference data, skipped by the action engine + Home queues (Epic 2e) */
  referenceOnly: boolean;
  createdAt: string;
}

export interface FacilityAssignment {
  id: string;
  orgId: string;
  providerId: string | null;
  facilityId: string | null;
  isPrimary: boolean | null;
  createdAt: string;
}

export interface Provider {
  id: string;
  orgId: string;
  groupId: string | null;
  launchId: string | null;
  firstName: string;
  lastName: string;
  credentials: string | null;
  dateOfBirth: string | null;
  ssnLast4: string | null;
  email: string | null;
  phone: string | null;
  homeStreet: string | null;
  homeCity: string | null;
  homeState: string | null;
  homeZip: string | null;
  npi: string | null;
  caqhId: string | null;
  caqhLastAttestedDate: string | null;
  deaNumber: string | null;
  taxonomyCode: string | null;
  specialty: string | null;
  startDate: string | null;
  status: ProviderStatus;
  isNewGrad: boolean | null;
  terminatedDate: string | null;
  degree: string | null;
  schoolName: string | null;
  graduationDate: string | null;
  malpracticeCarrier: string | null;
  malpracticePolicyNumber: string | null;
  malpracticeCoverageStart: string | null;
  malpracticeCoverageEnd: string | null;
  middleInitial: string | null;
  suffix: string | null;
  gender: string | null;
  ethnicity: string | null;
  deaExpirationDate: string | null;
  boardCertified: boolean | null;
  subSpecialty: string | null;
  languages: string[] | null;
  medicaidAttested: boolean | null;
  culturalCompetencyTraining: boolean | null;
  additionalCertifications: unknown[] | null;
  ageGroupsServed: string[] | null;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseIssueDate: string | null;
  licenseExpirationDate: string | null;
  /** migrated/onboard-existing provider: reference data, skipped by the action engine, Fix-it, and Home queues (Epic 2e) */
  referenceOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Payer {
  id: string;
  orgId: string;
  name: string;
  isActive: boolean;
  avgDecisionDays: number | null;
  provisionalBillingAllowed: boolean;
  provisionalBillingNotes: string | null;
  retroBillingAllowed: boolean;
  retroBillingWindowDays: number | null;
  caqhPullDeadlineDays: number | null;
  providerTypePath: "individual" | "organizational" | null;
  priorAuthVendor: string | null;
  payerBillingId: string | null;
  portalUrl: string | null;
  createdAt: string;
}

// Global catalog (P2): payers/sop_templates with orgId NULL are platform-managed
// global rows; an org sees a global payer only via a row in this join table.
// `starter` flags the org's starter-pack payers (Epic 1c / P4). RLS: member
// SELECT own-org, admin write own-org.
export interface OrgPayerAssignment {
  id: string;
  orgId: string;
  payerId: string;
  starter: boolean;
  createdAt: string;
}

export interface Mso {
  id: string;
  orgId: string;
  name: string;
  portalUrl: string | null;
  createdAt: string;
}

export interface MsoRoutingRule {
  id: string;
  orgId: string;
  payerId: string | null;
  state: string;
  specialty: string;
  routeType: MsoRouteType;
  msoId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface StatusConfig {
  id: string;
  orgId: string;
  track: StatusTrack;
  label: string;
  color: string;
  sortOrder: number;
  requiredFields: string[];
  /** ours | waiting_payer | waiting_provider | complete — drives the M2 action engine */
  actionBucket: string;
  createdAt: string;
}

export interface CredentialCase {
  id: string;
  orgId: string;
  providerId: string;
  groupId: string | null;
  facilityId: string | null;
  payerId: string;
  state: string;
  specialty: string | null;
  credentialingStatusId: string | null;
  msoId: string | null;
  submittedDate: string | null;
  approvedDate: string | null;
  expectedEffectiveDate: string | null;
  confirmedEffectiveDate: string | null;
  terminationDate: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  caseEmailToken: string;
  // Story 2: latest payer reference / submission ID, latest-wins. History lives
  // in the touchlog as system_event entries, not here.
  payerReferenceId: string | null;
}

export interface Contract {
  id: string;
  orgId: string;
  groupId: string | null;
  payerId: string | null;
  state: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  notes: string | null;
  contractingStatusId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Touch {
  id: string;
  orgId: string;
  caseId: string;
  touchDate: string;
  entryType: TouchEntryType;
  // Null for note / system_event / task_update entries — they carry their text
  // in `notes` and have no channel or outcome.
  touchType: TouchType | null;
  outcome: TouchOutcome | null;
  nextFollowUpDate: string | null;
  notes: string | null;
  coordinatorId: string | null;
  taskId: string | null;
  communicationEventId: string | null;
  source: "manual" | "email" | "extension";
  createdAt: string;
  // Story 8: present only on batch-call children (communicationEventId set),
  // resolved by getCase for the "Part of {payer} {channel} call, N cases" line.
  batchSummary?: { payerName: string; channelLabel: string; caseCount: number } | null;
}

export interface SOPStepDataField {
  label: string;
  value: string;
}

/** How a step is carried out. Absent = "online_form" (backward compat). */
export type SOPStepType = "draft_email" | "online_form" | "pdf";

/** A draft-email step body; carries {{token}} placeholders from the closed catalog. */
export interface SOPEmailTemplate {
  subject: string;
  body: string;
}

export interface SOPStep {
  id: string;
  order: number;
  label: string;
  detail?: string;
  stepType?: SOPStepType;
  emailTemplate?: SOPEmailTemplate;
  isCompleted: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  dataFields?: SOPStepDataField[];
}

export interface Task {
  id: string;
  orgId: string;
  caseId: string | null;
  providerId: string | null;
  title: string;
  description: string | null;
  sopContent: SOPStep[];
  status: TaskStatus;
  sortOrder: number;
  dueDate: string | null;
  completedDate: string | null;
  isAutoGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  orgId: string;
  entityType: NoteEntityType;
  entityId: string;
  content: string;
  authorId: string | null;
  authorName?: string | null;
  createdAt: string;
}

export interface StatusHistoryEntry {
  id: string;
  orgId: string;
  caseId: string | null;
  contractId: string | null;
  track: StatusTrack;
  fromStatusId: string | null;
  toStatusId: string | null;
  metadata: Record<string, unknown> | null;
  changedBy: string | null;
  changedByName?: string | null;
  changedAt: string;

  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  orgId: string;
  ts: string;
  userId: string | null;
  userName: string | null;
  actionType: AuditActionType;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  description: string | null;
  createdAt: string;
}

export interface SOPTaskDefinition {
  title: string;
  description?: string;
  sortOrder?: number;
  dueOffsetDays?: number;
  steps: {
    label: string;
    detail?: string;
    stepType?: SOPStepType;
    emailTemplate?: SOPEmailTemplate;
    dataFields?: { label: string; token: string }[];
  }[];
}

export interface SOPTemplate {
  id: string;
  orgId: string;
  name: string;
  groupId: string | null;
  state: string | null;
  specialty: string | null;
  payerId: string | null;
  taskDefinitions: SOPTaskDefinition[];
  isArchived: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaseDetail extends CredentialCase {
  provider: Provider | null;
  payer: Payer | null;
  mso: Mso | null;
  group: ProviderGroup | null;
  facility: Facility | null;
  credentialingStatus: StatusConfig | null;
  tasks: Task[];
  touches: Touch[];
  notes: Note[];
  statusHistory: StatusHistoryEntry[];
}

export type PortalFieldMapSource = "token" | "manual" | "manual_partial" | "hardcoded";
export type PortalFieldMapStatus = "proposed" | "approved" | "retired";
export type FillMode = "web" | "pdf";

export interface PortalFieldMap {
  id: string;
  // null = shared global catalog row (portal truths); non-null = org override.
  orgId: string | null;
  portalKey: string;
  urlPattern: string | null;
  pageStep: string | null;
  mapType: FillMode;
  selector: string;
  selectorFallbacks: string[] | null;
  source: PortalFieldMapSource;
  token: string | null;
  hardcodedValue: string | null;
  transform: string | null;
  fieldType: "text" | "select" | "radio" | "checkbox" | "date" | "file";
  notes: string | null;
  status: PortalFieldMapStatus;
  // Cleanup surfaces (2026-07-06): captured per proposed row for training.
  fieldLabel: string | null;
  formSection: string | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FillSession {
  id: string;
  orgId: string;
  caseId: string;
  providerId: string | null;
  portalKey: string;
  fillMode: FillMode;
  startedAt: string;
  completedAt: string | null;
  fieldsFilled: number;
  fieldsSkipped: unknown;
  docsAttached: unknown;
  performedBy: string | null;
}

// Cleanup surfaces (2026-07-06): the portals registry (Surface 3) and the
// org-scoped label -> token dictionary that Mapping review (Surface 2) learns
// and the Fix-it queue (Surface 1) confirms.
export interface Portal {
  id: string;
  orgId: string;
  portalKey: string;
  name: string;
  payerId: string | null;
  formUrl: string | null;
  isVerified: boolean;
  lastVerifiedAt: string | null;
  urlChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FieldDictionaryStatus = "suggested" | "confirmed" | "rejected";

export interface FieldDictionaryEntry {
  id: string;
  orgId: string;
  labelNormalized: string;
  token: string;
  status: FieldDictionaryStatus;
  seenCount: number;
  decidedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

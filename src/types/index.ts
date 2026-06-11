// Domain types for OpenPanel. App code uses camelCase; database rows are
// converted to/from snake_case by src/lib/case.ts at the service boundary.

export type AppRole = 'specialist' | 'billing' | 'admin';
export type StatusTrack = 'credentialing' | 'contracting';
export type TouchType = 'call' | 'email' | 'portal' | 'fax';
export type TouchOutcome =
  | 'reached'
  | 'left_voicemail'
  | 'no_answer'
  | 'response_received'
  | 'submitted'
  | 'no_response';
export type ProviderStatus = 'onboarding' | 'active' | 'terminated';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';
export type NoteEntityType = 'case' | 'task' | 'provider';
export type AuditActionType =
  | 'CREATE'
  | 'UPDATE'
  | 'STATUS_CHANGE'
  | 'TOUCH_LOGGED'
  | 'TERMINATION';
export type MsoRouteType = 'direct' | 'mso';

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
  createdAt: string;
}

export interface Provider {
  id: string;
  orgId: string;
  groupId: string | null;
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
  providerTypePath: 'individual' | 'organizational' | null;
  priorAuthVendor: string | null;
  payerBillingId: string | null;
  portalUrl: string | null;
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
  touchType: TouchType;
  outcome: TouchOutcome;
  nextFollowUpDate: string | null;
  notes: string | null;
  coordinatorId: string | null;
  source: 'manual' | 'email_webhook';
  createdAt: string;
}

export interface SOPStep {
  id: string;
  order: number;
  label: string;
  detail?: string;
  isCompleted: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
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
  steps: { label: string; detail?: string }[];
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

// Domain types for Minted Panel. App code uses camelCase; database rows are
// converted to/from snake_case by src/lib/case.ts at the service boundary.
import type { FacilityHours } from "@/lib/facilityHours";
import type { PayerPipelineState } from "@/lib/payerPipeline";
import type { CaseStatus } from "@/lib/caseStatus";
import type { ExecutionType } from "@/lib/executionTypes";
import type { ReleaseScopeRecord } from "@/lib/releaseScope";
import type { SopResolutionTier } from "@/lib/pickTemplate";

export type AppRole = "specialist" | "billing" | "admin";
export type StatusTrack = "credentialing" | "contracting" | "location";
// The seven fixed E4.1 touch types (F4.1.1) plus legacy `mail` (kept so
// pre-E4.1 rows render unchanged — no backfill). Labels, icons, and the
// payer-facing vs internal reporting direction live in src/lib/touchTypes.ts;
// this union is the closed set the DB touches_touch_type_check allows.
export type TouchType =
  | "call"
  | "email"
  | "portal"
  | "fax"
  | "mail"
  | "caqh_update"
  | "provider_outreach"
  | "internal_sync";
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
  | "returned"
  // E4.1 disposition (F4.1.4): an optional, high-level outcome shared across
  // every touch type, mapped onto this same `outcome` field. Never synthesized
  // — the DB check allows NULL so a typed touch may omit it. `no_response` is
  // reused from the legacy set. Labels live in src/lib/touchDispositions.ts.
  | "successful"
  | "attempted"
  | "error"
  | "other";
// Touchlog discriminator (Story 1): one append-only table, four entry kinds.
export type TouchEntryType = "touchpoint" | "note" | "system_event" | "task_update";
export type ProviderStatus = "onboarding" | "active" | "terminated";
// E3.1 — the bulk-import staging fence (distinct from ProviderStatus, which
// drives the action engine, and from referenceOnly, which keeps its existing
// action-engine meaning).
export type ProviderVerificationState = "verified" | "pending_verification";
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

// Internal-only organization lifecycle (redesign E0.0, migration
// 20260708120000). Read-only in the app; drives the Portfolio buckets only and
// is NEVER rendered to the Credentialing Manager as a status label (F0.0.2).
export type LifecycleState = "prospect" | "active" | "inactive";

// Cross-org Portfolio projection (redesign E0.0, enabler TE-2): the caller's
// member orgs with their internal lifecycle_state. Bucketed into the two
// business metrics the Portfolio surfaces ("Prospects" / "In motion") by the
// pure src/lib/portfolio.ts. `createdAt` (E0.4 TE-1) lets the landing resolver
// pick the most recently created org when there is no valid last-active one.
export interface PortfolioOrg {
  id: string;
  name: string;
  lifecycleState: LifecycleState;
  createdAt: string;
}

// Party model (redesign Stage 0, canonical E0.3 §5). One reusable record per
// stakeholder; roles are scoped assignment rows, never fields on the org.
export type PartyType = "person" | "organization";
export type PartyRoleKey =
  | "owner"
  | "customer_escalation_contact"
  | "sales_rep"
  | "billing_contact"
  | "contracting_signer"
  | "credentialing_contact";

export interface Party {
  id: string;
  partyType: PartyType;
  name: string;
  email: string | null;
  phoneOffice: string | null;
  phoneMobile: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  createdBy: string;
  createdAt: string;
}

// An org-scoped role assignment resolved to its party (E0.2 contacts display).
export interface OrgContact {
  roleKey: PartyRoleKey;
  party: Party;
}

// Governed role reference row (E0.3 F0.3.5), from party_role_types.
export interface PartyRoleType {
  roleKey: PartyRoleKey;
  label: string;
  isActive: boolean;
}

// A party with the set of roles it holds in the active org (E0.3 manage-parties).
export interface OrgParty {
  party: Party;
  roleKeys: PartyRoleKey[];
}

// Secure one-time data capture link (redesign E0.5). Operators read the state;
// the raw token is never stored (only its hash) and never surfaced except once,
// in IssuedCaptureLink at issue time.
export type CaptureLinkState = "active" | "used" | "expired" | "revoked";
export interface CaptureLink {
  id: string;
  orgId: string;
  partyId: string;
  recipientEmail: string;
  state: CaptureLinkState;
  expiresAt: string;
  usedAt: string | null;
  createdBy: string;
  createdAt: string;
}

// The one-time result of issuing a link: the raw token (for URL assembly) plus
// the inputs the copy-able email template needs (E0.5 BD-2 / TE-2 / TE-5).
export interface IssuedCaptureLink {
  token: string;
  partyId: string;
  recipientEmail: string;
  recipientName: string;
  orgName: string;
  expiresAt: string;
}

// What the public /capture/:token route learns from validate_capture_token —
// only the single authorized party/org, never any other org's data (E0.5 TD-1).
export type CaptureTokenState = CaptureLinkState | "invalid";
export interface CaptureTokenView {
  state: CaptureTokenState;
  orgName?: string;
  recipientName?: string;
  recipientEmail?: string;
  expiresAt?: string;
  current?: ContactInput;
}

// E4.4 Sensitive Identifiers Vault. The full SSN lives ONLY in the server-only
// provider_ssn_vault (encrypted at rest, no client SELECT grant); these types
// never carry the plaintext except the one-time reveal/release results below,
// which are held in memory for a brief window and never cached.

// Secure SSN intake link (E0.5 capture-link pattern). Operators read the state;
// the raw token is never stored (only its hash) and never surfaced except once,
// in IssuedSsnIntakeLink at issue time.
export type SsnIntakeLinkState = "active" | "used" | "expired" | "revoked";
export interface SsnIntakeLink {
  id: string;
  orgId: string;
  providerId: string;
  recipientEmail: string;
  state: SsnIntakeLinkState;
  expiresAt: string;
  usedAt: string | null;
  createdBy: string;
  createdAt: string;
}

// The one-time result of issuing an intake link: the raw token (for URL
// assembly) plus the inputs the copy-able email/instructions need.
export interface IssuedSsnIntakeLink {
  token: string;
  providerId: string;
  providerName: string;
  recipientEmail: string;
  recipientName: string;
  orgName: string;
  expiresAt: string;
}

// What the public /ssn-intake/:token route learns from validate_ssn_intake_token
// — only the single authorized provider/org, never the SSN (write-only ingress).
export type SsnIntakeTokenState = SsnIntakeLinkState | "invalid";
export interface SsnIntakeTokenView {
  state: SsnIntakeTokenState;
  orgName?: string;
  providerName?: string;
  recipientEmail?: string;
  expiresAt?: string;
}

// store_ssn / submit_ssn_intake echo ONLY the mask — never the value.
export interface SsnStoreResult {
  ok: boolean;
  ssnLast4: string;
  mask: string;
}

// reveal_ssn returns the plaintext exactly once for a brief auto-rehide window.
// Never persisted, never cached, never logged.
export interface SsnRevealResult {
  ssn: string;
  ssnLast4: string;
}

// Inbound "contact us" lead (redesign E0.5 / F0.5.5). NOT an org until a P1
// converts it — triaged in a shared internal queue.
export type InboundLeadStatus = "new" | "converted" | "dismissed";
export interface InboundLead {
  id: string;
  orgName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  status: InboundLeadStatus;
  convertedOrgId: string | null;
  createdAt: string;
}

// Public contact-form input (E0.5 F0.5.5). `companyWebsite` is the honeypot —
// hidden from humans; a filled value marks the submission as spam server-side.
export interface InboundLeadInput {
  orgName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  companyWebsite?: string;
}

// Secure read-only portfolio share (redesign E0.6). Outbound + read-only —
// distinct from E0.5's inbound single-use capture link. 30-day revocable.
export type ReportShareScope = "full" | "single_org";
export type ReportShareState = "active" | "revoked" | "expired";
export interface ReportShare {
  id: string;
  reportKey: string;
  scope: ReportShareScope;
  scopeOrgId: string | null;
  recipientEmail: string;
  state: ReportShareState;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
}

// The one-time result of creating a share: the raw token (URL assembly) + inputs.
export interface IssuedReportShare {
  token: string;
  shareId: string;
  recipientEmail: string;
  scope: ReportShareScope;
  expiresAt: string;
}

// What the public /share/:token route learns from validate_report_share — ONLY
// the in-scope orgs (the scope filter is enforced server-side). `orgs` already
// filtered; the client never trusts its own filter (TE-6).
export type ReportShareViewState = ReportShareState | "invalid";
export interface ReportShareView {
  state: ReportShareViewState;
  reportKey?: string;
  scope?: ReportShareScope;
  orgs?: PortfolioOrg[];
}

// Create/edit input for a CRM contact (E0.2). Split address, never one string.
export interface ContactInput {
  name: string;
  email: string;
  phoneOffice: string;
  phoneMobile?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
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
  // Purpose-keyed address + contact blocks (E1.1 TE-4, additive — columns
  // existed in the baseline schema; typed for the wizard form + summaries).
  billingStreet?: string | null;
  billingSuite?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
  billingContactName?: string | null;
  billingPhone?: string | null;
  billingFax?: string | null;
  billingEmail?: string | null;
  correspondenceStreet?: string | null;
  correspondenceSuite?: string | null;
  correspondenceCity?: string | null;
  correspondenceState?: string | null;
  correspondenceZip?: string | null;
  correspondenceContactName?: string | null;
  correspondencePhone?: string | null;
  correspondenceFax?: string | null;
  correspondenceEmail?: string | null;
  credentialingStreet?: string | null;
  credentialingSuite?: string | null;
  credentialingCity?: string | null;
  credentialingState?: string | null;
  credentialingZip?: string | null;
  credentialingContactName?: string | null;
  credentialingPhone?: string | null;
  credentialingFax?: string | null;
  credentialingEmail?: string | null;
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

// ADA accessibility capture (E1.2 — the facilities.ada_compliance jsonb).
// Deliberately minimal in v1: an accessible flag + free-text notes.
export interface AdaCompliance {
  accessible?: boolean;
  notes?: string;
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
  // CAQH practice-location fields (E1.2 TE-2, additive — columns existed in
  // the baseline schema; typed for the wizard form + summaries). `hours` is
  // the locked per-day jsonb owned by src/lib/facilityHours.ts.
  suite?: string | null;
  county?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  appointmentPhone?: string | null;
  contactName?: string | null;
  acceptingNewPatients?: boolean | null;
  languagesOffered?: string[] | null;
  interpreterLanguages?: string[] | null;
  hours?: FacilityHours | null;
  adaCompliance?: AdaCompliance | null;
}

// M:N provider↔group assignment (E1.3). A provider always holds ≥1 row with
// exactly one is_primary; providers.group_id mirrors the primary (frozen
// legacy column — no new readers).
export interface ProviderGroupAssignment {
  id: string;
  orgId: string;
  providerId: string;
  groupId: string;
  isPrimary: boolean;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

export interface FacilityAssignment {
  id: string;
  orgId: string;
  providerId: string | null;
  facilityId: string | null;
  isPrimary: boolean | null;
  createdAt: string;
  /** Date the provider began practicing at the location (E1.4, additive —
   * baseline column; required on new assignments via the E1.4 editor). */
  startDate?: string | null;
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
  /** E3.1 staging fence: 'pending_verification' rows are excluded from E1.8
   * readiness and E2.0 generation candidacy until explicitly verified */
  verificationState: ProviderVerificationState;
  /** E4.2 F4.2.7 — the org's designated dry-run test provider. Excluded from
   * queue/generation/scorecard by the shared testProvider predicate. */
  isTestProvider?: boolean;
  createdAt: string;
  updatedAt: string;
}

// E1.6 catalog identity vocabulary. Government kinds + prerequisite links are
// dormant schema until R10; the R2 directory filters to commercial by default.
export type PayerKind =
  "commercial" | "medicare" | "medicaid" | "medicaid_mco" | "medicare_advantage" | "tricare";
export type PayerCatalogStatus = "active" | "merged" | "retired";

export interface Payer {
  id: string;
  // E4.2 governance type correction (additive-honest): org_id has been NULLABLE
  // since P2 (20260707060000) — NULL = a Minted-managed global-catalog row an
  // org can read (when assigned) but never create, rename, or update.
  orgId: string | null;
  name: string;
  isActive: boolean;
  avgDecisionDays: number | null;
  createdAt: string;
  // E1.6 catalog identity columns (additive; optional so pre-E1.6 fixtures
  // stay valid). payerSlug is the canonical dataset key — the identity and
  // sync dedupe key per the final [e1.6] shape (clearinghouse IDs dropped).
  payerKind?: PayerKind;
  payerSlug?: string | null;
  aliases?: string[] | null;
  states?: string[] | null;
  status?: PayerCatalogStatus;
  mergedIntoId?: string | null;
  lastSyncedAt?: string | null;
  // E4.2 F4.2.1 — resolution-identifier config. Since the E4.2 governance PR
  // these columns are the MINTED-CURATED GLOBAL fallback tier only (org users
  // cannot write them); the org-varying override lives in org_payer_settings
  // (OrgPayerSetting below). Both are read through the E4.0
  // payerResolutionIdentifier seam: org setting → these → generic default.
  resolutionIdLabel?: string | null;
  resolutionIdExpected?: boolean | null;
  // E6.5 F6.5.5 — delegation as a curated catalog fact ("this payer delegates
  // credentialing to X — submit via Y"). Platform-written ONLY (no app writer;
  // payers has had no org write path since 20260718120000). Rendered in the
  // catalog browser; workflow detail belongs in SOP content, not routing rules.
  delegationNote?: string | null;
}

// E4.2 payer governance — the org × payer configuration grain. Global payer
// facts stay Minted-curated on `payers`; anything an ORGANIZATION legitimately
// configures about a payer lives here. Starts with the one setting that has a
// confirmed consumer (the E4.0 approval step's resolution-identifier label /
// expectedness); nothing else moves here without a product-approved consumer.
export interface OrgPayerSetting {
  id: string;
  orgId: string;
  payerId: string;
  resolutionIdLabel: string | null;
  resolutionIdExpected: boolean | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// E1.6 F1.6.3 — append-only catalog diff log row. The diff facts are
// immutable; only the review fields change, and only via the review RPC.
export interface PayerCatalogChange {
  id: string;
  payerId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: "sync" | "manual";
  reviewState: "unreviewed" | "accepted" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// Global catalog (P2): payers/sop_templates with orgId NULL are platform-managed
// global rows; an org sees a global payer only via a row in this join table.
// `starter` flags the org's starter-pack payers (Epic 1c / P4). RLS: member
// SELECT own-org, admin write own-org.
// E4.2 hardening — the subscription is reversible & history-safe. `status`
// defaults to `active`; archived rows keep their history (removal never DELETEs)
// and reactivation is a status flip that never recreates payer_network_targets
// scope. `status`/`archivedAt` are optional so pre-hardening fixtures/rows stay
// valid — treat a missing status as `active` (see isActiveAssignment).
export type OrgPayerAssignmentStatus = "active" | "archived";

export interface OrgPayerAssignment {
  id: string;
  orgId: string;
  payerId: string;
  starter: boolean;
  status?: OrgPayerAssignmentStatus;
  archivedAt?: string | null;
  createdAt: string;
}

// E1.5 — the group × payer × state attachment grain under the org-level
// intent (distinct from OrgPayerAssignment, the curated subscription layer).
// Attach = intend to pursue; archive is the removal semantic (history kept,
// deny → reapply cycle); real status lives on contracts/cases. E2.x case
// generation reads status === "active" rows.
export interface PayerNetworkTarget {
  id: string;
  orgId: string;
  payerId: string;
  groupId: string;
  state: string;
  status: "active" | "archived";
  createdAt: string;
}

// E6.2 F6.2.5 — enrollment facts: "already enrolled with this payer UNDER THIS
// GROUP'S CONTRACT", recorded at the case key's grain. Facts count a payer row
// toward Active on the group board, suppress generation candidates (E6.3 math)
// and NEVER create cases. Expiry is a flip (expiredAt/expiredBy), never a
// delete — an expired fact is history and the combination re-opens as a
// candidate immediately.
export type EnrollmentFactSource = "migration";

export interface EnrollmentFact {
  id: string;
  orgId: string;
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  effectiveDate: string | null;
  source: EnrollmentFactSource;
  expiredAt: string | null;
  expiredBy: string | null;
  createdBy: string | null;
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
  // Story 2 / E4.0 TE-3: latest payer reference / submission ID (the case's
  // tracking ID), latest-wins. History lives in the touchlog + audit_log, not here.
  payerReferenceId: string | null;
  // E4.0 TE-1: the EXTERNAL payer-pipeline state, parallel to and independent of
  // credentialingStatusId (the internal machine). Defaults to 'not_started'.
  // Since E6.0 this is a transition-shim MIRROR of caseStatus (kept in
  // lockstep by set_case_status + the auto triggers) — no longer a
  // user-facing machine of its own.
  payerPipelineState: PayerPipelineState;
  // E6.0 F6.0.1 — THE canonical unified case status (the fixed eight-value
  // list in src/lib/caseStatus.ts). The single user-facing status; the two
  // legacy fields above survive as read-only mirrors until their readers
  // retire (E6.1–E6.4).
  caseStatus: CaseStatus;
  // E6.0 F6.0.1 — contract execution date as a plain case field (set at
  // Approved; the contracting status machine is retired as user-facing).
  contractExecutedDate: string | null;
  // E4.0 TE-6 (ChatPRD round-3): two structured payer-issued enrollment
  // identifiers captured at Approved, never concatenated — Type 1 NPI-linked
  // Individual (rendered under the payer's configured label — E4.2 — else
  // "Payer-issued ID") and Type 2/Tax-ID-linked Group/Billing. Either/both/neither.
  payerIndividualProviderId: string | null;
  payerGroupProviderId: string | null;
  // E2.1: the generation run that created this case; null = manual one-off or
  // pre-E2.1 row (the "run-less" trail). Optional — narrow projections predate it.
  generationRunId?: string | null;
}

// E2.1 TE-2 — one row per confirmed generation batch (who/when/counts).
// Immutable by omission (no UPDATE/DELETE policy or grant); the stored counts
// are the confirm-time plan, superseded at read time by E2.4's disposition
// child rows once those land.
export interface CaseGenerationRun {
  id: string;
  orgId: string;
  createdBy: string | null;
  createdAt: string;
  proposedCount: number;
  createdCount: number;
  skippedExistingCount: number;
  excludedCount: number;
  failedCount: number;
  /** E4.2 F4.2.4 / TE-14 — the release scope this run used (all/none/subset).
   * NULL for pre-E4.2 runs and full releases. */
  releaseScope?: ReleaseScopeRecord | null;
}

// E2.4 TE-1 — one immutable disposition row per candidate 4-part key per run,
// written once when the outcome is known (INSERT-only: no UPDATE/DELETE policy
// or grant). `reason` is the confirm-time snapshot; `caseId` links created AND
// skipped_existing rows (the blocking case); `exclusionId` links excluded rows
// (SET NULL belt-and-braces — the reason snapshot survives a dangling link).
// E6.3 adds 'skipped' (skip-for-now — stays in the buffer, no reason demanded
// of the user) and 'enrolled' (covered by a live enrollment fact) so the run
// ledger accounts for EVERY candidate (migration 20260719160000).
export type GenerationRowDisposition =
  "created" | "skipped_existing" | "excluded" | "failed" | "skipped" | "enrolled";

export interface CaseGenerationRunRow {
  id: string;
  orgId: string;
  runId: string;
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  disposition: GenerationRowDisposition;
  reason: string | null;
  caseId: string | null;
  exclusionId: string | null;
  /** E4.2 SOP hardening — the resolution provenance for a `created` row: which
   * SOP resolved (id + version) at which deterministic tier. A confirm-time
   * snapshot (immutable ledger, like `reason`), so generic-fallback usage is
   * countable per run/payer/state/group. NULL for skipped/excluded/failed rows. */
  sopTemplateId: string | null;
  sopVersion: number | null;
  sopResolutionTier: SopResolutionTier | null;
  createdAt: string;
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
  // E4.1 follow-up cadence (F4.1.2): a touch with no next_follow_up_date
  // carries the prior active follow-up forward; clearing is only ever this
  // explicit flag, never a null date. Default false.
  clearsFollowUp: boolean;
  // E4.1 recipient capture (F4.1.5): optional but prominent — who was contacted
  // and how (name + free-form contact). Rendered on the log row, filterable.
  recipientName: string | null;
  recipientContact: string | null;
  // E4.1 corrections (Edge Cases): corrections are appends — this points at the
  // touch being corrected. The original is never mutated; the log renders the
  // pair ("corrected by …"). Null on a normal touch.
  correctsTouchId: string | null;
  // Story 8: present only on batch-call children (communicationEventId set),
  // resolved by getCase for the "Part of {payer} {channel} call, N cases" line.
  batchSummary?: { payerName: string; channelLabel: string; caseCount: number } | null;
}

export interface SOPStepDataField {
  label: string;
  value: string;
}

/**
 * How a step is carried out. Absent = "online_form" (backward compat).
 * `fax | phone | mail` added by E1.7b (authorized in its §5 TE-6) so the real
 * business SOPs are representable; they render as plain steps (no portal or
 * email affordances).
 */
export type SOPStepType = "draft_email" | "online_form" | "pdf" | "fax" | "phone" | "mail";

/**
 * E1.7b F1.7b.5 (TE-13) — an AUTHORED draft-email recipient. A recipient is
 * explicitly EITHER a fixed literal email address OR a closed email-valued token
 * key (currently only `provider.email`; see `emailValuedTokenKeys`). It is never
 * inferred by parsing free text, and there is no BCC and no send variant.
 */
export type SOPEmailRecipient =
  { source: "literal"; address: string } | { source: "token"; token: string };

/**
 * E1.7b F1.7b.5 (TE-14) — a RESOLVED draft-email recipient. A literal address
 * carries through verbatim; a token recipient keeps its `token` provenance
 * ALONGSIDE the resolved `address` (null when the token resolved empty — an
 * explicit fill-before-send gap, never collapsed to a literal and never
 * silently dropped).
 */
export type ResolvedSOPEmailRecipient =
  | { source: "literal"; address: string }
  | { source: "token"; token: string; address: string | null };

/**
 * A draft-email step body; carries {{token}} placeholders from the closed
 * catalog. This is the AUTHORED shape (stored in the versioned task_definitions
 * jsonb). `to`/`cc` (E1.7b F1.7b.5, TE-13) version with the SOP content and are
 * optional at the type level — legacy versions carry neither; the publish lint
 * (TE-16), not TypeScript, enforces ≥1 To on new publishes. BCC and auto-send
 * are out of scope.
 */
export interface SOPEmailTemplate {
  subject: string;
  body: string;
  to?: SOPEmailRecipient[];
  cc?: SOPEmailRecipient[];
}

/**
 * E1.7b F1.7b.5 (TE-14) — the RESOLVED draft-email body carried on a resolved
 * `SOPStep` (in `tasks.sop_content`). Subject/body are interpolated; recipients
 * keep their source (this is the read-only task contract future consumers see,
 * TE-20). Mirrors the authored→resolved split `dataFields` already has
 * (`{ label, token }` authored → `{ label, value }` resolved), so subject/
 * body-only callers are unaffected.
 */
export interface ResolvedSOPEmailTemplate {
  subject: string;
  body: string;
  to?: ResolvedSOPEmailRecipient[];
  cc?: ResolvedSOPEmailRecipient[];
}

export interface SOPStep {
  id: string;
  order: number;
  label: string;
  detail?: string;
  stepType?: SOPStepType;
  // Resolved shape (TE-14): subject/body interpolated, recipients source-tagged
  // with their resolved address. The authored SOPEmailTemplate is the input on
  // SOPTaskDefinition.steps[]; the resolver bridges the two.
  emailTemplate?: ResolvedSOPEmailTemplate;
  isCompleted: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  dataFields?: SOPStepDataField[];
  /**
   * Links an `online_form` step to a `portals`-registry row by `portal_key`
   * (bare/normalized). Absent on every pre-existing step. The Chrome extension
   * matches the page's `portal_key` against a case's tasks to close the right
   * SOP task on submit. Not interpolated — carried through verbatim.
   */
  portalKey?: string;
  /** E1.7b: how long the payer typically takes after this step ("~45 days"). */
  expectedTurnaroundDays?: number;
  /** E1.7b: follow-up cadence after this step ("call every 14 days"). */
  followUpEveryDays?: number;
  /**
   * E1.7b: named artifacts to produce/attach for this step (e.g. "Submission
   * confirmation PDF"). Token-less by design — a `dataFields` entry requires a
   * resolvable token and is filtered at resolution, so attachment checklists
   * live here, never as token-less data fields.
   */
  requiredArtifacts?: string[];
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
  /**
   * E2.2 (E1.7a stamp contract): the immutable SOP version this task's
   * sop_content was resolved from. Both-or-neither (DB CHECK); legacy and
   * non-SOP tasks are NULL/NULL.
   */
  sopTemplateId: string | null;
  sopVersion: number | null;
  /** E4.2 TE-12 — execution type stamped from the SOP task definition at
   * generation. NULL ⇒ manual (the DB CHECK allows null). R6 renders + stamps
   * only; automated behaviors ride E4.3/E4.5/R7. */
  executionType?: ExecutionType | null;
  /** E4.2 SOP hardening — the deterministic resolution tier the SOP was
   * selected at (organization | global_payer | generic_fallback). Stamped so a
   * manual case stays tier-reportable without a generation run; NULL ⇒ legacy /
   * non-SOP task. */
  sopResolutionTier?: SopResolutionTier | null;
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

// E4.0 TE-2 — one append-only row per payer-pipeline transition. Never updated
// or deleted; a wrong row is annotated by a later is_correction row.
export interface PayerPipelineHistoryEntry {
  id: string;
  orgId: string;
  caseId: string;
  fromState: PayerPipelineState | null;
  toState: PayerPipelineState;
  reasonCodeId: string | null;
  isCorrection: boolean;
  justification: string | null;
  changedBy: string | null;
  /** Actor display name, resolved via profiles at read time (not a column). */
  changedByName?: string | null;
  /** Reason-code label, resolved from denial_reason_codes at read time. */
  reasonLabel?: string | null;
  changedAt: string;
}

// E6.0 — one append-only unified-status transition (case_status_history).
// actor_kind 'system' = the action was the proof (creation, first recorded
// work, extension-logged submission); 'user' = a person set what they
// learned. evidenceTouchId links the touch that evidenced the transition
// (F6.0.3); corrections append with a note, never rewrite (F6.0.4).
export interface CaseStatusHistoryEntry {
  id: string;
  orgId: string;
  caseId: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  actorKind: "system" | "user";
  reasonCodeId: string | null;
  evidenceTouchId: string | null;
  isCorrection: boolean;
  note: string | null;
  changedBy: string | null;
  /** Actor display name, resolved via profiles at read time (not a column). */
  changedByName?: string | null;
  /** Reason-code label, resolved from denial_reason_codes at read time. */
  reasonLabel?: string | null;
  changedAt: string;
}

// E4.0 TE-4 — a structured denial/return reason. orgId null = global default
// (seeded); non-null = org-added (managed in E4.2). Deactivated, never deleted.
export interface DenialReasonCode {
  id: string;
  orgId: string | null;
  code: string;
  label: string;
  active: boolean;
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
  /** E4.2 TE-12 — per-task execution type carried in the version's
   * task_definitions jsonb. Absent ⇒ manual. */
  executionType?: ExecutionType;
  steps: {
    label: string;
    detail?: string;
    stepType?: SOPStepType;
    emailTemplate?: SOPEmailTemplate;
    dataFields?: { label: string; token: string }[];
    /** Portal-registry `portal_key` for an `online_form` step (bare/normalized). */
    portalKey?: string;
    /** E1.7b step-shape extension — see SOPStep for semantics. All optional/additive. */
    expectedTurnaroundDays?: number;
    followUpEveryDays?: number;
    requiredArtifacts?: string[];
  }[];
}

export interface SOPTemplate {
  id: string;
  // null = GLOBAL catalog row (payer SOP or the generic fallback) — honest
  // since E6.5; consumers previously cast around this (pickTemplate,
  // TemplateWizard, TemplatesList).
  orgId: string | null;
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
  /**
   * E1.7b Model A head pointer. Optional (additive) — pre-versioning cached
   * rows may lack it; treat absent as 1.
   */
  currentVersion?: number;
  /** E4.2 TE-13 — governed provider-profile attribute keys this SOP requires
   * before a case generates against it. Versioned with the SOP (snapshotted
   * into each version by the publish RPC). Values are the closed
   * ProfileAttributeKey set; normalize via profileGating.normalizeRequiredAttributes. */
  requiredProfileAttributes?: string[];
}

/**
 * E1.7b — one immutable row per SOP publish (`sop_template_versions`).
 * INSERT-only via the publish RPC / creation trigger; never updated.
 */
export interface SOPTemplateVersion {
  id: string;
  templateId: string;
  version: number;
  name: string;
  taskDefinitions: SOPTaskDefinition[];
  changeNote: string | null;
  publishedAt: string;
  publishedBy: string | null;
  /** Publisher display name, resolved via `profiles` at read time (not a column). */
  publishedByName?: string | null;
  /** E4.2 TE-13 — the immutable snapshot of required profile attributes for
   * this version. */
  requiredProfileAttributes?: string[];
}

/** E4.2 F4.2.1 (PM round-4) — a save-as-draft SOP wizard work-in-progress. Never
 * resolves for generation or counts toward readiness; deleted on publish. */
export interface SopTemplateDraft {
  id: string;
  orgId: string;
  templateId: string | null;
  payload: unknown;
  updatedBy: string | null;
  updatedByName?: string | null;
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
  /** E4.0 F4.0.1 — the read-only payer-pipeline timeline (append-only), each
   * row attributed and reason/justification-resolved by getCase. */
  payerPipelineHistory: PayerPipelineHistoryEntry[];
  /** E6.0 — the unified-status timeline (case_status_history), each row
   * attributed (system/user), evidence-linked, and reason-resolved by
   * getCase. Old ledgers above are retained read-only. */
  caseStatusHistory: CaseStatusHistoryEntry[];
  /** E2.4 F2.4.2 — the creation actor's display name, resolved by getCase via
   * the same profiles fetch that names history/touch authors. */
  createdByName?: string | null;
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

/** E4.2 TE-17 — a structured per-field skip result on a fill session. Tightened
 * additively from the former `unknown`. Legacy jsonb that doesn't conform is
 * parsed leniently by fillSessions helpers. */
export interface FillSkippedField {
  selector: string;
  label: string;
  reason: "unmapped" | "empty_token";
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
  fieldsSkipped: FillSkippedField[] | null;
  docsAttached: unknown;
  performedBy: string | null;
  /** E4.2 TE-17 — dry-run test fill marker; excluded from every metric reader. */
  isTest?: boolean;
}

// Cleanup surfaces (2026-07-06): the portals registry (Surface 3) and the
// org-scoped label -> token dictionary that Mapping review (Surface 2) learns
// and the Fix-it queue (Surface 1) confirms.
export interface Portal {
  id: string;
  // null = GLOBAL registry row (E6.5) — authored once, inherited by every org.
  orgId: string | null;
  portalKey: string;
  name: string;
  payerId: string | null;
  formUrl: string | null;
  isVerified: boolean;
  lastVerifiedAt: string | null;
  // E6.5 dry-run proof stamp: set when a mock dry run fills every mapped
  // field; cleared with verification on a form-URL change.
  provenAt?: string | null;
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

// E2.0 — persistent, reasoned generation-preview exclusions at the 4-part
// case grain. Restore is a VOID (status flip), never a row delete (TE-2).
export type CaseGenerationExclusionReason =
  "already_credentialed" | "panel_closed" | "not_pursuing" | "other";

export interface CaseGenerationExclusion {
  id: string;
  orgId: string;
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  reason: CaseGenerationExclusionReason;
  note: string | null;
  status: "active" | "voided";
  createdBy: string;
  createdAt: string;
  voidedBy: string | null;
  voidedAt: string | null;
}

// E3.0 — bulk roster import staging (import_runs). The run row is the durable
// async-scan progress record; error_report is the compact (row, column,
// reason) list that survives the import_rows purge on commit/cancel. Offending
// values are never echoed into it (TE-6).
export type ImportRunSource = "internal" | "onboarding";
export type ImportRunState =
  "uploading" | "scanning" | "ready_for_review" | "committed" | "failed" | "cancelled";
// E3.3 TE-1: the additive discriminator that lets one staging machine serve the
// three per-section uploads. 'combined' is the legacy E3.0 default (in-flight
// combined runs stay reviewable, F3.3.3) — new per-section uploads write one of
// the three real kinds.
// E6.2 F6.2.4 adds 'payer_attach' — the group×payer attach CSV rides the same
// staging machine (one row per group × payer, ';'-delimited states).
export type ImportEntityKind =
  "provider_group" | "facility" | "provider" | "combined" | "payer_attach";

export interface ImportRunErrorEntry {
  line: number;
  column: string | null;
  reason: string;
}

export interface ImportRun {
  id: string;
  orgId: string;
  createdBy: string;
  source: ImportRunSource;
  /** E3.3 TE-1: which per-section upload produced this run (legacy runs = 'combined'). */
  entityKind: ImportEntityKind;
  fileName: string | null;
  state: ImportRunState;
  totalRows: number | null;
  stagedRows: number | null;
  errorRows: number | null;
  errorReport: ImportRunErrorEntry[] | null;
  // E3.1 commit outcome (written by the commit_import_run RPC): who the run
  // created/updated, so the committed view can verify + batch-assign after
  // the staged rows purge.
  committedAt: string | null;
  createdProviderIds: string[] | null;
  updatedProviderIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// E4.5 — Document storage (provider & group documents with expiration
// tracking). One interface per provider_documents row: immutable version
// metadata (TE-1) — a replacement INSERTS a new row; "current" is derived as
// the family row with no successor, never stored.
// ---------------------------------------------------------------------------

/** The two canonical owner grains (D1). `case_id` may additionally record
 * usage context but is never the canonical owner for E4.5 uploads. */
export type DocumentOwnerType = "provider" | "group";

/** The governed document-kind vocabulary — mirrors the DB
 * provider_documents_doc_type_check exactly (TE-5). Labels, owner grains, and
 * expiration rules live in ONE shared map: src/lib/documents.ts
 * DOCUMENT_KIND_META. */
export type DocumentKind =
  | "state_license"
  | "dea"
  | "coi"
  | "w9"
  | "cms_460"
  | "voided_check"
  | "cv"
  | "diploma"
  | "board_cert"
  | "filled_form"
  | "other";

/** Derived at render time from expiration_date + the shared per-kind
 * thresholds — never a stored flag (TE-6). */
export type DocumentExpirationStatus = "expired" | "expiring_soon" | "current";

export interface ProviderDocument {
  id: string;
  orgId: string;
  providerId: string | null;
  groupId: string | null;
  caseId: string | null;
  docType: DocumentKind;
  fileName: string;
  filePath: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  uploadedBy: string | null;
  createdAt: string;
  /** Stable lineage id — re-upload versions the family (TE-1). */
  documentFamilyId: string;
  versionNumber: number;
  supersedesDocumentId: string | null;
}

// Reporting Guide — the in-app help center and data dictionary for the
// Reporting Center (/reporting/guide and the per-report "About this report"
// sheet). Static, typed content only: no I/O, no clock.
//
// Report articles are keyed by the registry `key` in src/lib/reports.ts, so
// adding a report later means adding ONE entry to REPORT_ARTICLES (the test
// fails until you do). Every article, term and question carries a
// `reviewStatus`; everything starts as "draft" and flips to "confirmed" once
// the PM has validated the wording against the shipped report. Content
// describes shipped behavior only, never the planned reporting suite.
import { REPORTS, REPORT_GROUPS, type ReportDef, type ReportGroup } from "@/lib/reports";

export type GuideAudience = "internal" | "client";
export type GuideReviewStatus = "draft" | "confirmed";

const INTERNAL: readonly GuideAudience[] = ["internal"];
const EVERYONE: readonly GuideAudience[] = ["internal", "client"];

/** Map the signed-in access context's audience onto the guide's two views. */
export function guideAudienceFor(audience: string | null | undefined): GuideAudience {
  return audience === "client" ? "client" : "internal";
}

// ---------------------------------------------------------------------------
// Data dictionary
// ---------------------------------------------------------------------------

export type GuideTermCategory = "basics" | "records" | "statuses" | "labels";

export const GUIDE_TERM_CATEGORIES: readonly {
  key: GuideTermCategory;
  title: string;
  description: string;
}[] = [
  {
    key: "basics",
    title: "Credentialing & enrollment basics",
    description: "Industry terms you meet in payer letters, portals and applications.",
  },
  {
    key: "records",
    title: "Minted Panel records",
    description: "The things Minted Panel keeps track of, and how they relate.",
  },
  {
    key: "statuses",
    title: "Case statuses",
    description: "The eight statuses every credentialing case moves through.",
  },
  {
    key: "labels",
    title: "Report labels & metrics",
    description: "The numbers, flags and pills the live reports show.",
  },
];

export interface GuideTerm {
  id: string;
  term: string;
  /** Other names people use; searched alongside the term. */
  aka?: readonly string[];
  category: GuideTermCategory;
  definition: string;
  whereYouSeeIt: string;
  /** Client users never see internal screens, so a term they can read may
   * carry its own "where you see it" pointing at their report. */
  clientWhereYouSeeIt?: string;
  related: readonly string[];
  audiences: readonly GuideAudience[];
  reviewStatus: GuideReviewStatus;
}

const BASICS_TERMS: GuideTerm[] = [
  {
    id: "credentialing",
    term: "Credentialing",
    category: "basics",
    definition:
      'Checking that a provider is qualified to treat patients: licenses, education, training, board certification, work history and malpractice history. A payer or a hospital does this before it lets a provider join. Credentialing answers "is this person qualified?" Enrollment, which usually follows, answers "can this person bill us?"',
    whereYouSeeIt:
      "Minted Panel tracks each payer application as a case. The provider record holds the licenses, NPI, CAQH details and documents that credentialing relies on.",
    clientWhereYouSeeIt:
      "Enrollment Explorer shows where each provider's enrollment stands with each payer product.",
    related: ["enrollment", "psv", "caqh", "recredentialing", "case"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "enrollment",
    term: "Payer enrollment",
    aka: ["Enrollment", "Credentialing vs enrollment"],
    category: "basics",
    definition:
      "Getting a credentialed provider set up in a payer's systems so claims are paid, under a specific group, tax ID and location. A provider can be credentialed and still not enrolled. Until enrollment is effective, claims are usually denied or paid out of network.",
    whereYouSeeIt:
      "Approved cases, Enrollment Explorer and Billing Readiness all describe enrollment from different angles.",
    clientWhereYouSeeIt: "Enrollment Explorer.",
    related: ["credentialing", "effective-date", "par", "enrollment-fact", "line-of-business"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "psv",
    term: "Primary source verification (PSV)",
    aka: ["PSV"],
    category: "basics",
    definition:
      "Confirming a credential with the organization that issued it, such as the state licensing board or the certifying board, instead of trusting a copy the provider sent. Payers and accreditation bodies expect it for licenses, board certification and education.",
    whereYouSeeIt:
      "State licenses on the provider record keep their verification details. Enrollment Explorer can show a license verification as supporting proof.",
    clientWhereYouSeeIt: "Enrollment Explorer can show a license verification as supporting proof.",
    related: ["credentialing", "recredentialing"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "caqh",
    term: "CAQH and attestation",
    aka: ["CAQH ProView", "Attestation", "Re-attestation"],
    category: "basics",
    definition:
      "CAQH ProView is a national online profile where providers keep their credentialing information. Many commercial payers read it instead of asking for a new application. Providers must review and re-attest the profile every 120 days. A lapsed attestation can stall an application.",
    whereYouSeeIt:
      'The provider record stores the CAQH ID and the last attestation date. When the date is more than 120 days old, the provider shows a "CAQH attestation stale" flag.',
    clientWhereYouSeeIt:
      "Minted Panel tracks each provider's last CAQH attestation date and flags it once it is more than 120 days old.",
    related: ["credentialing", "provider"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "recredentialing",
    term: "Re-credentialing",
    category: "basics",
    definition:
      "Repeating credentialing on a fixed cycle to confirm a provider still meets the payer's standards. Most payers do it every three years. The payer usually starts it, and missing the deadline can end the provider's participation.",
    whereYouSeeIt:
      "Minted Panel does not track re-credentialing due dates as their own report today. Keep the provider's CAQH profile and licenses current so the payer's review goes smoothly.",
    related: ["credentialing", "revalidation", "caqh"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "revalidation",
    term: "Revalidation",
    category: "basics",
    definition:
      "Medicare's and Medicaid's periodic re-check of a provider's enrollment record. Medicare asks most providers to revalidate every five years. If it is missed, billing privileges can be deactivated.",
    whereYouSeeIt: "Minted Panel does not track revalidation due dates as their own report today.",
    related: ["recredentialing", "enrollment", "ptan"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "delegated-credentialing",
    term: "Delegated credentialing",
    aka: ["Delegation"],
    category: "basics",
    definition:
      "An agreement where a payer lets a group or credentialing organization do the credentialing work itself and accepts the result. Instead of an application per provider, the group usually sends the payer a roster of its providers.",
    whereYouSeeIt:
      "The Roster Engine builds payer roster files from the providers, locations and groups on file.",
    clientWhereYouSeeIt:
      "Your Minted Panel team builds payer roster files from your provider records.",
    related: ["roster", "credentialing"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "par",
    term: "Par / in network",
    aka: ["Participating", "In-network", "Non-par", "Out of network"],
    category: "basics",
    definition:
      "Participating (par) means the provider is in the payer's network for a given plan. Patients get in-network benefits and the payer pays the contracted rate. Non-par means out of network.",
    whereYouSeeIt:
      "Enrollment Explorer shows published enrollment by payer product. The Group Contracts Matrix shows whether the group's contract with each payer is in place.",
    clientWhereYouSeeIt: "Enrollment Explorer shows published enrollment by payer product.",
    related: ["enrollment", "line-of-business", "effective-date"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "effective-date",
    term: "Effective date",
    category: "basics",
    definition:
      "The date the payer starts treating the provider as enrolled. Services before it usually aren't paid at in-network rates. It is often different from the date the approval arrived.",
    whereYouSeeIt:
      "Required when a case is moved to Approved. Enrollment Explorer and Billing Readiness show it where it is recorded.",
    clientWhereYouSeeIt: "Enrollment Explorer details, when proof backs it.",
    related: ["retro", "approved", "enrollment"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "retro",
    term: "Retro (retroactive effective date)",
    aka: ["Retro", "Retroactive"],
    category: "basics",
    definition:
      "When a payer backdates the effective date so services already given are covered. Payers differ on whether they allow it and how far back.",
    whereYouSeeIt:
      "Enrollment Explorer shows retro details only where the payer's proof documents them.",
    related: ["effective-date", "enrollment"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "npi",
    term: "NPI",
    aka: ["National Provider Identifier", "Type 1 NPI", "Type 2 NPI"],
    category: "basics",
    definition:
      "The National Provider Identifier is a 10-digit number issued by CMS. Individuals get a Type 1 NPI. Organizations, such as a group practice, get a Type 2 NPI. It never changes when a provider moves.",
    whereYouSeeIt:
      'On the provider record (Type 1) and the group record (Type 2). A provider with no NPI shows a "Missing NPI" flag.',
    clientWhereYouSeeIt: "Enrollment Explorer shows each provider's NPI, and you can search by it.",
    related: ["tin", "taxonomy", "provider", "group"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "tin",
    term: "TIN",
    aka: ["Tax ID", "EIN", "Taxpayer Identification Number"],
    category: "basics",
    definition:
      "The tax ID a group bills under. Payers contract with a TIN, so a provider who bills under two groups is enrolled twice, once per TIN.",
    whereYouSeeIt: "On the group record. Each group is one billing entity with its own TIN.",
    clientWhereYouSeeIt:
      "Each group in Enrollment Explorer is one billing entity with its own TIN.",
    related: ["group", "npi", "case"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "taxonomy",
    term: "Taxonomy code",
    aka: ["Taxonomy"],
    category: "basics",
    definition:
      "A standard code that describes a provider's type and specialty, such as physical therapist. It is chosen when the NPI is registered, and payers expect it to match the services billed.",
    whereYouSeeIt: "The Taxonomy field on the provider record.",
    clientWhereYouSeeIt: "Enrollment Explorer uses it to work out each provider's discipline.",
    related: ["npi", "provider"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "ptan",
    term: "PTAN",
    aka: ["Provider Transaction Access Number", "Payer provider ID"],
    category: "basics",
    definition:
      "The Provider Transaction Access Number is the ID Medicare assigns once enrollment is approved. It is separate from the NPI. Other payers issue their own provider IDs under their own names.",
    whereYouSeeIt:
      "When a case moves to Approved, Minted Panel asks for the payer's provider ID under that payer's own label, such as \"PTAN\".",
    clientWhereYouSeeIt:
      "Enrollment Explorer shows the payer's reference for an enrollment where one is recorded.",
    related: ["approved", "revalidation", "npi"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "line-of-business",
    term: "Line of business",
    aka: ["LOB", "Payer product", "Product"],
    category: "basics",
    definition:
      "A payer's product family, such as commercial, Medicare Advantage or Medicaid managed care. A provider can be in network for one product and not another with the same payer.",
    whereYouSeeIt:
      "Enrollment Explorer breaks enrollment out by payer product where products are set up.",
    related: ["par", "enrollment", "payer"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "roster",
    term: "Roster",
    aka: ["Payer roster", "Provider roster"],
    category: "basics",
    definition:
      "A list of a group's providers, locations and identifiers in the layout a payer asks for. Groups send rosters to add, change or remove providers, and delegated groups send them instead of individual applications.",
    whereYouSeeIt: "The Roster Engine in the Reporting Center builds, checks and exports them.",
    clientWhereYouSeeIt:
      "Your Minted Panel team builds and checks payer rosters from your provider records.",
    related: ["delegated-credentialing", "provider", "facility"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
];

const RECORD_TERMS: GuideTerm[] = [
  {
    id: "organization",
    term: "Organization",
    aka: ["Org", "Customer account"],
    category: "records",
    definition:
      "One customer account, such as a medical group or practice company. Everything in Minted Panel belongs to one organization, and nothing crosses between them.",
    whereYouSeeIt:
      "The organization switcher in the sidebar. Most reports show one organization at a time and ask you to pick one first.",
    clientWhereYouSeeIt: "Your Reporting Center shows the organization you were given access to.",
    related: ["group", "provider"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "group",
    term: "Group",
    aka: ["Provider group", "Billing entity"],
    category: "records",
    definition:
      "The billing entity payers contract with: a legal entity with its own TIN, group NPI and operating states. An organization can have several groups. Each provider belongs to at least one group, and one of them is their primary group.",
    whereYouSeeIt: "Groups in the sidebar, and as a column or filter in most reports.",
    clientWhereYouSeeIt: "The Group filter and the column headings in Enrollment Explorer.",
    related: ["organization", "facility", "tin", "provider"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "facility",
    term: "Facility / location",
    aka: ["Location", "Clinic", "Site", "Go-live date"],
    category: "records",
    definition:
      "A physical place where providers see patients. Each facility belongs to exactly one group. A facility's go-live date is the day it opens. It is a plain date; there is no separate location status.",
    whereYouSeeIt:
      "On the group record. Launches, Facilities Without Providers and Locations per Group report on them.",
    clientWhereYouSeeIt: "The Facility filter and the enrollment details in Enrollment Explorer.",
    related: ["group", "provider", "go-live"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "provider",
    term: "Provider",
    aka: ["Clinician", "Practitioner"],
    category: "records",
    definition:
      "A clinician the organization credentials. The provider record holds identity (NPI, CAQH, licenses), group memberships, facility assignments, enrollments, cases and documents in one place.",
    whereYouSeeIt: "Providers in the sidebar.",
    clientWhereYouSeeIt: "The rows of Enrollment Explorer.",
    related: ["group", "facility", "case", "test-provider"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "payer",
    term: "Payer",
    aka: ["Insurance plan", "Health plan"],
    category: "records",
    definition:
      "An insurance company or government program that pays claims. Minted Panel keeps one shared payer list for every customer, so payer names and details stay consistent.",
    whereYouSeeIt: "Payer Setup, and as a column or filter in most reports.",
    clientWhereYouSeeIt: "The column headings in Enrollment Explorer.",
    related: ["case", "line-of-business", "par"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "case",
    term: "Case",
    aka: ["Credentialing case", "Application"],
    category: "records",
    definition:
      "One piece of credentialing work: one provider, with one payer, under one group, in one state. There is never a second case for the same four; a denied case is reapplied on the same case. A case can cover several locations, and one of them is primary.",
    whereYouSeeIt: "Cases in the sidebar, and the provider record's Cases panel.",
    clientWhereYouSeeIt: "Enrollment Explorer statuses use the same eight case statuses.",
    related: ["task", "touch", "not-started", "approved", "denied"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "touch",
    term: "Touch",
    aka: ["Touchpoint", "Activity", "Follow-up"],
    category: "records",
    definition:
      "One logged contact or piece of work on a case, such as a call, email, portal check or fax. Touches are never edited; a correction is added as a new entry. A touch can set the next follow-up date.",
    whereYouSeeIt: "The activity log on each case.",
    related: ["case", "task"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "task",
    term: "Task",
    aka: ["Checklist step", "SOP"],
    category: "records",
    definition:
      'One step of the checklist a case follows for its payer and state, such as "complete the application" or "upload the W-9". Tasks come from the payer\'s procedure when the case is created.',
    whereYouSeeIt: "The task list on each case.",
    related: ["case", "touch"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "enrollment-fact",
    term: "Enrollment fact",
    aka: ["Existing enrollment"],
    category: "records",
    definition:
      "A record that a provider is already enrolled with a payer under a group in a state, usually brought over when the organization joined Minted Panel. It counts as enrolled without a case. When it expires, the provider becomes a candidate for a new case again.",
    whereYouSeeIt:
      "Provider and group records. It makes a targeted payer show as Active, and Enrollment Explorer can publish enrollment from it.",
    related: ["enrollment", "fulfillment-pill", "case"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
];

const STATUS_TERMS: GuideTerm[] = [
  {
    id: "not-started",
    term: "Not Started",
    category: "statuses",
    definition: "The case exists, but no work has been recorded on it yet.",
    whereYouSeeIt: "Set automatically when the case is created.",
    related: ["in-progress", "open-case", "case"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "in-progress",
    term: "In Progress",
    category: "statuses",
    definition:
      "Work on the application has started: a touch was logged, a task was completed or a form was filled. A reapplied case also returns here.",
    whereYouSeeIt: "Set automatically on the first recorded work.",
    related: ["not-started", "submitted", "reapply"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "submitted",
    term: "Submitted",
    category: "statuses",
    definition:
      "The application reached the payer. Minted Panel never assumes a fax or mailing arrived; someone logs it and confirms the change.",
    whereYouSeeIt:
      "Set automatically when the Minted extension logs a portal submission, or by a coordinator after logging a fax, mail or email submission.",
    clientWhereYouSeeIt: "Set when the application is logged as sent to the payer.",
    related: ["in-progress", "in-review"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "in-review",
    term: "In Review",
    category: "statuses",
    definition: "The payer has confirmed it is reviewing the application.",
    whereYouSeeIt: "Set by a coordinator, based on what the payer said.",
    related: ["submitted", "action-required"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "action-required",
    term: "Action Required",
    category: "statuses",
    definition:
      "The payer asked for something more, such as a missing document or a correction. Once the response goes back, the case returns to In Review.",
    whereYouSeeIt: "Set by a coordinator.",
    related: ["in-review", "open-case"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "approved",
    term: "Approved",
    category: "statuses",
    definition:
      "The payer approved the application. Moving a case to Approved requires the effective date and the payer's provider ID under the payer's own label.",
    whereYouSeeIt: "Set by a coordinator. Only an admin correction can move it back.",
    related: ["effective-date", "ptan", "x-of-y-approved"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "denied",
    term: "Denied",
    category: "statuses",
    definition:
      "The payer denied the application. Moving a case to Denied requires a reason from a fixed list. A denied case can be reapplied.",
    whereYouSeeIt: "Set by a coordinator. The Denials report lists denied cases.",
    clientWhereYouSeeIt: "Set by a coordinator. Shown in Enrollment Explorer.",
    related: ["reapply", "denial-reason", "cycle-state"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "not-pursuing",
    term: "Not Pursuing",
    category: "statuses",
    definition:
      "The organization chose to stop this application on purpose. A note explaining why is required.",
    whereYouSeeIt: "Set by a coordinator. Only an admin correction can move it back.",
    related: ["denied", "open-case"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "reapply",
    term: "Reapply",
    category: "statuses",
    definition:
      "Restarting a denied case. The same case returns to In Progress with a fresh checklist, and the earlier denial stays in its history. It never creates a second case.",
    whereYouSeeIt: "The status menu on a denied case.",
    related: ["denied", "in-progress", "cycle-state"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "open-case",
    term: "Open case",
    aka: ["Pending case", "Closed case"],
    category: "statuses",
    definition:
      "A case in one of the five working statuses: Not Started, In Progress, Submitted, In Review or Action Required. Approved, Denied and Not Pursuing are closed.",
    whereYouSeeIt: "The open-case count on Cases in the sidebar, and the Launches report.",
    clientWhereYouSeeIt: "Enrollment Explorer's status filter includes each open status.",
    related: ["not-started", "action-required", "approved", "denied", "not-pursuing"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
];

const LABEL_TERMS: GuideTerm[] = [
  {
    id: "org-stage",
    term: "In motion / Prospect / Inactive",
    aka: ["Organization stage", "Lifecycle"],
    category: "labels",
    definition:
      "An organization's stage. In motion means an active customer. Prospect means not yet a customer. Inactive means no longer active.",
    whereYouSeeIt:
      "Portfolio's tiles and lists. Converting an inbound lead creates a prospect organization.",
    related: ["organization"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "go-live",
    term: "Go-live date",
    aka: ["Go-live", "Opening date"],
    category: "labels",
    definition:
      "The day a location opens to patients. It is a plain date on the location; there is no separate opening status.",
    whereYouSeeIt:
      "Launches lists locations from 30 days before today onward. Facilities Without Providers shows it for information only.",
    related: ["facility", "at-risk"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "at-risk",
    term: "At risk",
    category: "labels",
    definition:
      "A location whose go-live is today or within the next 30 days and that still has open cases pending, no providers assigned, or both. A location that has already opened is never at risk.",
    whereYouSeeIt: "The Risk column in Launches, with the reasons listed in the pill.",
    related: ["go-live", "open-case", "assigned-provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "assigned-provider",
    term: "Assigned provider",
    aka: ["Staffed", "Providers (count)", "Unstaffed"],
    category: "labels",
    definition:
      "A provider counts as assigned to a location when their assignment there has started and they are neither terminated nor a test provider.",
    whereYouSeeIt:
      "The Providers column in Launches, and the rule behind Facilities Without Providers.",
    related: ["provider", "facility", "test-provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "reference-only",
    term: "Reference-only",
    category: "labels",
    definition:
      "A provider or location kept for the record but left out of active work. Reference-only locations are left out of the location reports.",
    whereYouSeeIt:
      "Launches, Facilities Without Providers and Locations per Group leave out reference-only locations.",
    related: ["facility", "provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "test-provider",
    term: "Test provider",
    category: "labels",
    definition:
      "A provider record flagged as a test, used for training or trying out a workflow. Reports leave test providers out so they never inflate real numbers.",
    whereYouSeeIt:
      "Left out of Launches, Facilities Without Providers, Denials and Expiring Credentials, and never shown to client users in Enrollment Explorer. Billing Readiness marks them Do Not Bill. The Roster Engine does not flag them.",
    related: ["provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "denial-reason",
    term: "Denial reason",
    category: "labels",
    definition:
      "The reason picked from a fixed list when a case is moved to Denied: Missing Documentation, Network Closed, Demographic Mismatch, Incomplete Application, Credentialing Criteria Not Met, or Other. Other requires a note.",
    whereYouSeeIt:
      'The Reason column in Denials. It shows "Denied" when no reason was recorded or the reason is no longer offered.',
    related: ["denied", "cycle-state"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "cycle-state",
    term: "Cycle: Standing / Reapplied",
    aka: ["Standing", "Reapplied"],
    category: "labels",
    definition:
      'Where a denied case stands today. Standing means it is still denied. "Reapplied — now In Progress" (or another status) means it was reopened and shows its current status.',
    whereYouSeeIt: "The Cycle column in Denials. Click it to open the case.",
    related: ["reapply", "denied", "denial-reason"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "billing-status",
    term: "Billable Ready / Hold / Do Not Bill",
    aka: ["Billing status", "Current readiness", "Billable Ready", "Hold", "Do Not Bill"],
    category: "labels",
    definition:
      "Whether claims for one clinician, at one location, to one payer can be released today. Do Not Bill means a stopping problem, such as no matching case, an inactive clinician or an expired license. Hold means something needs confirming first, such as a missing effective date or an unlinked location. Billable Ready means every recorded check passed.",
    whereYouSeeIt:
      "Billing Readiness: the Clearance Lookup result and the Current readiness column of the Change Feed.",
    related: ["effective-date", "change-source", "approved"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "change-source",
    term: "Recorded / Date-derived",
    aka: ["Source"],
    category: "labels",
    definition:
      "Where a billing change came from. Recorded means someone did something and Minted Panel logged it, such as an approval. Date-derived means it was worked out from a date on file, such as a license expiration or a termination date.",
    whereYouSeeIt: "The Source column in the Billing Readiness Change Feed.",
    related: ["billing-status"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "expiring-status",
    term: "Expired / Expiring soon / Current",
    aka: ["90/60/30", "Expiring soon", "Expiration status"],
    category: "labels",
    definition:
      "A document's expiration status. Expired: the date has passed. Expiring soon: it expires within 90 days for a state license, 60 days for a DEA registration, or 30 days for a certificate of insurance or any other document. Current: further out than that.",
    whereYouSeeIt: "The Status column in Expiring Credentials.",
    related: ["document-version"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "document-version",
    term: "Document version",
    aka: ["Version", "Replace"],
    category: "labels",
    definition:
      "Documents are never overwritten. Replace adds a new version (v2, v3 and so on), and only the newest version counts as current.",
    whereYouSeeIt:
      "The Version column in Expiring Credentials and the documents panels on provider and group records.",
    related: ["expiring-status"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "x-of-y-approved",
    term: "x of y approved",
    category: "labels",
    definition:
      "Approved cases out of the cases in view, worked out live from case statuses and never stored. On the Providers list, Not Pursuing cases are left out of the total.",
    whereYouSeeIt:
      "The Providers list and the grouped views on Cases. It is not shown in the Reporting Center today.",
    related: ["approved", "case"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "fulfillment-pill",
    term: "Fulfillment pill",
    aka: ["Targeted", "Active (payer)"],
    category: "labels",
    definition:
      "One state per payer a group targets. Targeted: nothing open yet. In Progress: open cases, with a count. Active: at least one approved case or a current enrollment fact, with the earliest date it became active.",
    whereYouSeeIt:
      "The Payer Network section of a group. It is not shown in the Reporting Center today.",
    related: ["enrollment-fact", "approved", "open-case"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "published-enrollment",
    term: "Published enrollment",
    aka: ["Published", "No published enrollment"],
    category: "labels",
    definition:
      'Enrollment that Minted Panel staff have reviewed and released to the practice. Client users see enrollment only once it is published. "No published enrollment" means the provider belongs in that group but nothing has been released yet.',
    whereYouSeeIt: "Enrollment Explorer cells.",
    related: ["enrollment-proof", "needs-verification", "historical-publication"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "needs-verification",
    term: "Needs verification",
    category: "labels",
    definition:
      "The information behind a published enrollment has changed or its proof has lapsed, so details are held back until Minted Panel staff recheck it. The last published status is still shown.",
    whereYouSeeIt: "Enrollment Explorer cells and enrollment details.",
    related: ["published-enrollment", "enrollment-proof"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "enrollment-proof",
    term: "Proof",
    aka: ["Published proof", "Evidence"],
    category: "labels",
    definition:
      "The document behind an enrollment fact, such as a payer approval letter, roster confirmation, acknowledgement or license verification. An Approved status and the approval, effective and termination dates are shown only when proof backs them.",
    whereYouSeeIt: "Enrollment Explorer details. Client users can download published proof there.",
    related: ["published-enrollment", "psv", "effective-date"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "historical-publication",
    term: "Historical",
    aka: ["Include historical publications"],
    category: "labels",
    definition:
      "An earlier published version of an enrollment, or one that was withdrawn. Hidden unless you turn on Include historical publications.",
    whereYouSeeIt: 'Enrollment Explorer, shown as "Historical" followed by the status.',
    related: ["published-enrollment"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "enrollment-terminated",
    term: "Terminated (enrollment)",
    category: "labels",
    definition:
      "The provider's enrollment with that payer product has ended. It is an enrollment status, separate from a provider's own Terminated status.",
    whereYouSeeIt: "Enrollment Explorer cells and the Enrollment status filter.",
    related: ["published-enrollment", "approved"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "discipline",
    term: "Discipline",
    aka: ["PT", "PTA", "OT", "OTA", "SLP"],
    category: "labels",
    definition:
      "The provider's profession, worked out from their taxonomy code: PT, PTA, OT, OTA, SLP, Other, or Unknown when no recognized code is on file.",
    whereYouSeeIt: "Enrollment Explorer rows and its Discipline filter.",
    related: ["taxonomy"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "action-owner",
    term: "Action owner",
    category: "labels",
    definition:
      "Who the next step on an enrollment is waiting on: Minted, the client, the payer, nobody yet (Unassigned), or no one because it is complete.",
    whereYouSeeIt: "Enrollment Explorer details, and the Owner column of its CSV.",
    related: ["published-enrollment"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "payer-reference",
    term: "Payer reference",
    category: "labels",
    definition:
      "The ID or reference number the payer gave this enrollment or application. Import it as text in a spreadsheet so leading zeros are kept.",
    whereYouSeeIt: "Enrollment Explorer details and CSV.",
    related: ["ptan", "published-enrollment"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "audit-action",
    term: "Audit action",
    aka: ["CREATE", "UPDATE", "DELETE", "STATUS_CHANGE", "TOUCH_LOGGED", "TERMINATION", "READ"],
    category: "labels",
    definition:
      "The kind of change an audit entry records: a record created, updated or deleted, a case status changed, a touch logged, a provider terminated, or sensitive information read.",
    whereYouSeeIt: "The Action column and filter in the Audit Log.",
    related: ["touch", "case"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "roster-grain",
    term: "Roster grain",
    aka: ["Export grain", "Provider + location", "Provider + location + TIN"],
    category: "labels",
    definition:
      "What one row of a roster file represents: one provider, one provider at one location, or one provider at one location under one group's TIN.",
    whereYouSeeIt: "The Roster Engine template list and mapping page.",
    related: ["roster", "tin"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "validation-severity",
    term: "Hard error / Warning",
    aka: ["Severity", "Export blocked", "Export ready"],
    category: "labels",
    definition:
      "A hard error blocks a roster export until it is fixed or, where allowed, overridden with a reason. A warning is information only and never blocks.",
    whereYouSeeIt:
      "Roster Engine validation: the tiles, the issue list and the export status pill.",
    related: ["roster-override"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "roster-override",
    term: "Override",
    aka: ["Audited override"],
    category: "labels",
    definition:
      "Accepting one specific roster error for an export, with a written reason of at least 20 characters. It applies only to the same day, mapping revision and source data. Admins and specialists can record one.",
    whereYouSeeIt: "Roster Engine validation, and the override count on each export.",
    related: ["validation-severity", "export-snapshot"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "export-snapshot",
    term: "Export snapshot",
    aka: ["SHA-256", "Checksum"],
    category: "labels",
    definition:
      "The permanent record of a roster export: the file itself, the template, mapping revision, who exported it, the row count, the overrides applied and a SHA-256 checksum that proves the file hasn't changed.",
    whereYouSeeIt: "Roster Engine export page and export history.",
    related: ["roster-override", "roster"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "contract-status",
    term: "Contracting status",
    aka: ["In-Network", "In Progress (Contract Signed)", "Contracted", "OON"],
    category: "labels",
    definition:
      "Where a group's contract with a payer in a state stands, such as Not Started, In Progress, Contracted, In-Network or Out of Network. Each organization has its own list, so the options can differ.",
    whereYouSeeIt:
      "Group Contracts Matrix cells and the contract record. In-Network shows as a green x and In Progress (Contract Signed) as an amber x.",
    related: ["par", "contract-dates", "group"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "contract-dates",
    term: "Tentative / effective / expiration date (contracts)",
    aka: ["tent", "eff"],
    category: "labels",
    definition:
      "Dates on a group contract. Tentative is the expected start. Effective is the confirmed start. Expiration is when the contract ends.",
    whereYouSeeIt:
      'Group Contracts Matrix cells show "tent" for any status and "eff" only for In-Network. The expiration date is in the contract record only.',
    related: ["contract-status", "effective-date"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "cross-payer-dependency",
    term: "Cross-payer dependency",
    aka: ["Contract notes"],
    category: "labels",
    definition:
      "A note that one contract depends on another, such as a plan that loads only after Medicare enrollment is complete. It is free text on the contract.",
    whereYouSeeIt:
      "The Cross-Payer Dependencies & Contract Notes card under each group in the Group Contracts Matrix.",
    related: ["contract-status"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
];

export const GUIDE_TERMS: readonly GuideTerm[] = [
  ...BASICS_TERMS,
  ...RECORD_TERMS,
  ...STATUS_TERMS,
  ...LABEL_TERMS,
];

// ---------------------------------------------------------------------------
// Report articles (one per registry key)
// ---------------------------------------------------------------------------

/** One column, tile, pill or control on a report, with a plain definition. */
export interface GuideField {
  label: string;
  meaning: string;
}

export interface ReportArticle {
  /** The registry key in src/lib/reports.ts. */
  reportKey: string;
  /** One line under the title. */
  summary: string;
  /** The question the report answers. */
  question: string;
  learn: readonly string[];
  whoUses: string;
  howToRead: readonly GuideField[];
  counted: readonly string[];
  leftOut: readonly string[];
  filtersAndExport: readonly string[];
  goodToKnow: readonly string[];
  /** Shown to internal users only, under "For Minted Panel staff". */
  staffNotes?: readonly string[];
  relatedReports: readonly string[];
  relatedTerms: readonly string[];
  audiences: readonly GuideAudience[];
  reviewStatus: GuideReviewStatus;
}

const PERFORMANCE_ARTICLES: ReportArticle[] = [
  {
    reportKey: "portfolio",
    summary: "Every organization you belong to, by stage and by state.",
    question:
      "How many customer organizations do we have, what stage is each one in, and where are they?",
    learn: [
      "What the In motion and Prospects tiles count",
      "Where an organization's state comes from",
      "How to share a read-only copy",
    ],
    whoUses:
      "Minted Panel leadership and account managers reviewing the book of business. It is a planning view, not a daily work list.",
    howToRead: [
      {
        label: "In motion",
        meaning: "Organizations marked active. Inactive organizations are not in this tile.",
      },
      {
        label: "Prospects",
        meaning: "Organizations still at the prospect stage.",
      },
      {
        label: "In motion and Prospects lists",
        meaning: "Each organization by name. Click one to switch to it and open its cases.",
      },
      {
        label: "By state",
        meaning:
          'How many active and prospect organizations are in each state. The state comes from the address of the organization\'s customer escalation contact, or its owner when there is no escalation contact. "Unknown" means neither has a state on file.',
      },
      {
        label: "All organizations",
        meaning:
          "Every organization, split into In motion, Prospects and Inactive, with its state. This is the only place inactive organizations appear.",
      },
      {
        label: "Share this report",
        meaning:
          "Creates a read-only link for one person: the full portfolio for a colleague, or one organization for that practice's owner. Links expire after 30 days and can be revoked at any time.",
      },
    ],
    counted: [
      "Every organization you are a member of.",
      "Active and prospect organizations in the tiles and in By state.",
    ],
    leftOut: [
      "Inactive organizations, from the tiles and By state. They still appear under All organizations.",
      "Organizations you are not a member of.",
      "Sales rep addresses. They are never used to decide an organization's state.",
    ],
    filtersAndExport: [
      "Covers all your organizations at once, so you don't need to pick one first.",
      "No filters, search or CSV export.",
      "Share creates a read-only link. The person you share with sees the tiles and lists only, not By state or All organizations.",
    ],
    goodToKnow: [
      "When an organization has more than one escalation contact (or owner) with a state, the report uses one of them. The choice stays the same between visits, but it is not necessarily the default contact.",
      "The By state tiles and All organizations rows don't link anywhere.",
      "Active and prospect organizations appear twice: in the lists at the top and again under All organizations.",
    ],
    relatedReports: ["leads", "launches"],
    relatedTerms: ["organization", "org-stage"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    reportKey: "launches",
    summary:
      "Locations opening soon or opened in the last 30 days, with staffing, open cases and at-risk flags.",
    question:
      "Which locations are about to open or just opened, and is any of them at risk of opening before its providers are ready?",
    learn: [
      "Which locations the report lists, and for how long",
      "How providers and open cases are counted per location",
      "Exactly when a location is flagged at risk",
    ],
    whoUses:
      "Coordinators and practice leaders preparing a new location. Check it weekly as a go-live date gets close.",
    howToRead: [
      {
        label: "Group sections",
        meaning:
          'Locations are grouped under their group, A to Z. Locations without a group are listed under "No group" at the end. Within a group, the soonest go-live comes first.',
      },
      { label: "Location", meaning: "The location's name, with its city and state." },
      {
        label: "Go-live",
        meaning:
          'The location\'s go-live date, followed by how many days until it, "today", or how many days ago it was.',
      },
      {
        label: "Providers",
        meaning:
          "How many different providers are assigned to the location now. Terminated providers, test providers and assignments that start later are not counted.",
      },
      {
        label: "Open cases",
        meaning:
          "How many open credentialing cases are linked to this location. Each payer is its own case. A case linked to several locations counts at each of them.",
      },
      {
        label: "Risk",
        meaning:
          '"At risk" when the go-live is today or within the next 30 days and open cases are still pending, no providers are assigned, or both. The reasons are listed in the pill. A location that has already opened is never flagged.',
      },
    ],
    counted: [
      "Active locations with a go-live date from 30 days ago onward. There is no limit on how far ahead the date can be.",
      "Cases in an open status: Not Started, In Progress, Submitted, In Review or Action Required.",
    ],
    leftOut: [
      "Inactive and reference-only locations, and locations with no go-live date.",
      "Locations that opened more than 30 days ago.",
      "From Providers: terminated providers, test providers and assignments that haven't started yet.",
      "From Open cases: closed cases (Approved, Denied, Not Pursuing) and test providers' cases.",
    ],
    filtersAndExport: [
      "Select an organization first. Without one, the report asks you to pick one.",
      "No filters, search, export or share.",
      "Rows don't link anywhere yet. Open the group to work on a location.",
    ],
    goodToKnow: [
      "Open cases still include cases for providers who have since been terminated, while Providers leaves those providers out. A row can show open cases and zero providers.",
      '"Terminated" means the provider\'s status is Terminated, even if the termination date is still in the future.',
      '"Today" is your computer\'s calendar date.',
      "Locations under inactive groups are still listed.",
    ],
    relatedReports: ["facilities-without-providers", "locations-per-group"],
    relatedTerms: ["go-live", "at-risk", "assigned-provider", "open-case", "facility"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    reportKey: "facilities-without-providers",
    summary: "Active locations with no current provider assigned.",
    question: "Which of our active locations have nobody assigned to see patients?",
    learn: [
      'What "no providers" means here',
      "Which locations are checked",
      "Why a location can appear even though its page lists providers",
    ],
    whoUses:
      "Coordinators and operations staff cleaning up rosters or planning recruiting. Check it after roster changes or once a month.",
    howToRead: [
      { label: "Facility", meaning: "The location's name. Rows are sorted A to Z." },
      {
        label: "Group",
        meaning: 'The group that owns the location, or "—" when it has none.',
      },
      { label: "Location", meaning: 'The city and state, or "—".' },
      {
        label: "Go-live",
        meaning: "The location's go-live date, for information only. It doesn't affect the list.",
      },
    ],
    counted: [
      "Active locations with no current provider, using the same staffing rule as Launches.",
      "Locations with any go-live date, past or future, or none at all.",
    ],
    leftOut: [
      "Inactive and reference-only locations.",
      "Not counted as staff: terminated providers, test providers and assignments that haven't started yet.",
    ],
    filtersAndExport: [
      "Select an organization first.",
      "No filters, search, export or share. Rows don't link anywhere.",
    ],
    goodToKnow: [
      '"No providers" means no current, eligible provider. A location whose only assignments are terminated, test or future-start providers appears here, even though its own page lists those names.',
      "Locations under inactive groups are included.",
    ],
    relatedReports: ["launches", "locations-per-group"],
    relatedTerms: ["assigned-provider", "facility", "reference-only", "test-provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    reportKey: "locations-per-group",
    summary: "How many active locations each group has.",
    question: "How many active locations does each of our groups have?",
    learn: ["What counts as an active location", "Why this count can differ from the group page"],
    whoUses:
      "Leadership and account managers who need a quick count, for example before a payer roster or contract conversation.",
    howToRead: [
      {
        label: "Group",
        meaning:
          'Every group in the organization, A to Z, including groups with no locations and inactive groups. A "No group" row appears at the end only when an active location has no group.',
      },
      {
        label: "Active locations",
        meaning: "How many active, non-reference locations the group owns.",
      },
    ],
    counted: ["Active locations that are not reference-only."],
    leftOut: [
      "Inactive and reference-only locations.",
      "Providers and dates play no part in this count.",
    ],
    filtersAndExport: [
      "Select an organization first.",
      "No filters, search, export or share. Rows don't link to the group.",
    ],
    goodToKnow: [
      "The group page's location count includes reference-only locations, so it can be higher than the number here.",
    ],
    relatedReports: ["facilities-without-providers", "launches"],
    relatedTerms: ["group", "facility", "reference-only"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
];

const CREDENTIALING_ARTICLES: ReportArticle[] = [
  {
    reportKey: "denials",
    summary:
      "Every case a payer denied, grouped by provider or by payer, with the reason and where it stands now.",
    question: "Which applications have payers denied, why, and has each one been reapplied?",
    learn: [
      "What each column means, including the Cycle column",
      "Which denials are listed and which are not",
      "What the CSV export contains",
    ],
    whoUses:
      "Coordinators deciding whether to appeal, reapply or stop, and managers looking for denial patterns by payer. Most teams check it weekly.",
    howToRead: [
      {
        label: "By provider / By payer",
        meaning: "Switches how rows are grouped. Each heading shows how many denials it holds.",
      },
      { label: "Provider", meaning: "The provider on the case." },
      { label: "Payer", meaning: "The payer that denied the application." },
      { label: "State", meaning: "The state of the application." },
      {
        label: "Reason",
        meaning:
          'The reason picked from the fixed list when the case was moved to Denied: Missing Documentation, Network Closed, Demographic Mismatch, Incomplete Application, Credentialing Criteria Not Met, or Other. It shows "Denied" when no reason was recorded or the reason is no longer offered.',
      },
      {
        label: "Denied on",
        meaning:
          'The day the most recent denial was recorded in Minted Panel. This is not necessarily the date on the payer\'s letter. "—" means no denial date was recorded.',
      },
      {
        label: "Cycle",
        meaning:
          '"Standing" means the case is still denied. "Reapplied — now In Progress" (or another status) means the case was reopened, and shows where it is today. Click it to open the case.',
      },
    ],
    counted: [
      "Every case whose status is Denied today.",
      "Every case that was denied and has since been reapplied.",
      "One row per case, showing its most recent denial.",
    ],
    leftOut: [
      "Cases for test providers.",
      "Cases that were never denied.",
      "History entries Minted Panel wrote automatically when it moved to the current eight statuses. Older denials may show no date for this reason.",
    ],
    filtersAndExport: [
      "Select an organization first.",
      "The By provider / By payer switch is the only control. There is no date, payer or state filter and no search yet.",
      "Export CSV downloads every row, whichever grouping you're viewing, as denials.csv. Columns: Provider, Payer, State, Reason, Denied on, Cycle, Case id.",
      "In the CSV, Denied on is the full recorded date and time, and Reason is blank when no denial date was recorded.",
    ],
    goodToKnow: [
      "There is no date filter yet, so the report always covers all time.",
      "A case denied twice appears once, with its latest denial. Earlier denials on the same case are not listed separately.",
      'The note entered with an "Other" reason isn\'t shown here. Open the case to read it.',
      'An admin correction that moved a case out of Denied also shows as "Reapplied — now …".',
      "Denials for terminated providers are still listed.",
      "If you expect denials and the page says none are recorded, reload it. A failed load currently shows the same message.",
    ],
    relatedReports: ["billing-readiness", "expiring-credentials"],
    relatedTerms: ["denied", "denial-reason", "cycle-state", "reapply", "test-provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    reportKey: "billing-readiness",
    summary:
      "Whether one clinician can bill one payer at one location today, and which credentialing changes affect billing.",
    question:
      "Can we release claims for this clinician, at this location, to this payer today? And what has changed recently that affects billing?",
    learn: [
      "What Billable Ready, Hold and Do Not Bill mean",
      "Every check behind the answer",
      "How to read the Change Feed and the Newly Billable Digest",
    ],
    whoUses:
      "Billing teams and coordinators before releasing held claims. Use the Clearance Lookup for one question at a time, and scan the Change Feed daily or weekly.",
    howToRead: [
      {
        label: "Clearance Lookup",
        meaning:
          "Pick a clinician, a facility and a payer. All three are required. The clinician search matches names, not NPIs.",
      },
      {
        label: "Current readiness",
        meaning:
          "Billable Ready, Hold or Do Not Bill. Any stopping problem makes it Do Not Bill. Otherwise any open question makes it Hold. Only when every check passes is it Billable Ready.",
      },
      {
        label: "Why billing is held",
        meaning: "One line per check that didn't pass, in plain words.",
      },
      {
        label: "Group and Enrollment state",
        meaning: "Taken from the facility you picked (its group and its state), not from the case.",
      },
      {
        label: "Recorded confirmed effective date",
        meaning: 'The effective date recorded on the matching case, or "Not recorded".',
      },
      {
        label: "Retro eligibility",
        meaning: 'Always "Not recorded" today. Retro eligibility isn\'t tracked here yet.',
      },
      {
        label: "Estimated decision date",
        meaning:
          "Shown only for a submitted or in-review case when the payer has a typical decision time on file. It is an estimate, not a payer commitment.",
      },
      { label: "Assessment date", meaning: "The date the data behind the answer was read." },
      {
        label: "Change Feed",
        meaning:
          "Recent changes that affect billing: approvals, locations linked to a case, terminations that took effect and state licenses that expired. Each row also shows the clinician's current readiness for that location and payer.",
      },
      {
        label: "Source",
        meaning:
          '"Recorded" means someone did something and Minted Panel logged it. "Date-derived" means it was worked out from a date on file, such as a license expiration.',
      },
      {
        label: "Newly Billable Digest",
        meaning:
          "A CSV of the approvals and new location links in the current filters that are Billable Ready today.",
      },
    ],
    counted: [
      "The clinician is active, verified and not a test clinician.",
      "The facility is active and linked to an active group, with a state on file.",
      "The clinician has a current membership in that group and a started assignment at that facility.",
      "Exactly one case matches the clinician, the facility's group, the payer and the facility's state, and the facility is linked to that case.",
      "That case is Approved, with a confirmed effective date that has been reached and no termination in effect.",
      "The clinician holds an active license in the facility's state that hasn't expired or failed verification, and the payer is active.",
    ],
    leftOut: [
      "Uploaded documents, DEA, CAQH and malpractice dates. They are not part of this check.",
      "History entries Minted Panel wrote automatically when it moved to the current eight statuses.",
      "Claim-level eligibility, retro authorization and payment. The report says so on screen.",
    ],
    filtersAndExport: [
      "Select an organization first.",
      "Clearance Lookup: a name search and three pickers. No export.",
      "Change Feed: Date range (last 7, 30 or 90 days; 30 is the default), Facility and Payer filters.",
      "Newly Billable Digest downloads newly-billable-digest.csv with the clinician, NPIs, group TIN, facility, payer, state, effective date, event date and assessment date.",
      "The data refreshes every 60 seconds.",
    ],
    goodToKnow: [
      "PTA and OTA clinicians always show Hold, because supervision can't be verified here. A PTA result lists physical therapists at the same location to check.",
      "The license check runs only when exactly one matching case is found.",
      "A case that isn't linked to any location adds no approval or termination rows to the Change Feed, and the Lookup says the facility is not linked to the case.",
      'A "license expired" row can appear even when a renewal is on file. The Lookup\'s license check does take the renewal into account, so use it to confirm.',
      "While the data refreshes, the results briefly show as unavailable, then return.",
      "The pickers list every clinician, facility and payer, including test, terminated and inactive ones. Those assess as Do Not Bill.",
    ],
    relatedReports: ["enrollment-explorer", "denials", "expiring-credentials"],
    relatedTerms: [
      "billing-status",
      "change-source",
      "effective-date",
      "retro",
      "taxonomy",
      "test-provider",
    ],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    reportKey: "expiring-credentials",
    summary: "Uploaded provider and group documents, soonest expiration first.",
    question:
      "Which documents on file have expired or are about to, so we can renew them before they hold up an application?",
    learn: [
      "When a document counts as expiring soon",
      "Which documents are included, and which records are not read",
      "Why this report can disagree with Billing Readiness",
    ],
    whoUses: "Coordinators planning renewal outreach. Most teams check it weekly.",
    howToRead: [
      { label: "Document", meaning: "The document type, with the file name underneath." },
      {
        label: "Owner",
        meaning: "The provider (click to open their record) or the group the document belongs to.",
      },
      { label: "Expires", meaning: "The expiration date entered when the file was uploaded." },
      {
        label: "Status",
        meaning:
          "Expired (the date has passed), Expiring soon (within 90 days for a state license, 60 days for a DEA registration, 30 days for a certificate of insurance or anything else), or Current.",
      },
      {
        label: "Version",
        meaning: "v1 is the first upload. Each Replace adds one.",
      },
      {
        label: "Download",
        meaning: "Opens the file through a short-lived link. Every download is logged.",
      },
    ],
    counted: [
      "The current version of every uploaded provider or group document that has an expiration date.",
      "Sorted by expiration date, soonest first.",
    ],
    leftOut: [
      "Older versions that a newer upload replaced.",
      "Documents with no expiration date, including some older licenses, DEAs and certificates uploaded before a date was required.",
      "W-9s, which are signed rather than dated.",
      "Documents for test providers.",
      "Records that aren't uploaded files: the Licenses section of the provider record, the DEA expiration and CAQH attestation dates on the provider record, and malpractice policy dates.",
    ],
    filtersAndExport: [
      "Select an organization first.",
      "No filters, search, sorting or export.",
      "Provider names link to the provider record.",
    ],
    goodToKnow: [
      "This report reads uploaded files only. Billing Readiness checks the Licenses section instead, so a license can look current in one and expired in the other.",
      "Uploading a renewed license as a new document, instead of using Replace, leaves two rows. Use Replace to keep one.",
      "Expired documents stay on the list until a newer version replaces them.",
      "Documents for terminated providers and inactive groups are still listed.",
      '"Today" is your computer\'s calendar date.',
    ],
    relatedReports: ["billing-readiness", "roster-engine"],
    relatedTerms: ["expiring-status", "document-version", "caqh", "test-provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
];

const ROSTER_CONTRACT_ARTICLES: ReportArticle[] = [
  {
    reportKey: "roster-engine",
    summary:
      "Build a payer roster file from your provider records, check every row, and save an audited export.",
    question:
      "Can we produce this payer's roster file from our records, and is every row right before we send it?",
    learn: [
      "How templates, grains and mappings fit together",
      "What blocks an export and when an override is allowed",
      "What the export snapshot records",
    ],
    whoUses:
      "Coordinators preparing roster submissions, such as monthly updates or rosters for a delegated arrangement.",
    howToRead: [
      {
        label: "Payer template",
        meaning:
          "A payer's roster layout: its columns and which ones are required. The three starter templates (BCBS NC, Humana and a Medicare reassignment worksheet) show \"Draft · payer spec pending\" because they haven't been checked against each payer's current workbook.",
      },
      {
        label: "Export grain",
        meaning:
          "What one row of the file represents: Provider, Provider + location, or Provider + location + TIN.",
      },
      {
        label: "Mapping",
        meaning:
          '"Map fields" starts a new mapping. Choose the providers, groups and locations to include, then connect each payer column to a Minted Panel field, with an optional format change such as uppercase, a date format or phone digits only.',
      },
      {
        label: "Output preview",
        meaning: "How many rows your selection produces, with a sample of the first rows.",
      },
      {
        label: "Rows, Hard errors, Overrides, All issues",
        meaning:
          "The validation tiles. Hard errors block the export. Overrides are hard errors someone accepted with a reason. All issues includes warnings.",
      },
      {
        label: "Severity",
        meaning:
          "Error blocks the export unless an allowed override is recorded. Warning never blocks it.",
      },
      {
        label: "Override",
        meaning:
          "Accepts one specific error for this export, with a written reason of at least 20 characters. Some errors can't be overridden and must be fixed at the source.",
      },
      {
        label: "Export",
        meaning:
          "Creates the file as CSV or Excel and saves a snapshot recording the template, mapping revision, who exported it, the row count, the overrides and a SHA-256 checksum.",
      },
      {
        label: "Export history",
        meaning:
          "Every export with its file, row count, override count and checksum. Download returns the original file, unchanged by later edits.",
      },
    ],
    counted: [
      "Exactly the providers, groups and locations chosen in the mapping. New providers are never added to an existing mapping automatically.",
      "Location rows need an assignment that has started. Group details need a current group membership.",
      "Checks run on every row: required values, NPI check digit, phone numbers, dates, ZIP+4, location assignment, active location and group, and an active license in the location's state.",
    ],
    leftOut: [
      "Providers you didn't select.",
      "Effective date, line of business and par status. No starter template has those columns.",
    ],
    filtersAndExport: [
      "Select an organization first.",
      'Search inside the provider, group and location lists. Validation has an "Errors only" switch.',
      "Export as CSV (UTF-8) or Excel (XLSX). The file is named after the mapping and the validation date.",
      "Billing members can review templates, mappings and validation and download earlier files, but can't map, override or export.",
    ],
    goodToKnow: [
      "The starter templates are drafts. Confirm each payer's current workbook before submitting. Their draft warning appears on every validation.",
      "An override applies only to the same day, the same mapping revision and the same source data. Saving the mapping, changing the data or a new day means recording it again.",
      "Terminated, test and reference-only providers are not flagged. Check your selection before exporting.",
      "A five-digit ZIP is an error. Practice locations need ZIP+4.",
      "When a template has address columns, every row needs an active license in the location's state, even if the template has no license column.",
      "A roster can have up to 5,000 rows and a file up to 3 MB.",
      "Export history shows who exported as a user ID, not a name.",
      "Mappings can't be deleted.",
      "Files can include date of birth and SSN last 4 when those fields are mapped. Anyone who can open export history, including billing members, can download them.",
    ],
    relatedReports: ["enrollment-explorer", "contracts-matrix"],
    relatedTerms: [
      "roster",
      "delegated-credentialing",
      "roster-grain",
      "validation-severity",
      "roster-override",
      "export-snapshot",
      "npi",
      "tin",
    ],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    reportKey: "contracts-matrix",
    summary: "Each group's contract status with every payer, state by state.",
    question:
      "Where does each group have a payer contract in place, where is one in progress, and what does each depend on?",
    learn: [
      'How to read a cell, including "—" and the x boxes',
      "What the active contracts count really counts",
      "How to record or update a contract",
    ],
    whoUses:
      "Contracting coordinators and practice leaders working on group payer contracts. Use it during a contracting push or before opening a new state.",
    howToRead: [
      {
        label: "Provider groups",
        meaning: "Pick one or more groups. Each selected group gets its own grid.",
      },
      { label: "Specialty", meaning: "Narrows to contracts recorded for one specialty." },
      { label: "Filter payers", meaning: "Searches payer names." },
      {
        label: "Active contracts mapped",
        meaning:
          "How many visible cells have a contract record, whatever its status, including Not Started and Denied.",
      },
      {
        label: "Rows and columns",
        meaning:
          "Rows are every payer in the catalog, A to Z, not only payers the group targets. Columns are states where the group has a contract, a location or a payer target.",
      },
      {
        label: "Cell",
        meaning:
          '"—" means there is no contract record. A green x is In-Network. An amber x is In Progress (Contract Signed). Any other status shows as a labeled pill. "tent" is the tentative date. "eff" is the effective date, shown only for In-Network. A note icon means notes are recorded.',
      },
      {
        label: "Cross-Payer Dependencies & Contract Notes",
        meaning:
          'Every note recorded on the group\'s contracts, such as "effective only after Medicare enrollment is complete". It is free text.',
      },
      {
        label: "Contract record",
        meaning:
          "Click a cell to open it: Contracting Status, Specialty, Tentative, Effective and Expiration dates, Notes, and the contract's assigned procedure (Contract SOP).",
      },
    ],
    counted: ["One contract per group, payer and state.", "Every contract in the organization."],
    leftOut: [
      "Individual provider enrollment. Contracts belong to the group; provider applications are cases.",
      "Expiration dates, which can be entered but aren't shown in the grid.",
    ],
    filtersAndExport: [
      "Select an organization first. Without one, the page says no provider groups were found.",
      "Filter by group, specialty and payer name.",
      "Links from a case can open the matrix on its group with the matching cell highlighted.",
      "No export.",
    ],
    goodToKnow: [
      '"—" means no contract record, not the Not Started status. A contract set to Not Started shows a gray Not Started pill.',
      "Clicking an empty cell and saving creates a contract, Not Started by default, which then counts as an active contract mapped.",
      "The legend's colored dots don't appear in the cells. Statuses show as labeled pills.",
      "Every catalog payer is a row, including archived payers, so grids are long. Use Filter payers.",
      "Inactive groups, inactive locations and archived payer targets can still add state columns.",
      "Contracting status options differ by organization: newer organizations have six, older ones up to eleven.",
      "Billing members can open a contract, but saving it fails.",
    ],
    relatedReports: ["roster-engine", "locations-per-group"],
    relatedTerms: [
      "contract-status",
      "contract-dates",
      "cross-payer-dependency",
      "par",
      "tin",
      "group",
    ],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
];

const EXPLORER_AUDIT_LEADS_ARTICLES: ReportArticle[] = [
  {
    reportKey: "enrollment-explorer",
    summary:
      "Published payer enrollment for each provider, by group, state, payer product and location.",
    question:
      "Is each of our providers enrolled with each payer product, at each location, and what proof backs it up?",
    learn: [
      "How the grid is laid out: rows, columns and cells",
      "What each status word means, including Needs verification",
      "What the CSV contains and how to open it safely",
    ],
    whoUses:
      'Practice owners and their teams checking who is in network, and Minted Panel staff reviewing what has been published. Open it whenever you need to answer "are we in network with this payer here?"',
    howToRead: [
      {
        label: "Filters",
        meaning:
          "Search by provider name or NPI, then narrow by group, state, facility, payer product, discipline (PT, PTA, OT, OTA, SLP, Other, Unknown) and enrollment status.",
      },
      {
        label: "Rows",
        meaning: "One provider each, with their NPI, discipline and provider status.",
      },
      {
        label: "Columns",
        meaning:
          "One per group and state, then payer, then payer product (for example, a payer's commercial or Medicare Advantage plan).",
      },
      {
        label: "Cells",
        meaning:
          'The enrollment status for that provider with that payer product in that group and state. "—" means the provider isn\'t in that group. "No published enrollment" means the provider belongs there but nothing has been published yet.',
      },
      {
        label: "Several locations in one cell",
        meaning:
          "When a provider has more than one location in a cell, the cell shows the first location's status (locations sorted A to Z) and a count. Click it to choose a location and see each one's status.",
      },
      {
        label: "Status words",
        meaning:
          "The case statuses (Not started, In progress, Submitted, In review, Action required, Approved, Denied, Not pursuing), plus Terminated when the enrollment has ended and Needs verification when the source changed or its proof lapsed.",
      },
      {
        label: "Include historical publications",
        meaning: 'Shows earlier published versions, marked "Historical", alongside current ones.',
      },
      {
        label: "Enrollment details",
        meaning:
          "Click a cell to see the payer reference, key dates (submitted, payer acknowledged, approved, effective, termination), retro details, who owns the next action, when it was last reviewed, and its history. Client users can download the published proof.",
      },
    ],
    counted: [
      "Client users: enrollment Minted Panel has published for the provider groups your organization assigned to you.",
      "Providers who are active, verified and currently in one of those groups, plus any provider with published enrollment.",
      "An Approved status, and the approved, effective and termination dates and retro details, appear only when backed by proof such as a payer approval letter, roster confirmation or acknowledgement.",
    ],
    leftOut: [
      "Test providers.",
      "Groups you aren't assigned to.",
      "Enrollment that hasn't been published to you yet.",
      "Payer products that aren't set up for the group and state.",
      "Withdrawn publications, unless Include historical publications is on.",
    ],
    filtersAndExport: [
      "Your filters are kept in the page link, so a bookmarked link reopens the same view for anyone with access to it.",
      'The grid loads 50 providers at a time. Use "Load next 50 providers" to see more.',
      "Download CSV exports every matching enrollment record, not just the loaded providers, as enrollment-report.csv. Each row is one provider, group, payer product, location and state.",
      "When opening the CSV in a spreadsheet, import the NPI and payer reference columns as text to keep leading zeros.",
    ],
    goodToKnow: [
      "A cell with several locations shows the first location's status. Open the cell to check the others, which can differ.",
      "Needs verification means details are held back until Minted Panel staff recheck the source. The last published status is still shown.",
      "Intake, submitted and payer-acknowledged dates and the payer reference are shown without proof. Approval, effective and termination dates need proof.",
      "The view expires after 10 minutes. If it says the snapshot is no longer current, refresh it before reading or downloading.",
    ],
    staffNotes: [
      'Staff see every enrollment record in the organization\'s groups, including drafts, which show as "Staff draft". The staff CSV includes drafts, labeled as drafts.',
      "Staff access needs a place on the organization's internal staff list. Only an organization admin can publish or withdraw what clients see.",
      "The staff workspace below the grid is where scopes are captured, sources are triaged and payer products and targets are set up.",
    ],
    relatedReports: ["billing-readiness", "roster-engine"],
    relatedTerms: [
      "published-enrollment",
      "needs-verification",
      "enrollment-proof",
      "line-of-business",
      "discipline",
      "action-owner",
      "payer-reference",
      "effective-date",
      "retro",
    ],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    reportKey: "audit-log",
    summary: "Who did what, and when, in the organization. Entries can never be edited or deleted.",
    question: "Who changed this record, when, and what exactly changed?",
    learn: [
      "What each action type means",
      "How the date filters work",
      "Why older entries can be missing from a broad search",
    ],
    whoUses:
      "Organization admins answering a compliance question or tracing an unexpected change. Use it when something looks wrong.",
    howToRead: [
      { label: "Timestamp", meaning: "When it happened, in your local time." },
      { label: "User", meaning: "Who did it." },
      {
        label: "Action",
        meaning:
          "What kind of change: CREATE, UPDATE, DELETE, STATUS_CHANGE, TOUCH_LOGGED, TERMINATION or READ. READ entries record that someone opened sensitive information.",
      },
      {
        label: "Entity",
        meaning:
          "The type of record and the start of its ID. Cases, providers and tasks link to the record.",
      },
      { label: "Description", meaning: "A short summary of the change." },
      {
        label: "Expanded row",
        meaning: "Shows the values before and after the change, for the fields that changed.",
      },
    ],
    counted: [
      "Every recorded action in the selected organization, newest first.",
      "Reads of sensitive information, as READ entries.",
    ],
    leftOut: [
      "Other organizations.",
      "Anything past the newest 1,000 entries that match your filters.",
    ],
    filtersAndExport: [
      "Select an organization first. Only organization admins can open this report.",
      "From and To are your local calendar days, and To includes the whole day. Also filter by User, Action and Entity, or use Reset filters.",
      "50 entries per page. No export, and filters aren't kept in the page link.",
    ],
    goodToKnow: [
      "The report loads at most the newest 1,000 matching entries and doesn't say when it hits that limit. Narrow the dates to look further back.",
      "The User and Entity lists are built from the entries loaded, so they shrink as you filter.",
      "If From is later than To, nothing is shown.",
    ],
    relatedReports: ["denials"],
    relatedTerms: ["audit-action", "touch", "case"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    reportKey: "leads",
    summary: "Website inquiries waiting for someone to convert or dismiss them.",
    question:
      "Who has asked about Minted Panel through the website, and which inquiries still need a decision?",
    learn: [
      "What converting a lead does",
      "Which leads the list shows",
      "What to do if a conversion half-finishes",
    ],
    whoUses:
      "Minted Panel sales and onboarding staff. Check it daily. The Reporting Center card shows a count when new leads are waiting.",
    howToRead: [
      {
        label: "Lead card",
        meaning:
          "The practice name, the contact's name, email and phone, and the date the inquiry arrived.",
      },
      {
        label: "Convert to org",
        meaning:
          "Creates a prospect organization with that name, makes you its admin, records the contact as its owner and marks the lead converted.",
      },
      { label: "Dismiss", meaning: "Removes the lead from the list without creating anything." },
    ],
    counted: ["New inquiries from the public contact form, newest first."],
    leftOut: ["Leads already converted or dismissed. There is no view of them here."],
    filtersAndExport: [
      "Covers every inquiry, so you don't need to pick an organization.",
      "No filters, search or export.",
    ],
    goodToKnow: [
      "Dismiss has no confirmation and can't be undone from this page.",
      "Converting fails when an organization with the same name already exists.",
      "If a conversion creates the organization but the lead stays in the list, don't convert it again. Dismiss the lead instead.",
      "Any staff member can convert or dismiss, including members with read-only billing access.",
      "If the list fails to load, it looks empty. Reload to be sure.",
    ],
    relatedReports: ["portfolio"],
    relatedTerms: ["organization", "org-stage"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
];

const ARTICLES_BY_KEY = new Map(
  [
    ...PERFORMANCE_ARTICLES,
    ...CREDENTIALING_ARTICLES,
    ...ROSTER_CONTRACT_ARTICLES,
    ...EXPLORER_AUDIT_LEADS_ARTICLES,
  ].map((article) => [article.reportKey, article]),
);

/** One article per registry entry, in registry order. A registry key with no
 * article is skipped here and fails reportingGuide.test.ts. */
export const REPORT_ARTICLES: readonly ReportArticle[] = [
  ...REPORTS.flatMap((report) => {
    const article = ARTICLES_BY_KEY.get(report.key);
    return article ? [article] : [];
  }),
  ...[...ARTICLES_BY_KEY.values()].filter((a) => !REPORTS.some((r) => r.key === a.reportKey)),
];

// ---------------------------------------------------------------------------
// Getting started and common questions
// ---------------------------------------------------------------------------

export interface GuideSection {
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
  /** Label / value rows, e.g. the industry timelines table. */
  rows?: readonly { label: string; value: string; note?: string }[];
  audiences?: readonly GuideAudience[];
}

export interface GuideTopic {
  id: string;
  title: string;
  summary: string;
  learn: readonly string[];
  sections: readonly GuideSection[];
  relatedReports: readonly string[];
  relatedTerms: readonly string[];
  audiences: readonly GuideAudience[];
  reviewStatus: GuideReviewStatus;
}

export interface GuideQuestion {
  id: string;
  question: string;
  answer: readonly string[];
  /** Where to look in the app to see the difference for yourself. */
  check?: string;
  relatedReports: readonly string[];
  relatedTerms: readonly string[];
  audiences: readonly GuideAudience[];
  reviewStatus: GuideReviewStatus;
}

const OVERVIEW_TOPIC: GuideTopic = {
  id: "overview",
  title: "How the Reporting Center works",
  summary: "What the Reporting Center covers, whose data you're looking at, and who can see what.",
  learn: [
    "How the reports are grouped",
    "Why most reports ask you to pick an organization",
    "Who can see which reports, and where exports exist",
  ],
  sections: [
    {
      heading: "Four groups of reports",
      audiences: INTERNAL,
      bullets: [
        "Performance: how the book of business and its locations are doing. Portfolio, Launches, Facilities Without Providers, Locations per Group.",
        "Credentialing: where applications, enrollment and contracts stand. Denials, Billing Readiness, Expiring Credentials, Roster Engine, Group Contracts Matrix, Enrollment Explorer.",
        "Compliance: who did what, and when. Audit Log.",
        "Intake: new inquiries from the website. Inbound Leads.",
      ],
    },
    {
      heading: "Your report",
      audiences: ["client"],
      paragraphs: [
        "Your Reporting Center has one report, Enrollment Explorer. It shows payer enrollment for your providers, by group, state, payer product and location.",
      ],
    },
    {
      heading: "Pick an organization first",
      audiences: INTERNAL,
      paragraphs: [
        "Most reports show one organization at a time: the one selected in the sidebar's organization switcher. Without one, the report asks you to select an organization. Portfolio and Inbound Leads cover all your organizations at once.",
        "Switching organization reloads the report and clears its filters.",
      ],
    },
    {
      heading: "Who sees what",
      audiences: INTERNAL,
      bullets: [
        "Minted Panel staff see all twelve reports.",
        "The Audit Log is for organization admins only.",
        "Billing members have read-only access. They can view reports but can't change roster mappings or export rosters, and saving a contract fails for them.",
        "Client users, such as practice owners and their teams, see only Enrollment Explorer, limited to the provider groups they're assigned and to enrollment Minted Panel has published.",
      ],
    },
    {
      heading: "Who sees what",
      audiences: ["client"],
      paragraphs: [
        "You see only the provider groups your organization has given you access to. Enrollment appears once Minted Panel has reviewed it and published it to you, and key dates appear when proof backs them.",
      ],
    },
    {
      heading: "Exports and sharing",
      audiences: INTERNAL,
      bullets: [
        "Denials: Export CSV.",
        "Billing Readiness: the Newly Billable Digest CSV.",
        "Enrollment Explorer: Download CSV, plus published proof documents.",
        "Roster Engine: payer roster files as CSV or Excel, with every export kept in export history.",
        "Portfolio is the only report you can share as a read-only link.",
        "The other reports have no export yet.",
      ],
    },
    {
      heading: "Exports",
      audiences: ["client"],
      paragraphs: [
        "Download CSV in Enrollment Explorer exports every enrollment record that matches your filters, one row per provider, group, payer product, location and state.",
      ],
    },
    {
      heading: 'Dates and "today"',
      paragraphs: [
        "Minted Panel works in calendar days. Reports that compare a date with today mostly use your computer's calendar date, and recorded times are shown in your local time.",
      ],
    },
    {
      heading: "Draft definitions",
      audiences: INTERNAL,
      paragraphs: [
        'Every article and term in this guide starts as a draft. A "Draft definition" chip marks wording that hasn\'t been confirmed against the live report yet. Client users never see the chip.',
      ],
    },
    {
      heading: "Help on every report",
      paragraphs: [
        'Each report has an "About this report" button in its header. It opens that report\'s article and terms without leaving the page.',
      ],
    },
  ],
  relatedReports: ["enrollment-explorer", "billing-readiness", "denials"],
  relatedTerms: ["organization", "group", "provider", "case", "published-enrollment"],
  audiences: EVERYONE,
  reviewStatus: "draft",
};

const TIMELINES_TOPIC: GuideTopic = {
  id: "timelines",
  title: "Typical industry timelines",
  summary:
    "How long credentialing, enrollment and their renewal cycles usually take across the industry.",
  learn: [
    "Typical ranges for first-time credentialing and payer enrollment",
    "How often re-credentialing, revalidation and CAQH re-attestation come around",
    "What usually makes an application take longer",
  ],
  sections: [
    {
      heading: "Read this first",
      paragraphs: [
        "These are typical industry ranges, not Minted Panel commitments. Every payer sets its own timelines, they vary by state and plan, and they change. Use them to set expectations and to spot an application that has gone quiet for too long.",
      ],
    },
    {
      heading: "Typical ranges",
      rows: [
        {
          label: "Initial credentialing",
          value: "About 60 to 120 days from a complete application.",
          note: "The payer verifies licenses, education, board status and work history, then a committee decides.",
        },
        {
          label: "Initial payer enrollment",
          value:
            "Commercial plans: often 60 to 120 days, sometimes 180 or more. Medicare: often 30 to 90 days. Medicaid: varies widely by state.",
          note: "Enrollment usually follows credentialing, and the effective date may be earlier or later than the approval date.",
        },
        {
          label: "Re-credentialing cycle",
          value: "Usually every 36 months (three years).",
          note: "Some contracts set a shorter cycle. The payer usually starts the request.",
        },
        {
          label: "Revalidation cycle",
          value:
            "Medicare: every five years for most providers. Medicaid: at least every five years, set by each state.",
          note: "Missing a revalidation deadline can pause billing privileges.",
        },
        {
          label: "CAQH re-attestation",
          value: "Every 120 days.",
          note: "Minted Panel flags a CAQH attestation older than 120 days as stale.",
        },
      ],
    },
    {
      heading: "What usually slows things down",
      bullets: [
        "An incomplete application or a missing document, such as a W-9, a malpractice certificate or a signed attestation.",
        "A lapsed CAQH attestation, or a CAQH profile that doesn't match the application.",
        "A license, DEA registration or malpractice policy that expires during the review.",
        "Requests for more information that sit unanswered.",
        "Payers that close their network to new providers in a specialty or area.",
      ],
    },
  ],
  relatedReports: ["denials", "expiring-credentials", "enrollment-explorer"],
  relatedTerms: [
    "credentialing",
    "enrollment",
    "recredentialing",
    "revalidation",
    "caqh",
    "effective-date",
  ],
  audiences: EVERYONE,
  reviewStatus: "draft",
};

export const GUIDE_TOPICS: readonly GuideTopic[] = [OVERVIEW_TOPIC, TIMELINES_TOPIC];

export const GUIDE_QUESTIONS: readonly GuideQuestion[] = [
  {
    id: "license-expired-mismatch",
    question:
      "Expiring Credentials says a license expired, but Billing Readiness doesn't flag it. Which is right?",
    answer: [
      "They read different records. Expiring Credentials reads uploaded files and their expiration dates. Billing Readiness reads the Licenses section of the provider record.",
      "Licenses are also checked per state. Billing Readiness looks only at the license for the selected location's state, so an expired license in another state doesn't affect it.",
    ],
    check:
      "Open the provider record and compare the Licenses section with the uploaded documents. Renew the file with Replace so both agree.",
    relatedReports: ["expiring-credentials", "billing-readiness"],
    relatedTerms: ["expiring-status", "billing-status", "psv"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "approved-but-not-billable",
    question: "Enrollment Explorer says Approved, but Billing Readiness says Do Not Bill. Why?",
    answer: [
      "Billing Readiness asks a narrower question with more checks. It looks at one clinician, at one location, with one payer, today. Beyond the approval it checks the license for that location's state, the group membership, the location assignment, the effective date and any termination.",
    ],
    check:
      'In Billing Readiness, pick the clinician, facility and payer and read "Why billing is held". Each line names the check that failed.',
    relatedReports: ["billing-readiness", "enrollment-explorer"],
    relatedTerms: ["billing-status", "approved", "effective-date"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "denials-count",
    question: "Denials lists more cases than the cases showing Denied. Why?",
    answer: [
      'The Denials report also keeps cases that were denied and later reapplied. Those rows show "Reapplied — now" followed by the current status. A case that is In Progress or Approved today can still appear.',
    ],
    check: "Read the Cycle column. Rows marked Standing are the cases still denied today.",
    relatedReports: ["denials"],
    relatedTerms: ["cycle-state", "reapply", "denied"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "launch-open-cases-no-providers",
    question: "Launches shows open cases at a location but zero providers. How?",
    answer: [
      "The two columns follow different rules. Providers leaves out terminated providers, test providers and assignments that haven't started. Open cases still counts cases for providers who have since been terminated, and a case counts at every location it is linked to.",
    ],
    check:
      "Open the location's group and check who is assigned and when each assignment starts. Close or reassign cases for providers who have left.",
    relatedReports: ["launches", "facilities-without-providers"],
    relatedTerms: ["assigned-provider", "open-case", "at-risk"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "unstaffed-but-listed",
    question:
      "Facilities Without Providers lists a location whose page shows providers. Is it wrong?",
    answer: [
      "Not necessarily. The report counts only current, eligible providers. A location whose only assignments are terminated providers, test providers or assignments starting in the future is listed, even though its page shows those names.",
    ],
    check: "Check each assigned provider's status and assignment start date.",
    relatedReports: ["facilities-without-providers", "launches"],
    relatedTerms: ["assigned-provider", "test-provider"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "location-count-mismatch",
    question: "Locations per Group shows fewer locations than the group page. Why?",
    answer: [
      "The report leaves out reference-only locations. The group page's count includes them.",
    ],
    relatedReports: ["locations-per-group"],
    relatedTerms: ["reference-only", "facility"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "audit-log-missing-entries",
    question: "The Audit Log seems to be missing older entries.",
    answer: [
      "The Audit Log loads at most the newest 1,000 entries that match your filters. With a wide date range, older entries fall outside that limit.",
    ],
    check: "Narrow From and To to the period you need.",
    relatedReports: ["audit-log"],
    relatedTerms: ["audit-action"],
    audiences: INTERNAL,
    reviewStatus: "draft",
  },
  {
    id: "provider-appears-twice",
    question: "Why does one provider appear under two groups?",
    answer: [
      "Payers contract with a group's tax ID. A provider who bills under two groups has a separate enrollment with each one, so they appear under each group's columns.",
    ],
    check:
      "In Enrollment Explorer, filter to that provider and look at the group in each column heading.",
    relatedReports: ["enrollment-explorer"],
    relatedTerms: ["tin", "group", "enrollment"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "approval-vs-effective-date",
    question: "Why doesn't the approval date match the effective date?",
    answer: [
      "They mean different things. The approval date is when the payer's approval was recorded. The effective date is the date the payer starts recognizing the enrollment. When a payer backdates coverage, the effective date can be weeks before the approval.",
    ],
    check: "Open the enrollment details in Enrollment Explorer to see both dates side by side.",
    relatedReports: ["enrollment-explorer"],
    relatedTerms: ["effective-date", "retro", "approved"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "needs-verification-changed",
    question: "A cell said Approved last week and now says Needs verification. What happened?",
    answer: [
      "Something behind the published enrollment changed, or the proof that backed it lapsed, for example an expired license verification. Details are held back until Minted Panel staff recheck the source. The last published status is still shown in the details.",
    ],
    relatedReports: ["enrollment-explorer"],
    relatedTerms: ["needs-verification", "enrollment-proof", "published-enrollment"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "csv-more-rows",
    question: "Why does my CSV have more rows than the screen?",
    answer: [
      "Enrollment Explorer's screen shows one row per provider and loads 50 providers at a time. The CSV covers every matching provider and has one row per provider, group, payer product, location and state.",
    ],
    check:
      "Filter the CSV to one provider to see how their screen row splits into enrollment rows.",
    relatedReports: ["enrollment-explorer"],
    relatedTerms: ["line-of-business", "facility"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
  {
    id: "date-off-by-one",
    question: "A date looks one day off. Why?",
    answer: [
      "Minted Panel works in calendar days, and recorded times are shown in your local time. Something recorded late in the evening in one time zone can show as the next day for someone in another.",
    ],
    relatedReports: [],
    relatedTerms: ["effective-date"],
    audiences: EVERYONE,
    reviewStatus: "draft",
  },
];

// ---------------------------------------------------------------------------
// Lookups, audience filtering and search
// ---------------------------------------------------------------------------

/** Nav ids that are not report keys. Report articles use their registry key. */
export const DICTIONARY_TOPIC_ID = "dictionary";
export const QUESTIONS_TOPIC_ID = "questions";
export const DEFAULT_TOPIC_ID = "overview";

function visibleTo<T extends { audiences: readonly GuideAudience[] }>(
  items: readonly T[],
  audience: GuideAudience,
): T[] {
  return items.filter((item) => item.audiences.includes(audience));
}

export function findReportArticle(reportKey: string): ReportArticle | undefined {
  return REPORT_ARTICLES.find((article) => article.reportKey === reportKey);
}

export function findGuideTerm(id: string): GuideTerm | undefined {
  return GUIDE_TERMS.find((term) => term.id === id);
}

export function findGuideTopic(id: string): GuideTopic | undefined {
  return GUIDE_TOPICS.find((topic) => topic.id === id);
}

export function topicsFor(audience: GuideAudience): GuideTopic[] {
  return visibleTo(GUIDE_TOPICS, audience).map((topic) => ({
    ...topic,
    sections: topic.sections.filter(
      (section) => !section.audiences || section.audiences.includes(audience),
    ),
  }));
}

/** A report article paired with its registry entry, for rendering. */
export interface GuideReport {
  report: ReportDef;
  article: ReportArticle;
}

/** Report articles the audience may read, in registry order. */
export function reportsFor(audience: GuideAudience): GuideReport[] {
  return REPORTS.flatMap((report) => {
    const article = findReportArticle(report.key);
    return article && article.audiences.includes(audience) ? [{ report, article }] : [];
  });
}

/** Report articles grouped like the Reporting Center index. */
export function reportGroupsFor(
  audience: GuideAudience,
): { key: ReportGroup; title: string; reports: GuideReport[] }[] {
  const visible = reportsFor(audience);
  return REPORT_GROUPS.map((group) => ({
    ...group,
    reports: visible.filter((entry) => entry.report.group === group.key),
  })).filter((group) => group.reports.length > 0);
}

/** A term as the audience reads it: client users get their own "where you
 * see it" when the term carries one. */
function asReadBy(term: GuideTerm, audience: GuideAudience): GuideTerm {
  return audience === "client" && term.clientWhereYouSeeIt
    ? { ...term, whereYouSeeIt: term.clientWhereYouSeeIt }
    : term;
}

/** One term for rendering, or undefined when the audience may not read it. */
export function guideTermFor(id: string, audience: GuideAudience): GuideTerm | undefined {
  const term = findGuideTerm(id);
  return term && term.audiences.includes(audience) ? asReadBy(term, audience) : undefined;
}

export function termsFor(audience: GuideAudience): GuideTerm[] {
  return visibleTo(GUIDE_TERMS, audience)
    .map((term) => asReadBy(term, audience))
    .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

export function questionsFor(audience: GuideAudience): GuideQuestion[] {
  return visibleTo(GUIDE_QUESTIONS, audience);
}

/** Related term ids, narrowed to terms the audience may read. */
export function visibleTermIds(ids: readonly string[], audience: GuideAudience): string[] {
  return ids.filter((id) => findGuideTerm(id)?.audiences.includes(audience));
}

/** Related report keys, narrowed to reports the audience may read. */
export function visibleReportKeys(keys: readonly string[], audience: GuideAudience): string[] {
  return keys.filter((key) => findReportArticle(key)?.audiences.includes(audience));
}

/** Every nav id the audience may open: topics, report keys, dictionary, questions. */
export function topicIdsFor(audience: GuideAudience): string[] {
  return [
    ...topicsFor(audience).map((topic) => topic.id),
    ...reportsFor(audience).map((entry) => entry.report.key),
    DICTIONARY_TOPIC_ID,
    QUESTIONS_TOPIC_ID,
  ];
}

/** A deep-linked topic, or the default when it is unknown or not visible. */
export function resolveGuideTopic(topic: string | undefined, audience: GuideAudience): string {
  return topic && topicIdsFor(audience).includes(topic) ? topic : DEFAULT_TOPIC_ID;
}

/** The title shown for a nav id. */
export function guideTopicTitle(id: string): string {
  if (id === DICTIONARY_TOPIC_ID) return "Data dictionary";
  if (id === QUESTIONS_TOPIC_ID) return "Common questions";
  return findGuideTopic(id)?.title ?? REPORTS.find((r) => r.key === id)?.title ?? id;
}

export interface GuideSearchResults {
  topics: GuideTopic[];
  reports: GuideReport[];
  terms: GuideTerm[];
  questions: GuideQuestion[];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function matches(query: string, parts: readonly (string | undefined)[]): boolean {
  const haystack = normalize(parts.filter(Boolean).join(" "));
  return normalize(query)
    .split(" ")
    .every((word) => haystack.includes(word));
}

/** One search over articles, terms and questions together. Every word in the
 * query must appear somewhere in the item (case-insensitive). */
export function searchGuide(query: string, audience: GuideAudience): GuideSearchResults {
  const q = normalize(query);
  if (!q) return { topics: [], reports: [], terms: [], questions: [] };
  return {
    topics: topicsFor(audience).filter((topic) =>
      matches(q, [
        topic.title,
        topic.summary,
        ...topic.learn,
        ...topic.sections.flatMap((s) => [
          s.heading,
          ...(s.paragraphs ?? []),
          ...(s.bullets ?? []),
          ...(s.rows ?? []).flatMap((r) => [r.label, r.value, r.note]),
        ]),
      ]),
    ),
    reports: reportsFor(audience).filter(({ report, article }) =>
      matches(q, [
        report.title,
        report.description,
        article.summary,
        article.question,
        article.whoUses,
        ...article.howToRead.flatMap((f) => [f.label, f.meaning]),
        ...article.counted,
        ...article.leftOut,
        ...article.filtersAndExport,
        ...article.goodToKnow,
        ...(audience === "internal" ? (article.staffNotes ?? []) : []),
      ]),
    ),
    terms: termsFor(audience).filter((term) =>
      matches(q, [term.term, ...(term.aka ?? []), term.definition, term.whereYouSeeIt]),
    ),
    questions: questionsFor(audience).filter((question) =>
      matches(q, [question.question, ...question.answer, question.check]),
    ),
  };
}

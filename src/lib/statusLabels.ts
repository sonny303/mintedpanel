// Single source for the status/payer label constants the app matches BY LABEL.
// Statuses and the pre-cred sentinel payer are identified across many surfaces
// by their exact label string (the codebase idiom — see CLAUDE.md "Semantics
// are matched by label"). These constants keep that one string in one place so
// the copies can never drift. Each value is the exact live string; changing one
// here changes behavior everywhere it is compared. Pure constants; no I/O.
//
// This is the single edit point for Epic 6's statuses-to-code work: the canonical
// per-track status set is assembled from these constants in
// `src/lib/canonicalStatuses.ts`.

/** The sentinel payer, matched by name and excluded from real-payer sets. */
export const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";

// --- Credentialing track labels ---
export const NOT_STARTED_LABEL = "Not Started";
/** Credentialing status label meaning the provider is active with the payer. */
export const IN_NETWORK_LABEL = "In-Network";
export const IN_PROGRESS_LABEL = "In Progress";
export const WAITING_ON_PROVIDER_LABEL = "Waiting on Provider";
export const SUBMITTED_LABEL = "Submitted";
export const APPROVED_LABEL = "Approved";
export const DENIED_LABEL = "Denied";
/** Owner opt-out credentialing labels — hidden from the Client Progress view. */
export const NOT_REQUIRED_LABEL = "Not Required";
export const OON_LABEL = "OON";

// --- Contracting track labels (Not Started / In Progress / Denied / In-Network
// / OON are shared with the credentialing constants above). ---
export const CONTRACTED_LABEL = "Contracted";

// --- The 8 governed contract-record labels (`ContractingStatusLabel`, synced
// into every org by migration 20260926160000). Not Started, In-Network and
// Denied are the shared constants above. ---
export const APPLICATION_SUBMITTED_LABEL = "Application Submitted";
export const CONTRACT_SIGNED_LABEL = "In Progress (Contract Signed)";
export const DENIED_APPEALED_LABEL = "Denied - Appealed";
export const DENIED_REAPPLIED_LABEL = "Denied - Reapplied";
export const OUT_OF_NETWORK_LABEL = "Out of Network";

// --- Location-track (launch) status labels. ---
export const PROSPECT_LABEL = "Prospect";
export const PLANNED_LABEL = "Planned";
export const INTERVIEWING_LABEL = "Interviewing";
export const PENDING_FULFILLMENT_LABEL = "Pending Fulfillment";
export const READY_FOR_LAUNCH_LABEL = "Ready for Launch";
export const LIVE_LABEL = "Live";
export const INACTIVE_LABEL = "Inactive";

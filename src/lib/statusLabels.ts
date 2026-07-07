// Single source for the status/payer label constants the app matches BY LABEL.
// Statuses and the pre-cred sentinel payer are identified across many surfaces
// by their exact label string (the codebase idiom — see CLAUDE.md "Semantics
// are matched by label"). These constants keep that one string in one place so
// the copies can never drift. Each value is the exact live string; changing one
// here changes behavior everywhere it is compared. Pure constants; no I/O.

/** The sentinel payer, matched by name and excluded from real-payer sets. */
export const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";

/** Credentialing status label meaning the provider is active with the payer. */
export const IN_NETWORK_LABEL = "In-Network";

/** Location-track (launch) status labels. */
export const PENDING_FULFILLMENT_LABEL = "Pending Fulfillment";
export const READY_FOR_LAUNCH_LABEL = "Ready for Launch";
export const LIVE_LABEL = "Live";

/** Owner opt-out credentialing labels — hidden from the Client Progress view. */
export const NOT_REQUIRED_LABEL = "Not Required";
export const OON_LABEL = "OON";

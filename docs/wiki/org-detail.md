# Org Detail

_Updated for: E6.6 (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

Journey B — org reality: the slim org record.

## Shipped with E6.1

- A slim Org Detail at `/org-detail` (old `/get-started` and
  `/admin/settings` links redirect here): org facts and contacts, People
  Enroll (parties), member management (relocated from the retired Settings
  page — invites and role changes work from here), capture-link reissue,
  and your profile (display name, feeds `{{user.*}}` fill tokens).
- The onboarding wizard is a one-time flow: no persistent nav entry — a
  Finish-setup banner shows while any wizard section is incomplete and
  disappears for good once every section is complete. Creating an org lands
  directly in the wizard.
- Group/facility/roster summaries moved to Groups.

## Shipped with E6.5/E6.6

- Resolution-identifier labels (the payer-relevant org setting) live here.
- Inbound-leads triage moved to Reporting Center › Intake (E6.6).
- The reason-code and queue-ranking editors are GONE (E6.6 fixed defaults —
  the denial word-list is the six seeded global codes; queue ranking runs
  the shipped order; both documented in the modules they affect).

# Org Detail

_Updated for: E6.1 (PR #201, 2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

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

## Target state

- Inbound-leads triage moves to Reporting Center › Intake _(E6.6)_; until
  then it renders here when leads await.

# Reporting Center

_Updated for: E6.6 (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

Cross-org reports, grouped by question type.

## Shipped with E6.6

Four groups on the index (adding a report stays one registry entry + one
route):

- **Performance** — Portfolio · Launches (locations with future or recent
  go-live dates, grouped by group, date-sorted; at-risk = go-live within 30
  days with open cases still pending or no providers assigned — date-only,
  no location statuses) · Facilities Without Providers · Locations per Group
  (the PM's counts-as-reports ruling: occasional counts are reports, never
  screen widgets).
- **Credentialing** — Denials (provider-first, payer-pivotable; every case
  carrying a denial with reason from the fixed word-list, date, and cycle
  state Standing / Reapplied-now-X; CSV export; same derivation as the
  provider record's Cases panel) · Expiring Credentials.
- **Compliance** — Audit Log (the `/admin/audit` page relocated with its
  filters; admin-gated; the ledger stays append-only). `/admin/audit`
  redirects here.
- **Intake** — Inbound Leads (triage moved off Org Detail; the index card
  badges the new-lead count only when leads await).

Org-scoped reports render inside the cross-org Center and gate themselves
("Select an organization…") when no org is active. Legacy URLs redirect:
`/launches*` → Launches, `/client-progress` + `/progress` → Denials,
`/portfolio` → Portfolio.

# Reporting Center

_Updated for: Reporting Guide (2026-10-20); E6.6 (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

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

## Reporting Guide (help and data dictionary)

The Reporting Center has its own self-service help: **Guide & definitions**
in the index header opens `/reporting/guide`, and every report header has an
**About this report** button that opens the same article in a side sheet with
the report's terms and an "Open full guide" link.

- **Sections** — Getting started (how the Reporting Center works, typical
  industry timelines labelled as industry ranges, not commitments), one
  article per report, an A–Z data dictionary (credentialing and enrollment
  basics, Minted Panel records, the eight case statuses, report labels and
  metrics), and common "why don't these numbers match?" questions. One search
  box filters articles, terms and questions together.
- **Deep links** — `?topic=<report key>` (for example
  `/reporting/guide?topic=denials`), `?topic=overview`, `?topic=timelines`,
  `?topic=dictionary`, `?topic=questions`, and a dictionary term with
  `?topic=dictionary&term=<term id>`. An unknown or hidden topic falls back to
  Getting started.
- **Audience** — client-audience users see only the Enrollment Explorer
  article, the basics, the case statuses and client-relevant terms; no text
  they can read names an internal report. `/reporting/guide` is on the
  client allowlist in `src/routes/__root.tsx` alongside `/reporting` and
  `/reporting/enrollment-explorer`.
- **Where the content lives** — one typed module,
  `src/lib/reportingGuide.ts`, keyed by the registry `key` in
  `src/lib/reports.ts`. Adding a report means adding its article there;
  `src/lib/reportingGuide.test.ts` fails until every registry key has one,
  every related term and report resolves, and no article exists for a key
  that isn't in the registry.
- **Review state** — every article, term and question carries
  `reviewStatus: "draft" | "confirmed"`. Drafts show a "Draft definition"
  chip to internal users only. Flip an entry to `confirmed` once the PM has
  validated it against the shipped report.
- **Accuracy rule** — the guide describes shipped behavior only, never the
  planned reporting suite. When a report changes, update its article in the
  same PR.

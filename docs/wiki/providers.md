# Providers

_Updated for: E6.4 (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

Journey B — the consolidated people record.

## The roster — shipped with E6.4

- **A→Z by last name, always** (stated on screen; search and filters never
  change the sort). PHI-safe list: no DOB, SSN, or home address ever rides
  the roster read. Filters: group, license state, has-gaps; free search on
  name/NPI; Export roster CSV.
- **Gap pills are ambient**: no facility assignment (the provider cannot
  generate cases), missing NPI/CAQH, stale CAQH attestation (the readiness
  window), expiring/expired license. Clicking a pill opens the record with
  that exact section focused.
- The provider CSV **lives on this page** (one row per relationship —
  repeat identity columns for extra facilities, groups, licenses, and
  enrollments). The template download comes with a **reference sheet of
  your real group/facility/payer names**; unknown names are row errors
  naming the column, and the post-commit summary counts every relationship
  attached.

## The record — shipped with E6.4

- One page per provider with section jump-nav: Identity · Groups &
  facilities · Licenses · Enrollments · Cases · Documents (deep-linkable
  `#section` anchors).
- **Every identity field edits inline** — pencil, change, save; one audited
  write per field. The monolithic edit form is retired (its URL redirects
  here), which kills the defect where saving it dropped facility
  assignments. DOB is masked at rest (reveal on edit); SSN stays last-4
  with the vault flow.
- **Groups & facilities are managed in place**: membership chips (primary
  starred, ≥1 group / one-primary invariants hold on every path) and a
  first-class **+ Add facility** with a start date — the moment it saves,
  the provider is generatable and the group's buffer updates. No edit
  elsewhere on the record can touch assignments.
- **Enrollments panel** records migration facts (payer, state, effective
  date) under a group's contract — never a case; prior-employer status
  never belongs here. **Expire** flips the fact and immediately re-opens
  the candidate on the board.
- **Cases panel** is read-only: one line per case with the unified status
  pill, prior denials preserved beneath reapplied cycles, and
  "x of y approved" in the header.
- **Creating a provider creates ZERO cases** (E6.3) — the record's
  **Review & generate** opens the shared grid scoped to this provider.

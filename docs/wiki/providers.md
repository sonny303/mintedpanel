# Providers

_Updated for: E6.4 plus Add Provider taxonomy / facility start-date fixes (PR #286 / #287, 2026-08-11). Pages describe the shipped app; target-state notes are marked with their epic._

Journey B — the consolidated people record.

## The roster — shipped with E6.4

- **A→Z by last name, always** (stated on screen; search and filters never
  change the sort). PHI-safe list: no DOB, SSN, or home address ever rides
  the roster read. Filters: group, license state, has-gaps; free search on
  name/NPI; Export roster CSV.
- **Gap pills are ambient**: no facility assignment (the provider cannot
  generate cases), missing NPI/CAQH, stale CAQH attestation (the readiness
  window), expiring/expired license. Clicking a pill opens the record on
  the matching tab (`#identity` / `#groups-facilities` / `#licenses`, and
  readiness under Cases).
- The provider CSV **lives on this page** (one row per relationship —
  repeat identity columns for extra facilities, groups, licenses, and
  enrollments). The template download comes with a **reference sheet of
  your real group/facility/payer names**; unknown names are row errors
  naming the column, and the post-commit summary counts every relationship
  attached.

## Add provider — shipped

- **Taxonomy is a dropdown**, not free text: NUCC codes for the specialties
  we enroll (PT + dietitian today). Specialty label stays editable beside
  it when needed.
- **Facility assignment requires a start date.** Saving without one used to
  fail with a raw database toast; the form now collects the date and the
  error reads as a sentence if anything else is missing.
- **Creating a provider creates ZERO cases** (E6.3) — open **Generate
  cases** from the record (or the readiness section) to enter the shared
  grid scoped to this provider.
- _(Lands with PR #288)_ Onboarding harden: clearer group join on create
  and a trimmed create-field set so the first save matches what the roster
  actually needs.

## The record — shipped

- **Tabbed record** (not one long scroll): Provider Info · Groups &
  facilities · Licenses · Enrollments · Cases · Documents · Internal
  Notes. Deep links still work — roster gap pills and readiness fix-here
  anchors open the right tab.
- **Provider Info** edits through one **Edit details → Save changes** pass
  (diff-only audited patch). DOB is masked at rest (reveal in edit); SSN
  stays last-4 with the vault flow. Home address and malpractice are not
  on this form (malpractice lives on the group).
- **Groups & facilities are managed in place**: membership chips (primary
  starred, ≥1 group / one-primary invariants hold on every path) and a
  first-class **+ Add facility** with a start date — the moment it saves,
  the provider is generatable and the group's buffer updates. No edit
  elsewhere on the record can touch assignments.
- **Enrollments panel** records migration facts (payer, state, effective
  date) under a group's contract — never a case; prior-employer status
  never belongs here. Approved cases also derive a read-only “From case”
  enrollment row.
- **Cases panel** is read-only case lines plus the advisory **Readiness**
  matrix for this provider (filters + fix-here links).

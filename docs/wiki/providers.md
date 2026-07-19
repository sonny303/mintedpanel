# Providers

_Updated for: pre-E6 baseline (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

Journey B — the consolidated people record.

## Today (pre-E6)

Provider roster + a monolithic edit form (with a known defect: saving it
could drop facility assignments); imports live on a separate Data Import
page.

## Target state _(lands with E6.4)_

- A→Z roster (PHI-safe list) with search/filters.
- One-page provider record with inline field editing (the monolithic form
  retires, fixing the assignment-wipe defect).
- In-place Add facility / Add group; per-payer case + denial history.
- Migration enrollments are enrollment FACTS, never auto-cases — "active
  under THIS group's contract" only; expiring a fact re-opens the candidate.
- Imports live here (relationship CSV; one row per relationship).

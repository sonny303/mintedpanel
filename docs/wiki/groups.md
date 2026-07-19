# Groups

_Updated for: pre-E6 baseline (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

Journeys B and C — the working entity for payer attach and generation.

## Today (pre-E6)

No Groups surface; payers were attached at org grain and facilities lived on
a flat page.

## Target state _(lands with E6.2 + E6.3)_

- Groups menu item; single-group orgs auto-land.
- Facilities belong to exactly ONE group, state-grouped A→Z.
- Payer Network board at group × payer × state: Targeted → In Progress →
  Active (derived, most-advanced-case-wins; Active = ≥1 approved case OR an
  enrollment fact).
- Generation is the ONLY door cases come through: candidates accumulate in a
  visible awaiting-generation buffer; the preview grid (provider×payer,
  pivotable) distinguishes Skip-for-now from Exclude (reasoned, restorable);
  the confirm bar reconciles buckets to the target count. A human always
  confirms.

# Groups

_Updated for: E6.2 (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

Journeys B and C — the working entity for payer attach and generation.

## The Groups front door

- **Groups** (org zone of the sidebar) opens the A→Z group list; a
  single-group org auto-lands on its only group's hub with zero extra
  clicks. Zero groups points at the setup wizard's Provider Group section.
- Every nested page carries the breadcrumb `Groups › {Group} › {Area}`;
  every crumb navigates.

## The group hub

- **Group facts** — legal name, TIN (shown XX-XXXXXXX), operating states —
  editable inline by admins (audited through the same group update the
  wizard uses). Address/contact blocks stay in the wizard's full group form.
- Two area doors with live counts: **Facilities** and **Payer Network**.

## Facilities (`Groups › {Group} › Facilities`)

- Search on top; **state-grouped, A→Z within state**; filters for state and
  has-providers; per-row provider counts with an informational zero-provider
  flag (a location without providers cannot generate cases).
- Facility CRUD lives here (create/edit through the shared facility form;
  deactivate is a soft delete — never a row delete). **Go-live date is a
  plain date field** — it feeds the Launches report; there is NO location
  status machine.
- Each facility belongs to exactly ONE group: a street address shared by two
  groups is entered once per group (payers see per-TIN service locations).
  The facility CSV import lives on this page and its template documents the
  rule.

## Payer Network (`Groups › {Group} › Payer Network`)

- **The fulfillment board** — the contract's promise-vs-reality screen,
  alive from day 1 with zero providers. One row per targeted payer with a
  DERIVED pill: `Targeted` (target exists, no case, no fact) ·
  `In Progress` (≥1 open case, with the count) · `Active` (≥1 Approved case
  OR a live enrollment fact, with "since" when dated). Nobody can set any
  value on the board — approving a case or recording/expiring a fact flips
  the row on the next render with no board-side write.
- Drill a payer row to see each provider's per-state evidence: the case (its
  unified status, with denial history preserved beneath reapply cycles), an
  enrollment fact ("Active with zero cases"), a standing exclusion (reason +
  one-click Restore), or an awaiting-generation candidate.
- **The candidates banner** counts the buffer (targets − enrollment facts −
  existing cases − standing exclusions, per eligible provider — the same
  math E6.3's grid consumes) and names its most recent cause ("Dr. Chen
  joined Sep 3"). The Review & generate action arrives with E6.3.
- **Attach payers to the group**: the picker offers only catalog payers
  whose covered states intersect the group's operating states (zero-overlap
  payers are named in an explainer, never offered); proposed states = payer
  coverage ∩ group operating states, reviewed before save. The org-level
  enablement is created implicitly — no screen manages it. A CSV
  alternative (one row per group × payer, `;`-delimited states) rides the
  staged-import engine with the same eligibility checks at scan time and an
  idempotent skip-on-match commit.
- **Removing a payer archives** the group's targets (never deletes); the
  org-level enablement archives only when no other group still works the
  payer. Re-attaching restores the archived targets without duplicates.

## Enrollment facts (the migration model)

A fact records "already enrolled with this payer UNDER THIS GROUP'S
CONTRACT" at provider × group × payer × state. Facts count a payer toward
Active, suppress generation candidates, and **never create cases**. Expiry
is a flip, never a delete — expiring immediately re-opens the candidate.
Capture UI lands with E6.4 (provider record + onboarding).

## Target state _(lands with E6.3)_

- Generation is the ONLY door cases come through: the board's Review &
  generate opens the preview grid (provider×payer, pivotable), Skip-for-now
  vs Exclude, and the reconciling confirm bar. A human always confirms.

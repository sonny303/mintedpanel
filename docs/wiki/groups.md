# Groups

_Updated for: E6.3 plus GEN-SILENT skip reasons (2026-08-11). Pages describe the shipped app; target-state notes are marked with their epic._

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
  math the grid consumes) and names its most recent cause ("Dr. Chen
  joined Sep 3"). **Review & generate** (on the banner, and per payer row)
  opens the shared generation grid pre-scoped to this group — the payer-row
  entry additionally scopes to that payer and opens grouped by payer.
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

## Review & generate — shipped with E6.3

Generation is the ONLY door cases come through (the manual one-off case
modal remains as the documented escape hatch; reapply continues the SAME
case). The board's banner, each payer row, a facility row, and the provider
record all open the ONE shared preview grid, pre-scoped to their slice:

- **Every provider × payer target lands in exactly one bucket** — candidate
  (checked by default), enrolled (live fact, grayed, never casework),
  existing case (grayed with its reason), or excluded (reasoned, with a
  one-click Undo). The confirm bar's reconciliation line always sums:
  "Create 4 · 1 excluded · 2 enrolled — 7 of 7 accounted for". A missing
  expected case is never gone — it is in another bucket with a named reason.
- **Pivot by provider or by payer** — same rows, two groupings, per-header
  check-alls; the entry point picks the default (a payer-row entry opens
  grouped by payer).
- **Skip-for-now vs Exclude are different intents**: unchecking a row skips
  it with no reason and no ceremony — it stays in the buffer and reappears
  checked next time. Exclude… records the reasoned, persistent opt-out
  (restorable in one click, on the grid and on the board).
- **Confirm** runs the per-row transactional creation: cases are born Not
  Started with SOP version stamps (generic-fallback usage is flagged before
  confirm and recorded on the run), one immutable run + per-candidate
  ledger row for EVERY bucket (created / skipped / excluded / enrolled /
  already-existing / failed), concurrent duplicates degrade to safe skips,
  and partial failure names the failed rows and stays on the grid. Full
  success lands on Cases filtered to the run.
- **Nobody drops out silently.** A group member under an active target who
  never reaches a bucket is listed above the grid with the reason: **no
  facility assignment under this group** (in the group, but at none of its
  clinics — so there is nothing to enroll into) or **pending verification**
  (not yet eligible to generate). Each line links to the provider so the fix
  is one click away. This explains drops; it is NOT a new gate and it changes
  no count — the buffer math is unchanged. Terminated, reference-only and
  test providers are never listed, and a license gap is not a skip reason:
  it rides readiness on a row that DOES generate.

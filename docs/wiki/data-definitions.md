# Data definitions

_Updated for: Add Provider first-facility-as-primary (2026-08-14); E6.4 (PR #207) plus GEN-SILENT skip reasons (2026-08-11). Plain-English definitions of the
data the app shows and stores. Terms are grouped by the surface where you
meet them; each definition describes the SHIPPED behavior on `redesign`._

## Core entities

- **Organization (org)** — the customer account. Everything you see is
  scoped to the active org; no data crosses orgs.
- **Group** — the working entity for contracting: a legal entity with a TIN
  and operating states. Payers attach at the group grain; facilities belong
  to exactly one group.
- **Facility** — a physical location owned by one group. The same street
  address may exist independently under two different groups. A facility's
  go-live is a plain date — there is no location status machine.
- **Provider** — the consolidated people record: identity (NPI, CAQH, DOB,
  licenses), group memberships (one primary), facility assignments,
  enrollments, cases, and documents — all on one page.
- **Payer** — an insurance plan from the shared platform catalog. Orgs
  subscribe to catalog payers; payer facts (names, states, kinds) are
  platform-governed, not org-editable.
- **Case (credentialing case)** — one unit of credentialing work, unique per
  provider × group × payer × state. Cases are born through the generation
  grid (the one door); the manual one-off modal is the documented escape
  hatch.
- **Party / People Enroll** — a person connected to the org (owner, customer
  escalation contact, sales rep, etc.), managed from Org Detail. One person
  can hold several roles.

## Case status (the eight-word list — E6.0)

Every case shows exactly ONE status; the list is fixed and code-owned:

| Status          | Meaning                             | How it's set                                                                                                    |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Not Started     | Case exists; no recorded work yet   | Automatic at creation                                                                                           |
| In Progress     | Work has been recorded              | Automatic on first touch, task completion, or real fill; also the state a reapply returns to                    |
| Submitted       | The application reached the payer   | Automatic on an extension-logged submission; fax/mail is never presumed — you log the touch and accept the bump |
| In Review       | The payer confirmed it is reviewing | Human, from payer knowledge                                                                                     |
| Action Required | The payer asked for something (RFI) | Human                                                                                                           |
| Approved        | The payer approved                  | Human; requires the effective date and the payer's provider ID under the payer's own label (e.g. "PTAN")        |
| Denied          | The payer denied                    | Human; requires a reason from the fixed list                                                                    |
| Not Pursuing    | Deliberately stopped                | Human; requires a note                                                                                          |

- **Evidence-based transition** — the system only sets what it witnessed;
  humans set what they learned. Every change lands in the status history
  with its evidence (e.g. the touch) linked.
- **Reapply** — returns the SAME denied case to In Progress with a fresh
  task cycle; the prior denial stays visible underneath. Never a second
  case.
- **Correction** — an admin-only backward status fix. It APPENDS a marked
  entry to the history; the original entry always stands.
- **Status history** — the append-only trail of every status change on a
  case. Nothing in it is ever edited or deleted.

## Casework terms

- **Touch** — one logged contact or piece of work on a case (call, email,
  portal check). Touches are append-only: corrections add a new entry
  marked "Correction of …". A touch can carry a follow-up date; notes never
  reset the cadence clock.
- **Task** — one checklist step stamped onto a case from its SOP at
  creation/reapply time, with the SOP version recorded.
- **To-do pivot (Cases)** — the ranked queue: overdue/arrived follow-ups →
  task due dates → provider start dates → the rest; each entry names its
  reason. The order is the fixed shipped default (E6.6 — no org config).
- **"x of y approved"** — a derived rollup: approved cases over all cases in
  the slice (per provider, per payer, or per group × payer). Always
  computed live from case statuses, never stored.

## Groups & Payer Network terms (E6.2)

- **Targeted payer** — a payer the group intends to enroll with in given
  states (a payer-network target row). Removal archives, never deletes.
- **Fulfillment pill** — the one derived state per targeted payer row:
  **Targeted** (nothing open yet) → **In Progress** (open cases, with
  count) → **Active** (at least one approved case OR a live enrollment
  fact, with "since" = the earliest approval/effective date).
- **Enrollment fact** — a record that a provider is ALREADY enrolled with a
  payer under the group's contract (typically brought over at migration),
  at provider × group × payer × state with an effective date. Facts make
  the pill Active and suppress generation candidates, but never create
  cases. Expiry is a flip (dated, audited), never a delete — an expired
  fact re-opens the candidate.
- **Eligibility (attach)** — a payer can be attached to a group only where
  the payer's states overlap the group's operating states; the proposed
  states are payer ∩ group. Both the dialog and the CSV share one rule.

## Generation terms (E6.3)

- **Skipped before candidacy** — a group member under an active target who
  never becomes a candidate at all, listed above the grid with its reason
  instead of vanishing. Two reasons ship: **no facility assignment under this
  group** and **pending verification**. It is an explanation, not a bucket and
  not a gate — a skipped provider is in no run ledger row and changes no
  count. Terminated, reference-only and test providers are never listed.
- **Candidate** — a provider × payer × state combination that could become a
  case: in the group's targets, not already a case, not enrolled by a live
  fact, not excluded.
- **Buffer (awaiting generation)** — the visible count of candidates that
  accumulated since the last run (provider joined, payer attached, fact
  expired). Nothing is created until a human confirms.
- **Skip for now** — unchecking a row in the grid. Selection state only:
  nothing is stored, the candidate stays in the buffer and reappears
  checked next time. In the run ledger the row records as `skipped`.
- **Exclude** — a reasoned, persistent decision not to pursue a candidate.
  Restorable in one click (the record is void-flipped, never deleted).
- **Generation run** — one confirmed batch. The run ledger records EVERY
  candidate's disposition: created, skipped (for now), excluded, enrolled
  (covered by a fact), already existing, or failed — so the reconciliation
  line always sums to the whole ("Create 4 · 1 excluded · 2 enrolled — 7 of
  7 accounted for").

## Provider terms (E6.4)

- **Gap pill** — an ambient flag on the roster naming what blocks or risks a
  provider: no facility assignment, missing NPI/CAQH, stale CAQH, expiring
  or expired license. Reference-only and terminated providers never gap.
- **CAQH date / stale CAQH** — the last CAQH attestation date; stale means
  older than the readiness window.
- **Primary group** — exactly one of a provider's group memberships is
  primary (starred). A provider always keeps at least one group.
- **Primary location** — exactly one of a provider's facility assignments
  is primary (starred). Add Provider marks the first picked facility as
  primary; change it later with **Make primary** on the record.
- **Reference-only** — a provider kept for records but excluded from active
  work queues, generation, and gap pills.

## Documents & sensitive data

- **Document** — a stored file on a provider or group (license, COI, W-9…),
  versioned: re-upload adds a version, never overwrites. Dated kinds
  require an expiration; 90/60/30-day thresholds drive the expiring view.
  Downloads are short-lived signed links, always audited.
- **SSN (vault)** — the full SSN lives ONLY in the server-side vault;
  ordinary tables carry last-4 only. Reveal is admin-only with a recorded
  justification. DOB renders masked at rest.
- **Audit log** — the append-only record of every sensitive read and write.
  Never edited, never deleted.

## Ledgers (append-only, everywhere)

`touches`, `status_history` / case status history, generation run rows, and
the audit log are history: the app only ever ADDS rows. Corrections append a
marked entry; nothing is rewritten. This is enforced in the database, not
just the UI.

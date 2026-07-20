# Cases

_Updated for: E6.3 (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

The home of Journey D (casework).

## Case status — shipped with E6.0

- Every case shows exactly ONE status from the fixed eight-word list:
  Not Started → In Progress → Submitted → In Review → Action Required →
  Approved | Denied (reason required) | Not Pursuing. The list is code-owned;
  there is no per-org status configuration (Admin › Statuses is retired and
  redirects to Cases).
- Statuses move on evidence. The system sets what it witnessed: creating a
  case (Not Started), the first recorded work — a touch, task completion, or
  a real fill (In Progress), and an extension-logged submission (Submitted).
  Humans set what they learned — payer calls, RFIs, letters — from the case
  header's status control or by accepting the suggestion when logging a
  touch. Fax/mail submissions are never presumed: you log the touch and
  accept the Submitted bump.
- Approved asks for the effective date and the payer's provider ID under the
  payer's own name for it (e.g. "PTAN" for Medicare). Denied requires a
  reason from the fixed list. Reapply returns the SAME case to In Progress
  with a fresh task cycle — the prior denial stays visible underneath.
- Admin corrections (any target, note required) APPEND to the history with a
  Correction marker; the original entry always stands.
- The full status trail lives on the case detail's history panel, with the
  evidence touch linked on each row.

## One Cases surface — shipped with E6.1

- Cases is the app's default landing (post-login and `/`). `/home` and
  `/work` redirect here; `?run=` batch links are preserved.
- Three pivots over the SAME open cases, held in the URL (`?pivot=`):
  - **To-do** (default) — the ranked queue: overdue/arrived follow-ups →
    task due dates → provider start dates → the rest; each entry names its
    reason. The ranking is the fixed shipped order (E6.6 — no org config).
  - **By provider** and **By payer** — list slices with per-group
    "x of y approved" rollups, chips, search, tracking-id lookup, and bulk
    actions. Legacy list links (`?chip=`, `?ids=`, `?runId=`) land on the
    payer pivot unchanged.
- Case detail (`/cases/$id`) deep links are unchanged.

## How cases get created — shipped with E6.3

- **One door**: cases are created through the generation grid (Groups ›
  {Group} › Payer Network › Review & generate) after a human confirm — see
  the Groups page for the grid itself. Onboarding a provider creates ZERO
  cases; new candidates surface counted on the group's board instead.
  Starter cases and the launch-dialog batch creator are retired.
- **The documented escape hatch**: the manual "New case" modal (Cases list
  and the provider record) remains for genuinely untargeted one-offs — same
  4-part key discipline, duplicate pre-check with a link to the existing
  case, no generation run id.
- **Reapply is continuation, not creation**: a denied case returns to In
  Progress on the SAME case with a fresh task cycle.
- A confirmed batch lands here filtered to its run (`?run=`), with the
  created cases ranked in the to-do pivot.

## Target state

- "Add touch" becomes the one logging action with multi-case select _(lands
  with E6.6)_.

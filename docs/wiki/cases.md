# Cases

_Updated for: E6.0 (PR #199, 2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

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

## Today (pre-E6.1 layout)

Work still lives across `/work` (My Cases queue), `/cases` (org case list),
and per-case detail pages.

## Target state _(lands with E6.1)_

- One merged Cases route becomes the app's default landing, with a ranked
  to-do pivot.
- "Add touch" becomes the one logging action with multi-case select _(lands
  with E6.6)_.

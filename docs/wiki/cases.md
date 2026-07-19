# Cases

_Updated for: pre-E6 baseline (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

The default landing surface and the home of Journey D (casework).

## Today (pre-E6)

Work lives across `/work` (My Cases queue), `/cases` (org case list), and
per-case detail pages. A case carries two parallel status machines (internal
credentialing track + payer pipeline).

## Target state _(lands with E6.0 + E6.1)_

- One merged Cases route is the app's default landing, with a ranked to-do
  pivot.
- Every case shows exactly ONE status from the fixed eight-word list:
  Not Started → In Progress → Submitted → In Review → Action Required →
  Approved | Denied (reason required) | Not Pursuing.
- Statuses move on evidence: the system sets what it witnessed (creation,
  first activity, extension-logged submission); humans set what they learned
  (payer calls, RFIs, letters) from the case header or the Add-touch prompt.
- "Add touch" is the one logging action _(lands with E6.6)_.

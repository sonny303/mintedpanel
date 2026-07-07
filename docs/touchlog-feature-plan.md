# Touchlog feature — consolidated plan & status

Touchlog becomes the single case-activity spine. The app (Minted Panel) owns the
data model, taxonomy, and batch touchpoint; the Workbench extension consumes it
and writes back during fill/submit. This file is the running PR trail for the
whole feature — keep it honest as PRs land.

## Locked decisions (from the spec)

| Item | Call |
|---|---|
| Payer reference / submission ID | One field on the case, latest wins |
| The note stores | Full merge into touchlog; notes optionally task-linked |
| Submit through the extension | Marks the linked task done |
| Close-a-case off touchlog | Out of scope, later feature |
| Batch: what you select | Cases directly, scoped to one payer + channel |
| Batch: storage | One parent `communication_event`, one child touchpoint per case |
| Batch: notes | Per case, own box, no shared call note |

**Additive-rule reconciliation (important):** `AGENTS.md` forbids dropping or
restructuring tables/columns, and `touches` is append-only. Story 1's "remove the
old stores" is therefore implemented as **keep-dormant**: the `notes` rows migrate
into the touchlog, the app stops reading/writing `notes` for case/task entities,
and the `notes` table stays in place (provider notes still use it). Nothing is
dropped. A hard-remove would need an explicit rule override.

## Verify-items (confirmed in-repo)

| Item | Finding |
|---|---|
| `entry_type` already exists? | No. `touches` was touchpoint-only; added `entry_type` |
| Where task comments + case notes live | One polymorphic `notes` table (`entity_type` case/task/provider) |
| Extension knows `task_id` at submit? | **No** — it knows `caseId` + `fillSessionId` only. Story 7 resolves the task server-side |
| Case → one payer? | Yes: `payer_id NOT NULL`, unique `(provider,payer,state)`. Batch scoping is clean |
| Filler exposes field map + required fields? | Yes: `/api/portal-field-maps` + `/api/providers/:id/profile` `unresolved[]`. Story 9 diffs these |

## PR sequence & status

### PR A — Foundation (app): Stories 1, 2, 3 — **DONE (this session)**
Schema (repo migrations + applied hosted):
- `20260707120000_touchlog_entry_types.sql` — `touches.entry_type` (touchpoint |
  note | system_event | task_update), nullable `touch_type`/`outcome`, new
  `task_id` + `communication_event_id`, widened channel (`+mail`) and the Story 3
  outcome taxonomy in the CHECK, a touchpoint-shape CHECK, indexes.
- `20260707120100_migrate_notes_to_touchlog.sql` — copy case/task `notes` →
  touchlog `note` entries, preserving author + timestamp; idempotent; backup step
  documented (`notes_pre_touchlog_backup` created on hosted).
- `20260707120200_case_payer_reference_id.sql` — `credential_cases.payer_reference_id`.

App:
- `src/lib/touchOutcomes.ts` (+test) — channel-aware taxonomy (Story 3).
- `src/services/touches.ts` — `logNote`, `getTaskTouchlog`, entry_type on inserts;
  stalled/follow-up reads scoped to touchpoints.
- `src/services/cases.ts` — `setPayerReference`; case notes derived from touchlog.
- Hooks: `useLogNote`, `useTaskTouchlog`, `useSetPayerReference`.
- UI: `CaseTouchesPanel` is now the unified timeline (all entry types, Add
  touch/Add note, "Got reference number" → payer reference); `TaskDrawer` and
  `/tasks/$id` render the task-filtered slice; payer reference row on case detail.

### PR B — Batch touchpoint (app): Story 8 — **DONE (this session)** (depends on A)
- Migration: `communication_event (id, org_id, payer_id, channel, occurred_at,
  created_by, created_at)` + FK `touches.communication_event_id`, RLS mirroring
  `payers`/`touches`.
- Service `communicationEvents.ts` — one parent + N child touchpoints in a
  transaction (or ordered inserts); each child a `touchpoint` with
  `communication_event_id` set, its own outcome + note.
- UI in Cases workflow: pick payer + channel, multi-select cases scoped to that
  payer, per-case outcome (Story 3 taxonomy) + own note box, no shared note. Row
  renders "Part of {payer} {channel} call, N cases"; "Got reference number" →
  that case's payer_reference_id.

### PR C — Extension-facing server endpoints (app) — **DONE** (depends on A)
No migration — every column already existed (`touches.entry_type`/`task_id`,
`credential_cases.payer_reference_id`).
- Extended `POST /api/cases/:id/touches` (`submissionTouches.ts`): optional
  `payer_reference_id` overwrites the case's latest-wins reference (Story 5,
  audited as a case UPDATE); optional `wip_note` → a touchlog `note` entry,
  task-linked when known (Story 6); every submit writes a `system_event` "Form
  submitted to {payer}"; the explicit `task_id` the extension supplies is
  org-validated, marked done, and recorded as a `task_update` entry (Story 7);
  optional `pdf_filename` → a second `system_event`.
- Read fields on `GET /api/cases` (`providerCases.ts`): `payerReferenceId`
  (Story 5 prefill), author-resolved `latestNote` (Story 11), and
  `lastSubmittedAt` — the most recent submission touchpoint's `outcome
  'submitted'` timestamp, a more robust signal than text-matching the
  system_event (Story 10 duplicate guard).
- Gate: new assertion 13 (a cross-org `task_id` on a submission touch is a 404
  before any write) + a `tasks` leak mode in the mock; the in-sandbox gate is
  green on the correct server and red on all 10 leak modes. Types regenerated.
- **Story 7 close-decision (2026-07-07):** option (c) — the extension passes an
  explicit `task_id`; the server org-validates and closes it (chosen over the
  fill_session route, which would have needed a `fill_sessions.task_id` column
  the table doesn't have). Closes nothing when the extension supplies no task.

### PR D — Workbench extension: Stories 4, 5, 6, 7, 9, 10, 11 — **DONE** (depends on A + C)
minted-extension `claude/autonomous-task-completion-raagkt`; typecheck + lint +
build clean. Vanilla TS + DOM — no runtime harness in-sandbox; verified via a
CSS/DOM screenshot smoke test.
- 4: NPI, license #, CAQH ID, TIN/EIN, DEA on the card with copy buttons, greyed
  empty state. The worker projects the five non-PHI identifiers from the profile
  tokens it already fetches (`GET_PROVIDER_FACILITIES`) — the PHI payload never
  crosses.
- 5: "Payer reference / submission ID" box at the bottom of fill; prefills from
  the case's `payerReferenceId`; overwrites on submit.
- 6: WIP note box → touchlog note entry on submit.
- 7: submit sends the write-back body; the server writes the system_event and
  closes a task when `task_id` is supplied. v1 has no task source, so `task_id`
  stays undefined (plumbing ready per decision (c)).
- 9: field-gap flag before submit (skipped + needs-manual count), shown first;
  submit stays allowed.
- 10: duplicate-submission guard from `lastSubmittedAt` (14-day window) — first
  click warns + re-labels to "Log anyway", the next logs it.
- 11: the selected case's latest touchlog note under the case picker.

## Out of scope (captured, not built)
- Closing a case off touchlog (later feature).
- Multi-reference history on the case field (latest-wins only; history in touchlog).
- Batch touchpoints from the extension (Panel Cases workflow only).
- Copy-email-body button (deferred until email templates settle).

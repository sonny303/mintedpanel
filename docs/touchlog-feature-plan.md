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

### PR C — Extension-facing server endpoints (app) — **PLANNED** (depends on A)
- Extend `POST /api/cases/:id/touches` (or add fields) to optionally: write
  `payer_reference_id` (Story 5); write a WIP `note` entry with `task_id` (Story 6);
  server-resolve the case's open submission task → mark done + write `task_update`
  and `system_event` "Form submitted to {payer}" entries (Story 7); PDF
  `system_event` (Story 7).
- New read slice `GET /api/cases/:id/touchlog?...` (or fields on `/api/cases`):
  most-recent `note` (Story 11) + most-recent `form_submitted` system_event within
  N days (Story 10 duplicate guard).
- Expose non-PHI license/CAQH/TIN/DEA on the card projection (Story 4).
- Gate: add org-isolation assertions for every new route; mock-server coverage.

### PR D — Workbench extension: Stories 4, 5, 6, 7, 9, 10, 11 — **PLANNED** (depends on A + C)
- 4: key identifiers (NPI, license, CAQH, TIN/EIN, DEA) on the card with copy;
  greyed empty state.
- 5: "Payer reference / submission ID" box at the bottom of fill; writes on submit;
  prefills from the case on select.
- 6: WIP note box → touchlog note entry on submit, task-linked when known.
- 7: submit → task done + task_update + system_event (server-driven).
- 9: field-gap flag before submit (diff mapped required fields vs profile values /
  `unresolved[]`); submit still allowed.
- 10: duplicate-submission guard from the touchlog `form_submitted` system_event.
- 11: latest note on the card.

## Out of scope (captured, not built)
- Closing a case off touchlog (later feature).
- Multi-reference history on the case field (latest-wins only; history in touchlog).
- Batch touchpoints from the extension (Panel Cases workflow only).
- Copy-email-body button (deferred until email templates settle).

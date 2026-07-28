# Minted Panel Workbench — design-package review (Claude Code)

**Date:** 2026-07-28
**Package:** `docs/redesign/design-reference/workbench/` (docs 01–09, screens 1–11,
README, github.md, the superseded BACKEND brief) — the 2026-07-27 Claude Design
handoff for connecting the web app and the Chrome extension.
**Reviewed against:** `sonny303/mintedpanel@main` (a66bf9d, post-E6.7/E6.8 +
slices A/F merged; slices B/E open as PRs #245/#246) and
`sonny303/minted-extension@main` (505917b, post-E4.3 workbench; PR #29 open).

**Verdict:** the design itself is strong, internally consistent, and correctly
grounded in the platform constraints (panel width, MV3 restarts, PHI-in-memory,
no styled overflow). The package's picture of the _backend_, however, is roughly
two weeks stale — it was written against a pre-E6.0/E6.7/E6.8/Phase-4 reading of
the repos. That staleness is good news almost everywhere: several things the
package treats as blockers or new work **already shipped**. The one place the
package is _more_ right than the code is the field catalog: its 127 fields are
the live schema, and the app's hand-maintained 75-key allowlist is the artifact
that drifted (finding 2.1). Nothing in the visual design needs to change; the
epic in doc 08 needs the retargets below before it is written into the tracker.

---

## 1 · The two flagged items, resolved

### 1a · S4.3 — "cut the Progress tab entirely if no task source materializes"

**Keep the Progress tab. The cut-condition's premise is already false.**

The package (doc 06 C2, doc 07 E3.5, seam 2 of the handoff map) says "the panel
has no task source, so v1 sends no `task_id`." That was true in early July. It
is not true on either repo's `main` today:

- `GET /api/cases?providerId=` rows carry **`portalTasks`**
  (`{taskId, title, portalKey, status}` — one entry per distinct portal key
  among a task's steps). This is exactly the task source E3.5 asks for, shipped
  as the Phase 4 SOP↔portal close-out (`src/services/providerCases.ts`).
- `GET /api/cases/:id/context` returns **`openTasks`** with execution types,
  sort order, and due dates (E4.3 TE-2) — the step list the Progress tab renders.
- The extension **already matches the active portal to a task and sends
  `task_id` on the submission touch** (`minted-extension`
  `src/shared/submission.ts`, `src/sidepanel/main.ts` — the task select at
  Mark submitted). The server closes the task and records a `task_update`
  (`src/services/submissionTouches.ts`), and `POST /api/fill-events` with
  `taskId` does the same on the fill path.

So task-level completion — the "Record submission → touch logged, task closed"
moment §2.6 ends on — works end-to-end today. The one genuinely missing write is
**per-step ticking**: step state lives in `tasks.sop_content` and is written
only by the browser-RLS path (`src/services/tasks.ts` updates the steps jsonb);
no `/api` route mirrors it. Two honest scopings:

1. **Full §2.6 (recommended):** add one small write route (e.g.
   `PATCH /api/tasks/:id/steps`) that threads the existing tasks-service update
   through a server ctx (the `ProviderServiceCtx` DI pattern), org-checked
   before write, audited, plus a gate assertion + leak mode. This is a
   contained, well-precedented addition.
2. **Degraded but shippable:** task-level progress only — steps render read-only,
   the checkbox is the _task_, completion rides the existing `task_id`
   close-out. Still a write surface, still not "a read-only duplicate of Case
   Detail," so S4.3's cut clause still does not trigger.

Either way, revise S4.3's blocker line from "blocked on a task source (E3.5)"
to "blocked on the step-tick endpoint decision" — and E3.5 itself moves from
`CONFIRM` to **confirmed-yes, shipped**.

One correction inside §2.6 while we're here: the all-done button "Record
submission — **case to Submitted**" implies a server status bump. See finding
2.3 — the touches endpoint deliberately never changes case status; the bump is
new, small, and must go through `set_case_status` with the touch as evidence.

### 1b · 07 §6 — "the four payer-record gaps need design, not just engineering"

**Three of the four are closed; the list should be retired and replaced with two
narrow design asks.** E6.7 PR 1 and E6.8 merged into `mintedpanel` `main` on
2026-07-27 — after the package's repo read — and the payer-and-cases slices are
building the UI on top right now:

| 07 §6 gap                            | Ground truth on `main`                                                                                                                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No in-app payer-create API"         | **Shipped.** `create_payer`/`update_payer` RPCs (E6.7), plus the two-step Add/Edit Payer UI in PR #245 (Slice B) — which is screen 2 of this very bundle.                                                                                                            |
| "No `payer_contacts` table"          | **Table + RPCs shipped** (E6.7 `20260727120200`: purpose grain, default-per-purpose, `upsert_payer_contact`/`delete_payer_contact`). **No UI yet — this is the one real remaining design gap.**                                                                      |
| "No archive flag or merge operation" | **Shipped** (E6.8: `archive_payer`/`reactivate_payer` with open-case guard, `merge_payer` all-or-nothing). Archive/reactivate UI is in Slice A (merged); **merge UI is deferred to "Slice C — Manage tab," which is designed nowhere** — the second real design ask. |
| "No ID-expectation columns"          | **Shipped** (E6.7 group/provider ID-expectation split; `set_case_status` enforces them at Approved with the E6.8 ack escape). Screens 2 and 5 of this bundle are the UI; Slices B and D built them.                                                                  |

So "§6 blocks everything, eventually" is no longer true. What remains for
design: **(a)** a payer-contacts surface (natural home: the payer detail screen
— screen 3 marks payer screens "no Workbench touchpoints," so this is ordinary
app design, not part of the Workbench epic), and **(b)** the merge flow (Slice
C). Neither blocks any Workbench seam.

---

## 2 · Package claims vs. `main` — the corrections that change the epic

### 2.1 · The catalog: the design's 127 IS the schema — the hand-maintained allowlist is the artifact to retire

**PM direction, 2026-07-28: the picker's fields must come from our schema
(provider, group, facility, …). We do not want a hand-maintained list.** This
supersedes an earlier reading in this review that treated the package's "127
fields" as a stale screenshot; verified against the live database, it is not.

There are two field lists on `main`, and only one of them is real:

- **`get_sop_field_tokens()` — genuinely schema-derived.** The function body
  reads `information_schema.columns` over nine source tables and emits
  `{table, token, column}`, excluding only join keys and audit columns
  (`id`, `org_id`, `created_at`, `updated_at`, the FK columns, `status`,
  `is_active`, …). Add a column to `providers` and a token appears with no
  code change. It currently returns **151 tokens**; dropping the three
  case-scoped tables (payers 18 · contracts 5 · msos 2, which never resolve on
  a provider profile) leaves **126**, plus the two `{{user.*}}` tokens the API
  route appends = **128**. The profile endpoint already resolves exactly this
  set.
- **`src/lib/quickCardCatalog.ts` — a hand-copied subset, 75 keys**, mirrored
  a second time by hand into `minted-extension` `src/shared/quickCards.ts`,
  and enforced as an allowlist by `PUT /api/me/view-prefs` (422 outside it).

The package's group counts are the schema's, not an invention:

| Doc 01 group      | Package | Schema-derived (live)             |
| ----------------- | ------- | --------------------------------- |
| Group             | 39      | `provider_groups` 39              |
| Location          | 23      | `facilities` 23                   |
| License           | 9       | `state_licenses` 9                |
| Location assignm. | 3       | `provider_facility_assignments` 3 |
| Group insurance   | 6       | `group_insurance_policies` 6      |
| User              | 2       | `user.*` family 2                 |
| Provider          | 45      | `providers` 46                    |
| **Total**         | **127** | **128**                           |

Six of seven match exactly; Provider is off by one (the schema has gained a
column since the design's read). So doc 07 §4 and doc 01's catalog table are
**right**, and the allowlist is the drifted copy.

**The drift is material, not cosmetic.** The allowlist is missing **51 tokens**
the schema exposes, and they are not obscure — they are fields payer forms
routinely demand:

- **`group` (23 missing):** the _entire_ correspondence address and contact
  block (`correspondenceStreet/Suite/City/State/Zip`, `correspondenceContactName`,
  `correspondenceEmail/Phone/Fax`), most of the credentialing block
  (`credentialingStreet/Suite/City/State/Zip`, `credentialingFax`), billing
  `Street/Suite/City/Zip/Fax`, plus `states`, `preferredContactMethod`,
  `contractingContactTitle`.
- **`provider` (12 missing):** `homeStreet/homeCity/homeZip` (the card has
  `homeState` but not the rest of the address), `additionalCertifications`,
  `ageGroupsServed`, `culturalCompetencyTraining`, `ssnLast4`, and five
  internal columns.
- **`facility` (12 missing):** `email`, `hours`, `effectiveDate`,
  `acceptingNewPatients`, `adaCompliance`, the three language fields,
  `serviceTypes`, `treatingCategories`, and two internal columns.
- **`license` (3)** and **`groupInsurance` (1 — `notes`).**

Copy-the-values is the MVP (doc 08 Phase 2). A coordinator on a form asking for
the group's correspondence address cannot serve it from the card today, and no
amount of picker redesign fixes that — the field isn't in the list.

**Recommended shape — invert the maintenance burden.** Derive the picker from
`get_sop_field_tokens()` (the same call the profile endpoint already makes, so
picker and values can never disagree) and replace the hand-written allowlist
with a **short, stable exclusion set**:

1. **Case-scoped tables** (`payer.*`, `contract.*`, `mso.*`) — excluded
   structurally; they never resolve without a case, and the profile endpoint
   already returns them null with a reason.
2. **Internal/audit columns** — `provider.launchId`, `provider.isTestProvider`,
   `provider.verificationState`, `provider.terminatedDate`,
   `provider.referenceOnly`, `facility.referenceOnly`, `facility.statusId`,
   `license.verifiedBy/verifiedAt/verificationSourceUrl`. Roughly ten keys,
   and the honest place for them is the RPC's own exclusion list (where
   `id`/`org_id`/`created_at` already live), so every consumer benefits rather
   than each one re-filtering.
3. **The PHI decision** — `provider.ssnLast4` is the single genuine product
   call (doc 07 §4 and §7.3 say include it; E4.3 TE-16 excluded it
   structurally). Whichever way it goes, it is now one entry in an exclusion
   set rather than the reason the whole list is hand-written. The E4.4 vault
   values are not in the catalog at all — they are not columns on these
   tables — so they stay structurally unreachable either way.

**Name the posture change honestly:** allow-list → deny-list is weaker by
default. A future sensitive column added to `providers` would auto-appear on
the picker unless someone excludes it. Mitigate with a **catalog-drift test**:
pin the known token set in a fixture and fail when the schema introduces a
token that is in neither the offered set nor the exclusion set — turning a
silent widening into a build failure that demands an explicit decision. That
keeps the safety property the allowlist was actually providing while removing
the hand-maintenance that made it wrong.

**Extension side:** `quickCards.ts`'s catalog mirror stops being a hand-copy.
The panel already receives every resolvable token _with its value_ in the
profile response, so the picker can derive its rows from that payload (or from
a small catalog read) — the "never add a key here that the panel catalog lacks"
comment becomes unnecessary because there is no second list to keep in sync.
`MAX_QUICK_CARD_FIELDS = 32` should also go: doc 02 §2.7 groups the card by
section precisely so length stops mattering.

S2.1 is therefore a **real app-side story, and the highest-leverage one in
Phase 2** — not the README edit the package describes. Its acceptance criteria
should read: picker offers the schema-derived catalog; the exclusion set is
named in one place and tested; the drift test exists; the extension mirror is
deleted rather than updated; `ssnLast4` is an explicit, recorded decision.

### 2.2 · Doc 01's status-machine invariant is one epic out of date

"Two status machines, never merged… the repo is explicit that these stay
independent" describes the E4.0 world. **E6.0 unified case status** (merged
2026-07-19): there is now ONE canonical 8-value `case_status`, every transition
goes through `set_case_status`, and `payer_pipeline_state` survives only as a
**read-only dual-write mirror** (TD-35; `advance_payer_pipeline` dormant). The
design's 8-value pill list is exactly the E6.0 spine — good — but the panel
should not present a second live "payer pipeline stage" machine. The context
endpoint's `payerPipelineState` is legacy display data; new Workbench UI should
render canonical `status` only. Rewrite the invariant as: _one status machine;
the pipeline column is a frozen mirror — never write it, don't build UI on it._

### 2.3 · C2's "server bumps status" does not exist — and must ride `set_case_status`

`POST /api/cases/:id/touches` **never changes case status** — that's the locked
R2 decision, restated in the service ("The extension never changes case
_status_ (v1)"), and post-E6.0 any transition must go through the
`set_case_status` RPC (evidence rules, append-only history, the E6.8 13-param
signature). The handoff map's seam-2 chip "Endpoints exist" therefore
overstates: the touch, reference write-back, fill report, task close, and
`system_event` all exist; the **In Progress → Submitted bump is new server
work**. Recommended shape: an explicit opt-in flag on the touches body (e.g.
`bump_status: true`) that, after the touch commits, calls `set_case_status`
(target Submitted, `expectedStatus` null, the just-written touch as
`evidence_touch_id`) — mirroring the E6.6 AddTouch semantics where a failed
bump never unwinds the touch. That also gives Case Detail its "workbench touch"
evidence line (doc 03 §3.1C) for free, since Slice E's timeline already
resolves `evidence_touch_id`. S4.4 should name this as its server half.

### 2.4 · C5 / E3.6 drift — the CONFIRM is answered: it already works end-to-end

"Confirm what writes to `formDrift` today": the answer is **the extension
already does.** Drift is derived, not stored — `src/lib/formDrift.ts` parses
the skipped entries of the latest REAL fill per portal (dry-run `is_test`
fills excluded; `FIELD_NOT_FOUND_REASON` = "field not found on this page";
mapId-then-label join; repaired-since rule), and those fills arrive via the
existing `POST /api/fill-events`. The proposed C5 payload
`{portal_key, field, last_working_at}` is unnecessary — **no new write path,
no new endpoint**. What remains of S6.4 is presentational: the Payer Setup
banner's provenance line ("reported by a Workbench fill on Jul 24") derives
from the reporting fill's date, and "known-fragile" prioritization is a small
app-side extension of the drift lib. The uploaded screen 1 already renders the
provenance line.

### 2.5 · Phase 1 is half-done in an open PR — merge it, don't re-scope it

`minted-extension` **PR #29** (Devin, open, 2026-07-27) already implements:
E1.2 tokens + self-hosted Geist (S1.2, S1.3), the `.pill` radius change, E1.4
sign-out contrast + the greeting/account line (most of S1.5), and E1.3 the
doubled-credential fix via `providerDisplayName()` (S1.6). Phase 1 should
start by **reviewing and merging #29**, then do what it explicitly leaves out:
S1.1 icons (the manifest blocks — #29 skipped them because `assets/icons/`
exists only in the design bundle, not the repo; the PNGs still need committing),
S1.4 removing the second green header, and the S1.5 avatar _menu_ (vs. #29's
text greeting). S1.7 (terminology) is also half-done: the app side shipped with
Slice F (`extension_fill` → "Auto-fill" via `EXECUTION_TYPE_LABELS`); the
extension's "SOP tasks" strings remain.

> **Asset gap:** the icons and the two logo marks (`logo-mark.png` /
> `logo-mark-white.png`) did not make it into either repo — the bundle's
> `assets/` directory in this commit is empty except for what the screens
> reference. S1.1 is blocked on committing them; source them from the Design
> project's `assets/icons/` + `uploads/MPC-Logo-Final.png`.

### 2.6 · E5.1 label-learning is not greenfield — two of its three parts exist

The package scopes the label-learning store as new design. The foundation
already exists in the app: **`field_dictionary`** (org-scoped
`label_normalized → token` memory with `suggested|confirmed|rejected` status,
learned on every mapping approval) and **`mappingConfidence.ts`** (the
confidence/suggestion split that survived E6.5 as the trainer's plumbing),
joined by the shared `normalizeFieldLabel`. What E5.1 actually needs designed:
(a) the **cross-payer evidence count** ("seen on 9 payers" — an aggregation
across `portal_field_maps` by normalized label that nothing computes today),
and (b) whether dictionary learning gets a **global tier** (org-scoped today;
the compounding story implies cross-org for the two-person team, which is
platform-posture territory). Scope E5.1 as an extension of these, not a new
store.

### 2.7 · E5.3 is smaller than scoped; E5.2 is real

`providers.caqh_last_attested_date` **already exists** — the profile endpoint
selects it, E1.8 readiness enforces it (`CAQH_CURRENT_DAYS = 120`), and it's
already in the quick-card catalog. E5.3 reduces to the **write** (a guarded
`/api` route the panel calls on Record attestation) — and doc 04 §4.11's
"attestation not due" state should reuse the existing 120-day constant rather
than inventing a second freshness window. E5.2 (per-field `verified_at`) is
genuinely new — only `state_licenses` has a PSV trail today — and is the one
schema design of the CAQH seam (per-field stamps have no home; jsonb-on-provider
vs. a child table is the decision to put in front of the PM/Devin).

### 2.8 · C1: the message contract exists and is locked; the launcher needs a re-home

- `src/lib/extensionHandoff.ts` already defines the **locked `SET_ACTIVE_CASE`
  builder** (org/case identifiers + feature-detect + best-effort send) and
  `src/lib/casePortals.ts` already derives a case's portals from its open
  tasks' portal steps — **plural**, exactly as the BACKEND brief's correction
  demands. C1 design should name these as the contract rather than a new
  payload; the E3.1 spike is solely about the `sidePanel.open()` gesture.
- The launcher currently has **no home**: the cases-page redesign (#233)
  deleted the queue component that carried `WorkInPortalButton`, and Slice E
  (PR #246) removes it from Case Detail per the payer-bundle's §2.7
  ("extension deferred"). Doc 03 §3.1D re-adds it as the C1 launch button on
  the rebuilt Case Detail — flag this to the slice lane so the re-add lands
  _after_ #246 merges, styled per the new header, one launcher per resolvable
  portal with per-portal readiness.

### 2.9 · E3.3 portal registry — right diagnosis; name the missing endpoint

The three hardcode sites in the extension are confirmed
(`PORTALS`/`matchPortal`/manifest matches), and the MV3 content-script
question (broad host permission + `chrome.scripting.registerContentScripts`
vs. `optional_host_permissions`) is the real architectural choice. Two repo
facts to add to the story: the `portals` table has had a **global tier** since
E6.5 (`org_id NULL` + `proven_at`), so the catalog rows the registry needs
exist — but **portals are not an `/api` resource**; the extension can only
reach `portal_field_maps`. E3.3 therefore includes one new read route (e.g.
`GET /api/portals`, guard + gate assertions per the standing pattern), with
URL matching driven by the field-map rows' `url_pattern` and/or `form_url`.

### 2.10 · Small corrections

- **Doc 01 invariant "Templates are scoped payer + group, never org-tier —
  that tier was retired app-side"** — mis-stated. Org-scoped templates are
  alive and _outrank_ global ones (E4.2 tier ranking: org exact-group → org
  any-group → global exact → global any → generic fallback). What was retired
  is org SOPs with "Any payer"/"Any state" (payer + state now required).
  Restate as: _templates match on payer + state (+ optional group), at org and
  global tiers; org overrides global; never re-introduce any-payer org
  templates._
- **Screen 1's `capture_fields` next-action** (marked PROPOSED in the demo
  script: "portal registered but no fields captured yet — today this
  misreports as train_mappings and dead-ends") is a correct diagnosis of
  `payerReadinessFunnel.ts` and worth adopting as a small app story regardless
  of the Workbench timeline.
- **Bundle divergence:** screens 1–6 here are re-shelled (production sidebar
  IA, real logo) and lightly extended relative to
  `design-reference/payer-and-cases/`, which slices A–F were built from.
  After #245/#246 merge, reconcile the deltas (drift-banner provenance line,
  capture_fields state, default-template card) rather than treating this copy
  as a second source of truth for those screens.
- **Doc 06 C2 wire shape:** keep the locked snake_case touches body
  (`portal_submission`, `payer_reference_id`, `idempotency_id`…) — the doc's
  `payer_reference` / `fill_report` naming is design shorthand; the fill
  report already rides `fill_sessions` via `fill_session_id`, so decide
  whether the touchlog entry's counts come from the joined fill session
  (recommended — no new column) or a new touch field.

---

## 3 · Doc 08, sharpened — deltas to apply before writing the epic

| Story              | Delta                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1.2 / S1.3 / S1.6 | Collapse to "review + merge extension PR #29"; keep the acceptance criteria as the review checklist.                                                                                                                                                                                                                                                                                                                                    |
| S1.1               | Add: commit the icon PNGs (not in repo). Blocked only on assets.                                                                                                                                                                                                                                                                                                                                                                        |
| S1.5               | Rescope to the avatar _menu_ on top of #29's greeting.                                                                                                                                                                                                                                                                                                                                                                                  |
| S1.7               | Extension-side only; app side shipped in Slice F.                                                                                                                                                                                                                                                                                                                                                                                       |
| S2.1               | Rewrite as the schema-derived catalog story: the picker reads `get_sop_field_tokens()`, the hand-written allowlist is retired in favour of a named exclusion set, a drift test is added, the 32-cap is dropped, the extension mirror is deleted, and `ssnLast4` is decided explicitly (finding 2.1). Highest-leverage story in Phase 2 — the card is missing 51 schema fields today, including the group's entire correspondence block. |
| S2.2 / S2.3        | Sound as written. Verify at 320 stands.                                                                                                                                                                                                                                                                                                                                                                                                 |
| S3.1               | Keep (spike first). Add: reuse the locked `SET_ACTIVE_CASE` builder.                                                                                                                                                                                                                                                                                                                                                                    |
| S3.2               | Add the `GET /api/portals` read + gate assertions; name the MV3 host-permission decision as its own checkbox.                                                                                                                                                                                                                                                                                                                           |
| S3.3 / S3.4        | Sound. Queue ranking source = the E2.3 deadline reducer the server already exposes via `GET /api/next-best-action` (extend to a ranked _list_ — today it returns only the top item).                                                                                                                                                                                                                                                    |
| S3.5               | Depends on the Slice-E launcher re-home (finding 2.8).                                                                                                                                                                                                                                                                                                                                                                                  |
| S4.1 / S4.2        | Sound. Fill-report snapshot rule is well specified — pin it in a test.                                                                                                                                                                                                                                                                                                                                                                  |
| S4.3               | Unblock per §1a; replace the blocker line with the step-tick endpoint decision.                                                                                                                                                                                                                                                                                                                                                         |
| S4.4               | Add the server half: opt-in status bump through `set_case_status` with touch evidence (finding 2.3). Offline/no-false-success criteria stand.                                                                                                                                                                                                                                                                                           |
| S4.5               | Sound; Slice D's dialog is the target surface, provenance strip is additive.                                                                                                                                                                                                                                                                                                                                                            |
| S5.1               | The propose-only write is a **new `/api` write route** with gate assertions + the `fixit.ts` boundary-comment update. "Enforced server-side" = fill path ignores `proposed` rows (extension fill currently fills proposed AND approved — flip that at the same time, or the invariant is false).                                                                                                                                        |
| S5.2–S5.4          | Sound; S5.3 builds on `field_dictionary` + `mappingConfidence` (finding 2.6).                                                                                                                                                                                                                                                                                                                                                           |
| S6.1               | The real schema design of the epic (per-field `verified_at` home).                                                                                                                                                                                                                                                                                                                                                                      |
| S6.2               | Smaller: column exists; the write route is the work. Reuse `CAQH_CURRENT_DAYS`.                                                                                                                                                                                                                                                                                                                                                         |
| S6.4               | Rescope to presentational + known-fragile derivation; no new ingestion (finding 2.4).                                                                                                                                                                                                                                                                                                                                                   |
| Cut order          | Unchanged and still right — except S4.3 no longer belongs in it for the stated reason; if it's cut now, that's a scope choice, not a dependency failure.                                                                                                                                                                                                                                                                                |

**Decisions to put in front of the PM before the epic is written:**

1. `provider.ssnLast4` on the card, yes or no — the one genuine product call
   left once the catalog is schema-derived (finding 2.1). _(The schema-derived
   direction itself is decided: PM, 2026-07-28.)_
2. Step-tick endpoint vs. task-level-only Progress (finding §1a).
3. Who owns "Check coverage" (the package's open question — still open).
4. MV3 host-permission strategy for the DB-driven registry (finding 2.9).
5. E5.2 storage shape (jsonb vs. child table) and whether dictionary learning
   goes global-tier (finding 2.6).

---

## 4 · What the package gets right (so it doesn't get re-litigated)

The one-loop framing and the three-contexts model; fill-report **snapshot**
integrity (never recompute history); the duplicate guard moving to pickup;
propose-never-fills surviving a one-person approve; CAQH as push-only with the
pull as a rare exception; the queue never inventing priority (the E2.3 reducer
is the ranking source and the server already runs it); every failure state in
doc 04 being explicit (especially §4.7's "write failed" honesty rule); the
320px floor as a hard gate; PHI values never persisting across MV3 restarts —
all of these match the platform's locked decisions and should be built exactly
as specified. The E3.1 spike-first posture on the launch gesture is correct;
Chrome's user-gesture requirement for `sidePanel.open()` from an
`externally_connectable` message is genuinely version-sensitive and worth the
timebox before any copy promises a launch.

---
title: Payer catalog removal — schema/API impact + tech-debt assessment
status: analysis, decisions pending
owner: devin
date: 2026-07-26
companions: payer-setup-page-build-handoff.md (§7), payer-user-journeys.md, docs/data-model/payer-field-usage-audit.md, docs/data-model/table-register.md
---

# Removing the payer catalog: what breaks, what goes stale, what it costs

Scope of the change under analysis: retire the **precanned catalog browse**
("add from a curated 137-payer list") and replace it with a **manual add-payer
flow** — the user fills out fields from our schema and the payer lands in
their network. This doc traces every schema column, RPC, script, and frontend
consumer that the catalog touches and classifies it: **load-bearing** (the
manual flow must feed it), **stale** (loses its writer), or **retired**
(machinery whose only job was the precanned pipeline).

Ground rules that bind everything below (`AGENTS.md`): migrations are
**additive-only** — nothing here proposes a rename or drop; stale columns are
stop-written and deprecated in place. All row counts referenced are from the
2026-07 field-usage audit (269 global payer rows on the shared dev DB).

---

## 1. The headline: identity survives, provenance changes

`payers` is the identity spine — `payer_id` is a foreign key of
`credential_cases`, `contracts`, `payer_network_targets`,
`org_payer_assignments`, `enrollment_facts`, `sop_templates`, and the
portal registry. **None of that changes.** What changes is _where rows come
from_: today rows are written only by the sync script and platform tooling
(org write paths revoked, `20260718120000`); tomorrow an app user creates
them. The tech debt is therefore not "delete the catalog" — it is:

1. one **new write path** (the API-enabler epic, §5),
2. a set of columns whose **curated writer disappears** (§2),
3. the **sync pipeline machinery** that retires (§4), and
4. a **governance question** the PM must answer before the enabler is built
   (§6 — global vs org-scoped creation).

## 2. `payers` columns under the manual model

| Column                                                  | Today                                                     | Under manual add-payer                                                                                                                                                             | Class                                   |
| ------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `name`                                                  | curated                                                   | **user-entered, required**                                                                                                                                                         | load-bearing                            |
| `payer_kind`                                            | curated                                                   | **user-entered, required** (6-value enum drives filters/pills)                                                                                                                     | load-bearing                            |
| `states[]`                                              | curated                                                   | **user-entered, required** — this is the critical one, see below                                                                                                                   | load-bearing                            |
| `aliases[]`                                             | curated                                                   | user-entered, optional — feeds the duplicate guard + search                                                                                                                        | load-bearing                            |
| `resolution_id_label` / `resolution_id_expected`        | Minted-curated global fallback tier                       | user-entered, optional ("what does this payer call its provider ID") — the E4.0 approval step reads it through the `payerResolutionIdentifier` seam (org setting → this → generic) | load-bearing                            |
| `delegation_note`                                       | platform-written payer fact (E6.5, replaced MSO engine)   | user-entered, optional                                                                                                                                                             | load-bearing                            |
| `status` (`active\|retired\|merged`) + `merged_into_id` | curation decisions                                        | **more important, not less** — manual entry guarantees duplicates; merge is the repair. Needs an admin path eventually (today service-role only)                                   | load-bearing, needs a writer eventually |
| `avg_decision_days`                                     | curated; displayed on payer detail + reports `SummaryTab` | **goes stale immediately** — no writer. Stop displaying or derive it from real case outcomes (better)                                                                              | stale → derive later                    |
| `payer_slug`                                            | the sync identity/dedupe key (partial UNIQUE)             | manual rows have no slug — nullable already; stop-write, keep for the 269 seeded rows                                                                                              | stale                                   |
| `last_synced_at`                                        | sync bookkeeping                                          | dead                                                                                                                                                                               | stale                                   |
| `is_active`                                             | legacy pre-catalog flag                                   | superseded by `status`; already legacy                                                                                                                                             | stale (already)                         |
| `org_id`                                                | NULL on every row since the 2026-07-17 wipe               | **the §6 decision**                                                                                                                                                                | decision                                |

**Why `states[]` cannot be optional:** it is consumed by three engines, not
just filters — `groupPayerAttach` (attach eligibility = payer states ∩ group
operating states), `payerExpansion` (candidate derivation for generation),
and the E6.2 payer-attach CSV import's eligibility scan. A payer created with
empty `states[]` is **invisible to attach and generation** — it can be "in
your network" and never produce a case. The manual form must require ≥1
state, and the create RPC should enforce it.

## 3. Frontend consumers — what changes, what doesn't

| Surface                                                          | Impact                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PayerCatalogBrowser` (the browse)                               | **Retired** — replaced by the add-payer flow. The only component whose job is precanned browsing                                  |
| `usePayerCatalog` → `listGlobalPayers` RPC                       | **Keeps working unchanged** — it lists `payers` rows regardless of provenance; the duplicate guard and add-by-search both need it |
| `payerDirectory.ts` filters (name/alias/state/kind)              | Reused verbatim by the duplicate guard + My network filters                                                                       |
| `payerCatalogActions.ts` (add/remove/reactivate/merged-redirect) | Unchanged — membership verbs live on `org_payer_assignments`, not the catalog                                                     |
| `PayerDetailContent`                                             | Loses `avg_decision_days` (stale) and `last_synced_at`; everything else keeps rendering                                           |
| Readiness funnel / My network                                    | Unchanged — reads templates/portals/drift, not catalog provenance                                                                 |
| `admin.payer-admin.catalog` route                                | Becomes the My network page; keep a redirect                                                                                      |
| Group attach + generation                                        | Unchanged **if** `states[]` is required at creation (§2)                                                                          |

## 4. Machinery that retires (the actual tech-debt cleanup)

| Asset                                                                                                 | Disposition                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/payer-catalog-sync.mjs` (+ `.d.mts`, `payerCatalogSync.test.ts`)                             | Retire with the quarterly runbook. Keep until the PM confirms no more dataset refreshes                                                                                                                                         |
| `docs/redesign/data/payer-catalog/*.csv` (payers, MACs, medicaid programs, rankings, MSO delegations) | Frozen reference data — keep in-repo, mark the README "no longer synced"                                                                                                                                                        |
| `payer_catalog_changes` table + `review_payer_catalog_change` RPC                                     | Already platform-only (`20260716191000`); stops receiving rows when the sync stops. Retain per additive rule; register row updated to "dormant"                                                                                 |
| The 269 seeded global rows                                                                            | **Keep.** They are real payers and they make the duplicate guard useful on day one. The "noise" was the browse UI, not the rows. Alternative (soft-hide unassigned rows from search) sacrifices the dup guard — not recommended |

## 5. The API-enabler epic (the one new thing to build)

Today there is **no in-app payer creation** (no INSERT policy, no RPC —
`payers.ts` is read-only). The enabler, shaped like the existing guarded
global-authoring RPCs (`author_global_sop` precedent, interim
all-authenticated posture, R7 hardens):

- **`create_payer` RPC** (SECURITY DEFINER, authenticated, anon rejected
  in-body): takes `name` (required), `payer_kind` (required, CHECK domain),
  `states[]` (required, ≥1, `^[A-Z]{2}$`), `aliases[]`,
  `resolution_id_label`/`_expected`, `delegation_note`. Writes the payer row
  **and the caller org's `org_payer_assignments` row in one transaction**
  (create = it's in my network; there is no other reason to create one).
- **In-RPC duplicate guard:** reject when normalized `name` or any alias
  matches an existing non-retired row's name/alias (the UI surfaces
  near-matches with "use this instead" _before_ submit; the RPC is the
  backstop). Merged rows redirect to their successor.
- **No new table, no destructive DDL** — one migration adding the RPC (and
  the `states[]` NOT-empty enforcement in-body). Table-register row updated
  in the same PR.
- Frontend: `createPayer` service + hook + the add-payer dialog (the Claude
  Design bundle in progress defines the UI).
- Explicitly **not** in the enabler: merge/retire admin UI (service-role
  remains the merge path until duplicate volume justifies it — log as
  TECH-DEBT), `avg_decision_days` derivation, platform roles.

## 6. Decisions needed before the enabler is built

1. **Global or org-scoped rows?** _(the big one)_ Recommend **global**
   (`org_id NULL`, like today): keeps Journey A's authored-once model — a
   template/form proven for a payer one org created is inherited by every
   org that adds it; the dup guard works across the whole pool. The
   alternative (org-scoped rows) reintroduces the pre-E4.2 free-text world:
   N copies of Aetna, templates that don't transfer, and the E6.5 epic's
   premise breaks. Cost of global: any signed-in user can grow the shared
   pool (same interim posture as global SOP authoring — same R7 hardening
   fixes both). Payer names/states are not org-confidential.
2. **Who fixes duplicates?** Manual entry guarantees them despite the guard.
   Service-role merge is the status quo; decide the threshold at which an
   admin merge UI gets built.
3. **`avg_decision_days`:** hide it, or build the derived version (median
   days creation→approved from `credential_cases`) — a small, honest
   replacement that improves with use.
4. **Sync sunset:** confirm no more quarterly dataset refreshes once manual
   creation ships (running both = the diff queue fights user edits).
5. **Catalog-fact drift:** curated facts (states, delegation) were Minted's
   quality guarantee. Under manual entry they are only as good as the user's
   knowledge — accept, or keep a light platform review of new rows
   (the dormant `payer_catalog_changes` queue could be repurposed for that).

## 7. Sequencing

1. PM answers §6 (esp. decision 1) → fold into the Claude Design bundle.
2. **Enabler epic PR** (migration + RPC + service/hook + tests) — small,
   independent of the page redesign.
3. Page redesign build (My network slice first — already spec'd in
   `payer-setup-page-build-handoff.md`; its Catalog slice is replaced by the
   add-payer flow).
4. Cleanup PR: retire the sync script/runbook, mark `payer_slug`/
   `last_synced_at`/`avg_decision_days` deprecated-in-place in the table
   register, freeze the dataset README, log the merge-UI debt in
   `TECH-DEBT.md`.

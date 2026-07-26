---
title: Payer manual setup — backend enabler + tech-debt build assignment (Claude Code)
status: PM-approved 2026-07-26, ready to build
owner: devin
decisions: global rows · no platform-role gating (2-user posture) · guard-only dup handling · retire sync · no review queue · two PRs
companions: payer-catalog-removal-impact.md (the analysis), payer-setup-page-build-handoff.md (the page), payer-user-journeys.md
---

# Build assignment: payer manual setup enabler + catalog tech-debt cleanup

Two PRs, in order. PR 1 unblocks the frontend redesign (the "+ Set up payer"
flow in the PM's new design); PR 2 cleans up the machinery the catalog leaves
behind. Everything is open to **all authenticated users** — the PM has
explicitly rejected platform-role gating (two trusted users; nothing waits on
a future roles system).

## PR 1 — the enabler

### 1a. `create_payer` RPC (one additive migration)

SECURITY DEFINER, `authenticated` EXECUTE (revoke `public`/`anon`; reject
`anon` in-body like `author_global_sop`). Inputs:

| Param                                                             | Rule                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `p_name text`                                                     | required, non-blank                                                                                         |
| `p_payer_kind text`                                               | required, CHECK domain: `commercial · medicare · medicare_advantage · medicaid · medicaid_mco · tricare`    |
| `p_states text[]`                                                 | required, ≥1, each `^[A-Z]{2}$` — empty states = the payer can never attach or generate (see impact doc §2) |
| `p_aliases text[]`                                                | optional                                                                                                    |
| `p_resolution_id_label text` / `p_resolution_id_expected boolean` | optional                                                                                                    |
| `p_delegation_note text`                                          | optional                                                                                                    |

Behavior:

- Inserts a **global** row (`org_id NULL`, `status 'active'`,
  `payer_slug NULL`, `last_synced_at NULL`) — authored once, visible to every
  org, template inheritance intact.
- **Duplicate guard in-body:** reject (`payer_duplicate`) when the normalized
  name (lower/trim/collapse whitespace) matches any non-retired global row's
  name **or** alias; if the match is `status='merged'`, the error names the
  successor. The UI's near-match picker is the front line; the RPC is the
  backstop.
- **Atomic network add:** in the same transaction, upsert the caller org's
  `org_payer_assignments` row (reactivate if archived). Creating a payer =
  adding it to my network; there is no other reason to create one. Org
  resolved from the caller's active-org argument (`p_org_id uuid`, validated
  member + writer like existing RPCs).
- Returns the payer row.

### 1b. Unlock the default (fallback) template — same or second migration

PM decision 2026-07-26: **no platform-role gating**. Reissue
`author_global_sop` and `publish_sop_template_version` with the
`fallback_sop_locked` checks for `authenticated` callers REMOVED (id
`00000000-0000-4000-a000-00000000e17b` becomes editable like any global SOP;
its payerless-singleton grain guard stays — it remains the only payerless
global row and cannot be archived or given a payer). This makes the design's
default-template **Edit** button real.

### 1c. Frontend seam (no UI beyond a service + hook)

- `src/services/payers.ts`: `createPayer(input): Promise<Payer>` calling the
  RPC (the file is otherwise read-only today — this is the first write).
- `src/hooks/` mutation hook invalidating the payer + assignment caches.
- `src/lib/`: pure `normalizePayerName` + `findPayerNearMatches(name, payers)`
  (name/alias, for the dialog's "use this instead" list) with unit tests.
- The dialog itself ships with the page redesign, not this PR.

### 1d. Gates

`npm run lint` · `npx tsc --noEmit` · `npm run test` · migration dry-run.
Update `docs/data-model/table-register.md` rows for `payers` (new writer) and
the SOP RPCs (lock removed) in the same PR. Unit tests: dup guard normalize
rules, states validation, near-match helper.

## PR 2 — the cleanup

1. Retire `scripts/payer-catalog-sync.mjs`, `scripts/payer-catalog-sync.d.mts`,
   `src/lib/payerCatalogSync.test.ts`; mark the dataset README
   (`docs/redesign/data/payer-catalog/README.md`) "frozen — no longer synced".
2. Table register: `payer_slug`, `last_synced_at` → deprecated in place
   (stop-write); `payer_catalog_changes` → dormant.
3. `avg_decision_days`: stop rendering the stored column
   (`PayerDetailContent`, reports `SummaryTab`); leave the column in place.
   Log the derive-from-case-outcomes replacement in `TECH-DEBT.md`.
4. `TECH-DEBT.md`: add the deferred admin merge UI (merges stay
   service-role/platform-side until duplicate volume justifies it).
5. No schema change in this PR.

## Out of scope (both PRs)

The Payer Setup page UI (separate design→build track) · admin merge UI ·
derived decision-days · any rename/drop (additive-only rule binds) · the
extension contract.

## Prompt for the Claude Code session

> Implement the two backend PRs in
> `docs/redesign/payer-manual-setup-build-assignment.md` (PM-approved
> 2026-07-26), in order: PR 1 the `create_payer` enabler + fallback-template
> unlock, PR 2 the catalog tech-debt cleanup. Read
> `docs/redesign/payer-catalog-removal-impact.md` first for the why behind
> every rule (especially why `states[]` is required). `AGENTS.md` binds:
> additive migrations only, services-own-Supabase layering, no `any`, named
> exports, update the table register in the same PR as any schema/RPC change.
> Branch off `main`, target `main`, one PR at a time; run
> `npm run lint && npx tsc --noEmit && npm run test` before opening each.

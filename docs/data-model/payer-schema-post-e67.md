# `payers` schema — current vs post-E6.7, and the gaps

Reference for the schema walkthrough (2026-07-26). Source of truth: live
generated types + migrations through `20260720230000`. E6.7 as drafted adds
**no columns** — it adds the `create_payer` write path and retires the sync —
so "current" and "post-E6.7" differ only in provenance and which columns still
have a writer.

## The table today (16 columns) and after E6.7

| Column                                           | Type                                                       | Today                                               | Post-E6.7                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                                             | uuid PK                                                    | sync/platform                                       | RPC-generated                                                                     |
| `org_id`                                         | uuid NULL                                                  | always NULL (global-only since the 2026-07-17 wipe) | unchanged — manual rows stay global (PM decision)                                 |
| `name`                                           | text NOT NULL                                              | curated                                             | user-entered, required                                                            |
| `payer_kind`                                     | text NOT NULL default `commercial`                         | curated                                             | user-entered, required; 6-value domain enforced **in the RPC only** (gap 4)       |
| `states[]`                                       | text[] NULL                                                | curated                                             | user-entered, **required ≥1 by the RPC** (attach/generation eligibility reads it) |
| `aliases[]`                                      | text[] NULL                                                | curated                                             | user-entered, optional; feeds the dup guard                                       |
| `status`                                         | text NOT NULL default `active` (`active\|retired\|merged`) | curation decision                                   | unchanged; merges stay platform-side                                              |
| `merged_into_id`                                 | uuid NULL → payers                                         | curation                                            | unchanged                                                                         |
| `resolution_id_label` / `resolution_id_expected` | text / bool NULL                                           | Minted-curated global fallback tier                 | user-entered, optional (org override still in `org_payer_settings`)               |
| `delegation_note`                                | text NULL                                                  | platform-written                                    | user-entered, optional                                                            |
| `avg_decision_days`                              | int NULL                                                   | curated                                             | **stale — no writer**; stop-render (F6.7.5), later derive from case outcomes      |
| `payer_slug`                                     | text NULL, partial UNIQUE                                  | sync dedupe key                                     | **stale — stop-write** (manual rows NULL)                                         |
| `last_synced_at`                                 | timestamptz NULL                                           | sync bookkeeping                                    | **stale — stop-write**                                                            |
| `is_active`                                      | bool NULL                                                  | legacy pre-`status` flag                            | already legacy; superseded by `status`                                            |
| `created_at`                                     | timestamptz                                                | auto                                                | auto                                                                              |

Related grains (unchanged by E6.7): `org_payer_assignments` (org membership,
active|archived), `org_payer_settings` (org × payer config — resolution ID
only today), `payer_network_targets` (group × payer × state attach),
`enrollment_facts`, `payer_catalog_changes` (goes dormant).

## The gaps (worth deciding, roughly in priority order)

1. **No update path — a typo is permanent.** E6.7 adds create but no
   `update_payer`; org write paths to `payers` were revoked. A user who
   fat-fingers a name or misses a state cannot fix it in-app. _Proposal:
   add `update_payer` RPC to E6.7 PR 1 (same field rules + dup guard;
   name/states/kind/aliases/resolution/delegation editable; `status`/merge
   stays platform-side)._
2. **No provenance.** Nothing records who created/edited a row or whether it
   came from seed, sync, or a user. _Proposal: additive `created_by uuid
NULL` + `source text NULL` (`seed|sync|manual`) columns, stamped by the
   RPC; existing rows backfill `sync`._
3. **No `updated_at` / no audit trail** on payer edits (the audit_log covers
   org-scoped actions; global payer rows have nothing). _Proposal: additive
   `updated_at` + write an `audit_log` row from the RPCs._
4. **Domains live in the RPC, not the table.** `payer_kind` and `status` are
   plain text with defaults — bad data can enter via any future write path.
   _Proposal: additive validated CHECK constraints (E0.10 precedent)._
5. **No DB-level duplicate defense.** The dup guard is RPC-body logic; a
   second write path could insert "aetna" beside "Aetna". _Proposal: partial
   functional unique index on `lower(btrim(name)) WHERE org_id IS NULL AND
status <> 'merged'` (aliases stay guard-only)._
6. **`states[]` is a flat array** while SCHEMA.md's grain rule says
   state-varying facts belong in child rows. Fine while a state is just
   "operates here", but per-state payer facts (enrollment method, fax vs
   portal, timelines) have nowhere to land. _Defer until a real per-state
   fact exists; note it so nobody bolts columns onto the array._
7. **No operational contact fields.** The dead-column drop removed
   `portal_url` etc. as unused; the manual model may want a payer website /
   support phone. _Product call — only add what the new designs render._
8. **Redundancy to retire in place:** `is_active` (superseded by `status`),
   `avg_decision_days`, `payer_slug`, `last_synced_at` — deprecated, never
   dropped (additive rule).

## If all proposals land, the manual-model table reads

```
payers(
  id, org_id(NULL=global), name*, payer_kind* CHECK, states[]*,
  aliases[], status CHECK, merged_into_id,
  resolution_id_label, resolution_id_expected, delegation_note,
  created_by, source(seed|sync|manual), created_at, updated_at,
  -- deprecated in place: is_active, avg_decision_days, payer_slug, last_synced_at
)
+ unique(lower(btrim(name))) where global & not merged
+ write paths: create_payer / update_payer RPCs only
```

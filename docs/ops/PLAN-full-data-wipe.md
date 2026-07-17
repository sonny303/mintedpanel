# Plan for Approval: Full Data Wipe (pre-prod-cut)

**Repo:** `sonny303/mintedpanel`
**Branch:** `schema/full-data-wipe` off `origin/redesign`
**Reviewer:** Devin
**Requested by:** SS (PM/founder), 2026-07-17
**Supabase project:** `fkvuhfsqcmujywzgczmc`

---

## 1. What this is

Delete every organization and every user except `sowmya@minted.com` from the shared
Supabase project. Keep the global product catalog. This clears the dev database ahead
of the E3 production cut, which is **not** happening today.

This is not test-data cleanup. It deletes the KFP customer record, which is real and
has no import run behind it.

---

## 2. PM decisions on record

| Q   | Decision | Meaning                                                                           |
| --- | -------- | --------------------------------------------------------------------------------- |
| Q1  | **C**    | KFP gets re-onboarded from scratch in prod. Current data not needed.              |
| Q2  | **C**    | The 10 KFP SOP templates die with the org. Rebuild later. Not promoted to global. |
| Q3  | **B**    | Empty app after the wipe. First-run onboarding creates the first org.             |

Claude recommended Q2=A (promote SOP templates to `org_id = NULL` before deleting).
PM chose C. Recorded here so the tradeoff is visible in review, not litigated again.

---

## 3. Scope

### Deleted

| Item               | Count                                                   |
| ------------------ | ------------------------------------------------------- |
| Organizations      | **15** (11 agent seed, 1 demo, 2 junk, **1 real: KFP**) |
| `auth.users`       | **5 of 6**                                              |
| `credential_cases` | 65                                                      |
| `tasks`            | 231                                                     |
| `audit_log`        | 334                                                     |
| `status_history`   | 64                                                      |
| `touches`          | 60 (**47 are `source: manual`**)                        |
| `sop_templates`    | 21 of 22                                                |
| `fill_sessions`    | 31                                                      |
| `providers`        | 16                                                      |
| `status_configs`   | 330                                                     |
| `parties`          | 22                                                      |

Counts are from a 2026-07-17 trace. Step 0 of the script regenerates them at run time;
that output is the inventory the AGENTS.md pre-GA window requires in the PR body.

### Kept

| Item                                   | Count | Why                                           |
| -------------------------------------- | ----- | --------------------------------------------- |
| `sowmya@minted.com`                    | 1     | Only remaining user. Last sign-in 2026-07-17. |
| `payers` (`org_id IS NULL`)            | 269   | Product catalog.                              |
| `portal_field_maps` (`org_id IS NULL`) | 24    | BCBS KS fill engine.                          |
| `sop_templates` (`org_id IS NULL`)     | 1     | Only global template.                         |
| `party_role_types`                     | 6     | Lookup table.                                 |

---

## 4. Preconditions (blocking)

1. **`pg_dump` snapshot taken AND restore verified against a scratch project.**
   Not "taken." Verified. KFP has no import run. This snapshot is the only path back,
   and Q2=C means it is also the only copy of 10 SOP templates.

2. **AGENTS.md carve-out merged first, as its own PR.**
   The pre-GA DDL window from PR #169 explicitly protects append-only ledgers:
   _"Append-only ledgers (`audit_log`, `*_history`, touches) remain protected: never
   drop or rewrite."_ This deletes 458 rows across those three tables. The rule must
   be amended before it is broken, same pattern #169 used. Do not route around it.

3. **Sowmya notified.** She signed in today. 47 manual touches are hers. She should
   know the app will be empty before she opens it, not after.

---

## 5. Execution

Script: `full-wipe-all-orgs.sql`. Human runs it in the SQL editor. **No agent, no MCP.**

| Step  | Action                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Preflight inventory. Paste output into PR body.                                                                                                                  |
| Guard | Aborts unless 15 orgs, 1 sowmya@minted.com, 269 global payers.                                                                                                   |
| 1     | Ledgers: `touches`, `status_history`                                                                                                                             |
| 2     | Leaves: `tasks`, `notes`, assignments, `state_licenses`, `group_insurance_policies`                                                                              |
| 3     | `credential_cases`, `contracts`                                                                                                                                  |
| 4     | `sop_template_versions`, `sop_templates`, `providers`, `launches`, `facilities`, `msos`, `payers`, `portals`, `portal_field_maps`, `status_configs`, `audit_log` |
| 5     | `organizations` (cascades ~20 tables)                                                                                                                            |
| 6     | Orphaned `parties`                                                                                                                                               |
| 7     | `auth.users` via admin API, **separate, after commit**                                                                                                           |

### Why the order is not negotiable

- 19 tables carry `NO ACTION` FKs to `organizations`. A bare
  `DELETE FROM organizations` fails.
- `facilities` is CASCADE from org but **must be deleted explicitly**.
  `facilities.status_id → status_configs` is NO ACTION and
  `status_configs.org_id → organizations` is NO ACTION, so the cascade deadlocks
  against itself.
- `sop_template_versions` has no `org_id`. Reachable only via `template_id`.
- `touches.corrects_touch_id` is a NO ACTION self-FK. Checked at end of statement,
  so one DELETE covering all rows is safe.

Verified against `pg_constraint` on 2026-07-17. Do not reorder without re-tracing.

---

## 6. Verification

Post-run query is in the script. Expected end state:

```
orgs 0 | cases 0 | providers 0 | touches 0 | audit_log 0 | parties 0
memberships 0 | users 1 | payers 269 | portal_field_maps 24
sop_templates 1 | party_role_types 6
```

Then re-run the payer drop inventory. Every column on the `20260716180000` drop list
should read 0 non-null, which unblocks that migration.

---

## 7. Risks Devin should weigh

| #   | Risk                                                                                                                                                                                                                                                                                           | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **KFP is unrecoverable outside the snapshot.** No `import_runs` row exists. 47 manual touches and 260 audit rows from June 23 to today were hand-entered.                                                                                                                                      | High     |
| 2   | **CI will likely go red.** 9 PRs merged today (#171–#178) build SOP resolution: version tiers, generic fallback, drafts, run traceability. After this, `sop_templates` has 1 row. Any e2e spec asserting on tiers or seed-universe scenarios TS-100–103 fails. Gate 0 then blocks every merge. | High     |
| 3   | **Storage orphans.** `provider_documents` rows cascade; bucket objects do not. Files persist with no DB row. Separate sweep needed.                                                                                                                                                            | Medium   |
| 4   | **Portal registry gap.** The 24 global `portal_field_maps` survive. The 1 `portals` row was KFP-scoped and dies. They join on `portal_key` text with no FK, so no error, just field maps for an unregistered portal. Re-seed `portals` as global before the next fill test.                    | Medium   |
| 5   | **Migration drift is still open.** `20260716180000` (PR #169) is unapplied on hosted, while `20260716212658` and `20260716212728` (PR #170) are applied. Hosted has later migrations without the earlier one. This wipe does not fix that.                                                     | Medium   |

---

## 8. Rollback

`pg_restore` from the Step 0 snapshot. There is no other path. If the snapshot is
unverified, there is no rollback at all.

---

## 9. What approval means

Approving this means accepting that:

- The KFP credentialing record is gone and will not be reconstructed from this DB.
- 10 SOP templates encoding BCBS KS and UHC field mappings are gone and will be
  rebuilt by hand.
- The append-only rule merged yesterday gets amended today to permit its own
  exception.
- CI may be red until the seed universe is rebuilt.

If any of those is not acceptable, the smaller move is on the shelf:
`teardown-test-orgs.sql` deletes the 14 non-KFP orgs, leaves KFP intact, and still
clears the payer drop migration. It carries none of risks 1, 2, or 4.

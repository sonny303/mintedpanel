---
name: hosted-data-sql
description: >-
  Write paste-ready SQL for Minted Panel hosted Supabase data ops (preview +
  mutate demo/UAT rows). Use when the user asks to delete/update/inspect live
  rows (cases, groups, providers, targets, etc.), when Supabase MCP is
  unauthenticated in a cloud sandbox, or when egress to *.supabase.co is
  blocked. Default deliverable is SQL for the Supabase SQL Editor — not an
  attempted remote apply.
---

# Hosted data SQL (operator paste-ready)

## Default posture

When the user asks to **change or inspect hosted data** (delete cases for a
group, wipe demo rows, count targets, fix a bad fixture):

1. **Write SQL they can paste into the Supabase SQL Editor** (project
   `fkvuhfsqcmujywzgczmc` / "openpanel").
2. Always ship a **preview block first**, then a **mutate block** in one
   transaction with an abort path.
3. Do **not** require MCP auth to answer. If MCP *is* authenticated and the
   user explicitly asks you to run it, you may execute — still show the SQL.
4. Do **not** put destructive demo cleanup into a migration file.

Cloud sandboxes often cannot reach `*.supabase.co` and Supabase MCP may be
`needsAuth`. That is expected — SQL-in-chat is the product.

## Confirm grain before mutating

Ask (or infer from wording) which grain they mean:

| They say                         | Likely grain                         |
| -------------------------------- | ------------------------------------ |
| "group X" / LLC billing entity   | `provider_groups.name`               |
| "org X" / tenant                 | `organizations.name`                 |
| "provider X"                     | `providers` (name / NPI)             |
| "cases for group X"              | `credential_cases.group_id`          |

Match names with `= 'Exact Name'` when they give a full legal name; use
`ILIKE` only when they ask to search. Always preview `id, name, org_id` (and
row counts) before DELETE.

## Non-negotiables

- **No PHI in chat logs.** Prefer counts and ids; never `SELECT` full SSN /
  vault contents.
- **`audit_log` stays.** Do not delete audit rows for cleanup; the ledger is
  append-only by product rule. Case deletes leave audit history pointing at
  gone ids — that is fine for UAT.
- **Append-only tables may still need DELETE for UAT cleanup**
  (`touches`, `status_history`, `case_status_history`). App code must not
  delete them; operator SQL Editor (table owner) may, when the human asked.
- Prefer `BEGIN; … ROLLBACK;` for the first paste when the human has not
  confirmed counts. After they confirm, give the same script with `COMMIT`.

## Template: preview + transactional delete

```sql
-- 0) Resolve the target (edit the name).
-- Preview only — run this alone first if you want.
SELECT g.id AS group_id, g.name AS group_name, g.org_id, o.name AS org_name,
       count(c.id) AS case_count
FROM public.provider_groups g
JOIN public.organizations o ON o.id = g.org_id
LEFT JOIN public.credential_cases c ON c.group_id = g.id
WHERE g.name = 'Exact Group Name, LLC'
GROUP BY g.id, g.name, g.org_id, o.name;

-- 1) Mutate (after preview looks right).
BEGIN;

CREATE TEMP TABLE _case_ids ON COMMIT DROP AS
SELECT c.id
FROM public.credential_cases c
JOIN public.provider_groups g ON g.id = c.group_id
WHERE g.name = 'Exact Group Name, LLC';

-- Sanity: should match preview case_count
SELECT count(*) AS cases_to_delete FROM _case_ids;

-- Children without ON DELETE CASCADE (must go first).
-- touches.task_id → tasks, so touches before tasks.
DELETE FROM public.touches
WHERE case_id IN (SELECT id FROM _case_ids);

DELETE FROM public.status_history
WHERE case_id IN (SELECT id FROM _case_ids);

DELETE FROM public.tasks
WHERE case_id IN (SELECT id FROM _case_ids);

-- Parent. Cascades: case_status_history, payer_pipeline_history, fill_sessions.
-- SET NULL: provider_documents.case_id, case_generation_run_rows.case_id.
DELETE FROM public.credential_cases
WHERE id IN (SELECT id FROM _case_ids);

-- Confirm zero remain for that group
SELECT count(*) AS remaining_cases
FROM public.credential_cases c
JOIN public.provider_groups g ON g.id = c.group_id
WHERE g.name = 'Exact Group Name, LLC';

-- First run: ROLLBACK;  After human confirms counts: COMMIT;
ROLLBACK;
```

### FK map for `credential_cases` (hosted)

| Child                         | On delete of case   | Operator action                          |
| ----------------------------- | ------------------- | ---------------------------------------- |
| `touches`                     | NO ACTION           | `DELETE` before cases                    |
| `tasks`                       | NO ACTION           | `DELETE` after touches, before cases     |
| `status_history`              | NO ACTION           | `DELETE` before cases                    |
| `case_status_history`         | CASCADE             | automatic                                |
| `payer_pipeline_history`      | CASCADE             | automatic                                |
| `fill_sessions`               | CASCADE             | automatic                                |
| `provider_documents.case_id`  | SET NULL            | automatic (doc rows kept)                |
| `case_generation_run_rows`    | SET NULL            | automatic (disposition row kept)         |

Re-check with:

```sql
SELECT conrelid::regclass AS child, confdeltype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE confrelid = 'public.credential_cases'::regclass
  AND contype = 'f';
```

(`confdeltype`: `a` = NO ACTION, `c` = CASCADE, `n` = SET NULL.)

## Response shape (ADHD-friendly)

1. One-line what the SQL will do.
2. Preview query.
3. Mutate transaction (`ROLLBACK` until they confirm).
4. "Paste into Supabase → SQL → run preview → if counts look right, change to `COMMIT`."

Do not open with MCP auth troubleshooting unless they asked you to run it yourself.

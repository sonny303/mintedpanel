# 3M UAT readiness checklist

Process map: [`repo-workflow.md`](./repo-workflow.md).  
Sowmya audit: [`3m-slice-4-sowmya-audit.md`](./3m-slice-4-sowmya-audit.md).  
Slice 5 close-out: [`3m-slice-5-closeout.md`](./3m-slice-5-closeout.md).

---

## Baseline — complete

| Repo             | Notes                                                             |
| ---------------- | ----------------------------------------------------------------- |
| mintedpanel      | Slices 0–3 + Slice 6 spike on `main` (through #270 / #269 / #268) |
| minted-extension | Slices 1–3 on `main` (#35 / #36 / #37)                            |

- [x] Both repos synced to `origin/main` for Slice 0+
- [x] Epic collision watch noted: `portals.ts`, `extensionRoutes.ts`, `payers.ts`, `payerSetup.ts`, extension `sidepanel/main.ts`

---

## Hosted Supabase — verify by SCHEMA STATE, never by version string

An agent session **may** have Supabase MCP access (`execute_sql`,
`apply_migration`). Check before assuming: if the tools answer, these boxes are
agent-verifiable and should be filled in, not left as inventory. The older
"no Supabase credentials / MCP is desktop-only" claim was wrong often enough to
cause a wasted audit — treat access as a thing to test, not a known constant.

### THE TRAP: repo filenames are not hosted migration versions

`supabase_migrations.schema_migrations.version` records the timestamp the
migration was applied **under**, and `apply_migration` (MCP) mints its own. A
file named `20260809120100_*.sql` can be live on hosted under version
`20260808024259`. They are two different numbering spaces.

So this comparison is **always wrong** and will report healthy migrations as
missing:

```sql
-- ❌ DO NOT DO THIS — filenames never match applied versions
select version from supabase_migrations.schema_migrations
where version like '20260807%';
```

**Verify the OBJECT the migration creates instead.** Policy bodies, function
signatures, and column presence are the ground truth:

```sql
-- ✅ Is a policy still gated on something a migration was meant to remove?
select qual::text like '%org_payer_assignments%' as still_gated
from pg_policies where tablename='payers' and policyname='payers_select';

-- ✅ Does a function carry the parameter / body a migration added or removed?
select pg_get_function_arguments(oid) as args, prosrc like '%...%' as has_body
from pg_proc where proname='create_payer';

-- ✅ Do the columns exist?
select count(*) from information_schema.columns
where table_name='portal_field_maps'
  and column_name in ('display_label','section','sort_order');
```

For behaviour (RLS especially) a shape check is not enough — impersonate a real
member inside a rolled-back transaction:

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','<a real member user_id>','role','authenticated')::text, true);
set local role authenticated;
select count(*) from sop_templates where org_id is null;   -- what CAN this user see?
rollback;
```

### Other hosted checks

```sql
-- Vault secret presence (never select the secret VALUE into logs/chat):
select exists (select 1 from vault.decrypted_secrets where name='ssn_vault_key')
  as vault_key_present;

select count(*) as global_portals from portals where org_id is null;
```

Provisioning steps for the vault secret: Slice 4 appendix § F1 (Dashboard → Vault →
name `ssn_vault_key`). Hosted rejects `ALTER DATABASE` custom GUCs.

### Status (verified against schema state 2026-08-11)

| Item                                     | Status                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Aug 7 party-role migrations              | ✅ applied (6 party cols, `is_default`, composite FK)                       |
| Aug 7 party-role **hardening** follow-up | ✅ applied (`set_default_party_role` live)                                  |
| E6.9 field registry + shared RPCs        | ✅ applied (3 cols; 6-arg `train_global_field_map`)                         |
| E6.9 dataFields → registry DML           | ✅ applied (140 shared rows, 139 with `sort_order`)                         |
| CAP-02 shared-propose refresh            | ✅ applied                                                                  |
| Slice 6 D6.5 global SOP read             | ✅ applied 2026-08-11                                                       |
| OPA-RETIRE assignment gate               | ✅ applied 2026-08-11 (before #285 merged)                                  |
| Slice 6 D6.1 `p_assign_to_org`           | ⛔ **RETIRED** — `.superseded`; code converged instead                      |
| Vault `ssn_vault_key`                    | ✅ present                                                                  |
| Portals non-empty for UAT                | ✅ 5 global rows                                                            |
| **Catalog purge (`20260810120000`)**     | ⏳ **NOT applied — needs 2nd PM sign-off** (260 unreferenced global payers) |
| **`types.ts` drift**                     | ⏳ **stale — regen needed** (carries the retired `p_assign_to_org` arg)     |

---

## Lane status

| Slice | Status                                                                                    |
| ----- | ----------------------------------------------------------------------------------------- |
| 0     | **Done** — #266                                                                           |
| 1     | **Done** — panel #267 + extension #35                                                     |
| 2     | **Done** — panel #268 + extension #36                                                     |
| 3     | **Done** — panel #270 + extension #37                                                     |
| 4     | **Done** — Sowmya audit appendix (`3m-slice-4-sowmya-audit.md`) + debt reconciliation     |
| 5     | **Done** — close-out (`3m-slice-5-closeout.md`); F13 env override; TD-49/TD-50 registered |
| 6     | **Next** — build from spike (`slice-6-platform-org-spike.md`); spike merged #269          |

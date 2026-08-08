# 3M UAT readiness checklist

Human sign-off for hosted Supabase + UAT before relying on fill / shared
training / Field Registry. Companion process:
[`repo-workflow.md`](./repo-workflow.md).

**Agent fills** baseline SHAs and local CI. **PM ticks** hosted boxes.

---

## Baseline (agent)

| Repo | `origin/main` SHA at Slice 0 | Local CI (2026-08-08) |
| --- | --- | --- |
| mintedpanel | `5843fcf2f8a5026365d5f8df83c0c13d601ec337` | **Green** — `npm ci`; lint 0 errors (14 pre-existing warnings); vitest **134 files / 1636 tests** passed |
| minted-extension | `76721fce421d71cae91a8b44eaf4ce9c4f27a8e4` | **Green** — typecheck + lint clean; vitest **14 files / 172 tests** passed |

Notes:

- Panel `#263` / E6.9 shared-portals + field-registry surfaces are on this SHA.
- Extension `#34` (E6.9 PR2 Train/Case mode + `GET /api/shared-portals`) is on this SHA.
- Epic collision watch for later 3M slices: `portals.ts`, `extensionRoutes.ts`,
  `payers.ts`, `payerSetup.ts`, extension `sidepanel/main.ts`.

---

## Hosted migrations (PM)

Apply in filename order if missing. Repo paths under `supabase/migrations/`:

- [ ] `20260807130000_people_contact_roles.sql`
- [ ] `20260807130100_people_contact_role_rpcs.sql`
- [ ] `20260807150937_harden_party_role_tenant_integrity.sql`
- [ ] `20260807160000_e69_field_registry.sql`
- [ ] `20260807160100_e69_shared_registry_rpcs.sql`
- [ ] `20260807170000_e69_datafields_to_registry.sql`

Verify (SQL Editor):

```sql
-- Expect rows for the migrations above (names may appear in schema_migrations
-- or supabase_migrations.schema_migrations depending on project setup).
select * from supabase_migrations.schema_migrations
where version like '20260807%'
order by version;
```

- [ ] Regenerated/hosted types not drifting from repo after apply (see open PR #264 if needed)

---

## Vault (PM)

- [ ] `app.settings.ssn_vault_key` set on hosted DB  
  (ROADMAP-STATUS R6 operator task — vault RPCs fail closed until set)

```sql
-- Presence check (do not SELECT the secret value into logs/chat):
show app.settings.ssn_vault_key;
```

- [ ] Knowingly deferred (document date / reason): _______________

---

## Portals / UAT fill (PM)

Empty `portals` registry ⇒ extension fill/capture silent no-op.

```sql
-- Global shared portals
select count(*) as global_portals
from portals
where org_id is null;

-- Optional: portals for a specific UAT org
-- select count(*) from portals where org_id = '<uat-org-uuid>';
```

- [ ] At least one global or UAT-org portal with non-null `form_url` and `portal_key`
- [ ] Prefer non-null `payer_id` on portals used for Train / fill UAT

---

## After this checklist

| Next | Owner |
| --- | --- |
| Merge Slice 0 PR | PM |
| Execute Slice 1 (open-cases / portals empty-state / fill tests) | Cloud Agent |
| Execute Slice 6 (platform vs org payer overhaul) after Slice 1 | Cloud Agent |

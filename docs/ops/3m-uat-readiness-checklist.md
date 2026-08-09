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

## Hosted Supabase — not verified from agent

This Cloud Agent environment has **no Supabase credentials** and the Supabase MCP
server is often `needsAuth` (desktop-only auth). Hosted checks below are inventory
for whoever has SQL Editor / Vault access — **not** a blocking gate for Slice 6
code, but required before full-SSN / Field Registry UAT.

Migrations expected on hosted (filename order):

- `20260807130000_people_contact_roles.sql`
- `20260807130100_people_contact_role_rpcs.sql`
- `20260807150937_harden_party_role_tenant_integrity.sql`
- `20260807160000_e69_field_registry.sql`
- `20260807160100_e69_shared_registry_rpcs.sql`
- `20260807170000_e69_datafields_to_registry.sql`

```sql
select version from supabase_migrations.schema_migrations
where version like '20260807%'
order by version;

-- Vault secret presence (do NOT select the secret value into logs/chat):
select exists (
  select 1 from vault.decrypted_secrets where name = 'ssn_vault_key'
) as vault_key_present;

select count(*) as global_portals from portals where org_id is null;
```

Provisioning steps for the vault secret: Slice 4 appendix § F1 (Dashboard → Vault →
name `ssn_vault_key`). Hosted rejects `ALTER DATABASE` custom GUCs.

| Item                          | Agent status                  | PM / ops |
| ----------------------------- | ----------------------------- | -------- |
| Aug 7 migrations applied      | **Unverified** — no DB access | [ ]      |
| Vault `ssn_vault_key`         | **Unverified** — no DB access | [ ]      |
| Portals non-empty for UAT     | **Unverified** — no DB access | [ ]      |
| Types/migrations drift (#264) | **Unverified** — no DB access | [ ]      |

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

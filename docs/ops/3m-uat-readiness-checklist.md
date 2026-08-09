# 3M UAT readiness checklist

Status after Slice 0 merge (`5a07308`, 2026-08-09). Process map:
[`repo-workflow.md`](./repo-workflow.md).

---

## Baseline — complete

| Repo | `origin/main` SHA | Local CI (2026-08-08) |
| --- | --- | --- |
| mintedpanel | `5843fcf` at Slice 0 open; **merged as `5a07308`** | **Green** — lint 0 errors; vitest **134 / 1636** passed |
| minted-extension | `76721fc` (#34 Train/Case on main) | **Green** — typecheck/lint clean; vitest **14 / 172** passed |

- [x] Both repos synced to `origin/main` for Slice 0
- [x] Slice 0 docs merged (PR #266)
- [x] Epic collision watch noted: `portals.ts`, `extensionRoutes.ts`, `payers.ts`, `payerSetup.ts`, extension `sidepanel/main.ts`

---

## Hosted Supabase — not verified from agent

This Cloud Agent environment has **no Supabase credentials** and the Supabase MCP
server is `needsAuth` (desktop-only auth). Hosted checks below were **not run**.
They are inventory for whoever has SQL Editor access — not a blocking gate for
Slice 1 code work.

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

-- vault presence (do not log the secret):
show app.settings.ssn_vault_key;

select count(*) as global_portals from portals where org_id is null;
```

| Item | Agent status |
| --- | --- |
| Aug 7 migrations applied | **Unverified** — no DB access |
| Vault `ssn_vault_key` | **Unverified** — no DB access |
| Portals non-empty for UAT | **Unverified** — no DB access |
| Types/migrations drift (#264) | **Unverified** — no DB access |

---

## Lane status

| Slice | Status |
| --- | --- |
| 0 | **Done** (merged #266) |
| 1 | Next — open-cases → `case_status`, portals empty-state, fill/inject tests |
| 6 | Queued after Slice 1 — platform/org payer overhaul |

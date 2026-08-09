# 3M UAT readiness checklist

Human sign-off for hosted Supabase + UAT before relying on fill / shared
training / Field Registry. Companion process:
[`repo-workflow.md`](./repo-workflow.md).

**Agent fills** baseline SHAs and local CI. **PM ticks** hosted boxes.

---

## Baseline (agent)

| Repo             | `origin/main` SHA at Slice 0               | Local CI (2026-08-08)                                                                                    |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| mintedpanel      | `5843fcf2f8a5026365d5f8df83c0c13d601ec337` | **Green** — `npm ci`; lint 0 errors (14 pre-existing warnings); vitest **134 files / 1636 tests** passed |
| minted-extension | `76721fce421d71cae91a8b44eaf4ce9c4f27a8e4` | **Green** — typecheck + lint clean; vitest **14 files / 172 tests** passed                               |

Notes:

- Panel `#263` / E6.9 shared-portals + field-registry surfaces are on this SHA.
- Extension `#34` (E6.9 PR2 Train/Case mode + `GET /api/shared-portals`) is on this SHA.
- Epic collision watch for later 3M slices: `portals.ts`, `extensionRoutes.ts`,
  `payers.ts`, `payerSetup.ts`, extension `sidepanel/main.ts`.

---

## Hosted migrations (PM)

Apply in filename order if missing. Repo paths under `supabase/migrations/`:

- [x] `20260807130000_people_contact_roles.sql`
- [x] `20260807130100_people_contact_role_rpcs.sql`
- [x] `20260807150937_harden_party_role_tenant_integrity.sql`
- [x] `20260807160000_e69_field_registry.sql`
- [x] `20260807160100_e69_shared_registry_rpcs.sql`
- [x] `20260807170000_e69_datafields_to_registry.sql`

**All six verified applied on hosted 2026-08-09** (agent, MCP `execute_sql`).

> **Match on `name`, not `version`.** A migration applied through MCP
> `apply_migration` is stamped with its OWN timestamp, not the repo filename's.
> The three E6.9 migrations landed as `20260808…`, so the original
> `version like '20260807%'` filter returned 4 of 6 and read as "three
> missing" — do not re-apply on that basis.

Verify (SQL Editor):

```sql
-- Match on name; hosted `version` will not equal the repo filename prefix.
select version, name
  from supabase_migrations.schema_migrations
 where name in (
   'people_contact_roles',
   'people_contact_role_rpcs',
   'harden_party_role_tenant_integrity',
   'e69_field_registry',
   'e69_shared_registry_rpcs',
   'e69_datafields_to_registry'
 )
 order by version;   -- expect 6 rows
```

Structural spot-check (guards the 2026-08-08 outage surface — code shipped
selecting `portal_field_maps.display_label/section/sort_order` while the
migration was still repo-only, and every browser read 400'd):

```sql
select count(*) as registry_cols   -- expect 3
  from information_schema.columns
 where table_schema = 'public' and table_name = 'portal_field_maps'
   and column_name in ('display_label','section','sort_order');
```

- [x] Verified present 2026-08-09 (3/3) — E6.9 shared-tier RPCs also present (3/3)
- [ ] Regenerated/hosted types not drifting from repo after apply (see open PR #264 if needed)

---

## Vault (PM)

- [ ] `app.settings.ssn_vault_key` set on hosted DB  
      (ROADMAP-STATUS R6 operator task — vault RPCs fail closed until set)

**Verified 2026-08-09: NOT SET** (agent). Consequence today — every E4.4 vault
path fails closed: `store_ssn`, `reveal_ssn`, `release_ssn_for_fill`, and the
`/ssn-intake/$token` public ingress. `ssn_last4` and the masked UI are
unaffected (they don't touch the vault), so this does not block UAT of
anything else — but full-SSN capture cannot be exercised until the key exists.

```sql
-- Presence check. Boolean only — never SELECT the secret into logs/chat.
-- (`show app.settings.ssn_vault_key` ERRORS when unset; this returns false.)
select coalesce(current_setting('app.settings.ssn_vault_key', true), '') <> ''
  as vault_key_set;
```

- [ ] Knowingly deferred (document date / reason): _______________

---

## Portals / UAT fill (PM)

Empty `portals` registry ⇒ extension fill/capture silent no-op.

```sql
select p.portal_key, p.name,
       (p.form_url is null) as form_url_null,
       p.is_verified, (p.proven_at is not null) as proven,
       pa.name as payer_name,
       (select count(*) from portal_field_maps m
         where m.portal_key = p.portal_key and m.org_id is null) as shared_maps,
       (select count(*) from portal_field_maps m
         where m.portal_key = p.portal_key and m.org_id is null
           and m.status = 'approved' and m.token is not null) as fillable_maps
  from portals p
  left join payers pa on pa.id = p.payer_id
 where p.org_id is null
 order by p.portal_key;
```

- [x] At least one global or UAT-org portal with non-null `form_url` and `portal_key`
- [x] Prefer non-null `payer_id` on portals used for Train / fill UAT

**Verified 2026-08-09** (agent): 5 global portals, 0 org portals; all 5 carry a
`payer_id`. Registry is NOT empty, so the silent-no-op condition does not apply.
Three findings the counts alone hide:

| Portal                                     | State                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `bcbs_ks_enrollment`                       | 24 shared maps, **19 fillable** — the only portal a real fill exercises                                        |
| `anthem-colorado`                          | **`form_url` IS NULL** — `matchPortalByUrl` can never match it, so it is unreachable for both fill and capture |
| `aetna-network`, `tricare_east_enrollment` | **`proven_at` stamped with 0 fillable maps**                                                                   |
| `anthem_bcbs_ca`                           | registered, 0 maps — expected pre-training                                                                     |

`proven_at` on an untrained form is a **false green**. The E6.5 dry run passes
when zero fields come back unmatched, and a form with no mappings has nothing to
mismatch — so it proves vacuously. Anything reading "proven" as ready-to-fill
(the readiness funnel's `formState`, the Payer Setup next-action) will skip a
form that fills nothing. Two live rows are in that state today.

- [ ] PM call: treat `proven` as requiring ≥1 fillable mapping (Slice 1 candidate),
      or accept and re-prove the two rows after training
- [ ] PM: give `anthem-colorado` a `form_url`, or drop the row until its URL is known

---

## After this checklist

| Next                                                            | Owner       | State                                       |
| --------------------------------------------------------------- | ----------- | ------------------------------------------- |
| Merge Slice 0 PR                                                | PM          | **Done** — #266 merged 2026-08-09           |
| Hosted migrations                                               | PM          | **Done** — 6/6 verified 2026-08-09          |
| Portals seeded                                                  | PM          | **Done** — 5 global; 2 caveats above        |
| Vault key                                                       | PM          | **Open** — not set; vault paths fail closed |
| Execute Slice 1 (open-cases / portals empty-state / fill tests) | Cloud Agent | Not started                                 |
| Execute Slice 6 (platform vs org payer overhaul) after Slice 1  | Cloud Agent | Not started                                 |

Slice 1 carries no written spec in this repo — its scope lives in the Cloud
Agent run. The portal findings above are input to its "portals empty-state"
half: the real empty state is not an empty TABLE (5 rows) but a registered
portal that cannot fill — no `form_url`, or `proven` with zero mappings.

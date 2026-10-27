# Catalog sync: production to staging

Keeps staging's shared catalog at least as complete as production's. **Additive
only**: rows missing on staging are inserted; nothing is updated or deleted, so
staging-only test rows and staging edits survive.

## What it copies

| Table                                     | Rule                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `payers`                                  | missing ids                                                          |
| `portals`                                 | missing ids; org-owned rows only if the org exists on staging        |
| `portal_field_maps`                       | only for portals added in the same run                               |
| `sop_templates` + `sop_template_versions` | missing ids; staging's guard triggers decide, rejects are reported   |
| `payer_forms` + Storage `payer-forms`     | missing ids with their payer and template on staging; file is copied |

`created_by` / `published_by` / `retired_by` are dropped (those users do not
exist on staging).

## Run

```sh
export SYNC_SOURCE_URL=https://fkvuhfsqcmujywzgczmc.supabase.co   # production
export SYNC_SOURCE_SERVICE_KEY=...                                  # production service role
export SYNC_TARGET_URL=https://vmznysvietfaddakkegt.supabase.co    # staging
export SYNC_TARGET_SERVICE_KEY=...                                  # staging service role

npm run sync:catalog-to-staging              # dry run, prints what would be added
npm run sync:catalog-to-staging -- --apply   # writes
```

The script refuses any other source/target pair. Keys come from the operator's
shell; never commit them. Cloud sandboxes block egress to `*.supabase.co`, so
run it from a local machine.

## Known skips (2026-10-27 run)

Staging's guards reject some production rows. They stay skipped, by design:

- `Anthem BCBS CO`, `Medcost - NC`, `Trinity Health System`: production has
  `case_type` NULL (legacy); staging requires one on insert.
- `Aetna - Direct` (archived, contract): points at portal
  `aetna-direct-contract-contract-1f94bf43c4c0`, which does not exist on
  production either.

Rows that exist on both sides but differ (production ahead) are **not**
updated. Promote those deliberately.

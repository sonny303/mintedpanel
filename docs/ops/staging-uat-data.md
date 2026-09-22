# Staging UAT data

Synthetic fixture only. It contains no PHI, production identifiers, or real credentials.

## Operator contract

| Action                        | Command                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Create or repair              | `npm run seed:staging-uat`                                                       |
| Restore disposable cases only | `npm run seed:staging-uat -- --reset deletion-pool`                              |
| Rebuild all owned rows        | `npm run seed:staging-uat -- --reset all --confirm "REBUILD MINTED UAT FIXTURE"` |
| Verify                        | `npm run verify:staging-uat`                                                     |

Required protected environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UAT_DATABASE_URL`, `UAT_SHARED_PASSWORD`. Verification of real sign-in and RLS also uses `UAT_SUPABASE_ANON_KEY`. The runner accepts only the fixed staging project `vmznysvietfaddakkegt` or loopback local Supabase. It never prints secrets.

## Personas

| Email                                 | Role       | Organization   | Scenario                                                   |
| ------------------------------------- | ---------- | -------------- | ---------------------------------------------------------- |
| `uat.admin.alpha@minted.invalid`      | Admin      | Organization 1 | Full workflow, deletion pool, generation runs              |
| `uat.specialist.alpha@minted.invalid` | Specialist | Organization 1 | Daily case and touch workflow; no admin destructive access |
| `uat.admin.beta@minted.invalid`       | Admin      | Organization 2 | Tenant-isolation checks                                    |
| `uat.admin.gamma@minted.invalid`      | Admin      | Organization 3 | Tenant-isolation checks                                    |

All personas use the shared protected password. Auth users are reusable only when their metadata carries the exact `minted_uat_fixture.version` marker.

## Scenario map

| Scenario                                               | Exact fixture IDs                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Shared workflow cases                                  | `fixtureUuid("case", 1..40)`                                                       |
| Disposable deletion pool                               | `fixtureUuid("case", 41..50)`; expanded in `scripts/uat/uat-fixture-manifest.json` |
| Approved deletion + live enrollment + active exclusion | `fixtureUuid("case", 46)`                                                          |
| Generation-created deletion cases                      | `fixtureUuid("case", 41..50)` and `fixtureUuid("generation-run", 1)`               |
| Primary and secondary locations                        | deletion cases 41–50 in `case_facilities`                                          |
| Correction chains                                      | `fixtureUuid("touch", 51..60)` correcting touches 1–10                             |
| Invalid payer-state catalog example                    | UAT Payer 8 supports only UT; the remaining payers support CO/WY                   |

`scripts/uat/uat-fixture-manifest.json` is the reset boundary. Never select seed-owned rows by display name, wildcard, or a guessed organization.

## Deletion acceptance

Delete case 46 through `delete_case`. Direct/cascade children must disappear; its generation row keeps the immutable receipt with `case_id = NULL`; the live enrollment becomes expired; the active exclusion becomes voided; the audit `DELETE` receipt remains; and `--reset deletion-pool` restores all ten cases without changing cases 1–40.

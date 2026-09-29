# Live migration lineage crosswalk

Captured read-only on 2026-09-28 at 22:23 UTC from Panel `main`
`671f9c19edafc93e4e1af7373c94c7cd170e9cd5`, staging
`vmznysvietfaddakkegt`, and production `fkvuhfsqcmujywzgczmc`.
[`lineage-crosswalk.json`](lineage-crosswalk.json) lists every one of the 120
source SQL paths with its SHA-256 and all hosted ledger versions sharing its
filename suffix, then lists every hosted ledger entry without that source name.
The hosted ledgers contain 143 staging and 145 production entries.

| Comparison                                    | Staging | Production |
| --------------------------------------------- | ------: | ---------: |
| Exact source version also in hosted ledger    |      18 |         18 |
| Source filename suffix also in hosted ledger  |     108 |        108 |
| Source name with no hosted ledger name        |      12 |         12 |
| Hosted entries with no source filename suffix |      34 |         36 |

The name join is an investigation index, **not** a migration state. A shared
name can hide different SQL; a missing name can still correspond to applied
objects under a renamed migration. The duplicate source version
`20260903210000` prevents the current inventory from being a unique Supabase
hosted-runner input. Do not mark any entry applied, rename historical files, or
execute the source-only list from this crosswalk.

| Source names absent from both hosted ledgers                                                                                                                    | Next proof required                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `baseline_live_schema`, `ssn_vault`, `ssn_intake_links`, `ssn_vault_key_via_supabase_vault`, `e45_provider_documents_activation`, `e45_document_storage_bucket` | Compare objects, grants, Vault/Storage configuration and historical provenance; preserve credential isolation.    |
| `payer_dead_column_drop_superseding`, `case_number`, `bite_cap02_shared_propose_presentation_refresh`                                                           | Compare live schema/function behavior to source SQL and determine whether each is superseded, partial or missing. |
| `group_contracts_matrix_fields`, `portal_field_maps_flywheel`, `filler_outcome_v2_contract`                                                                     | Confirm absent columns/functions and rehearse these three feature migrations on restored populated baselines.     |

The production-only hosted entries are `20260926143900
grant_service_role_auth_users` and `20260926170000
fix_e612_authz_owner_schema_auth`. The first affects Auth grants; the second
has a known `resolve_enrollment_context` security-mode difference: staging is
`SECURITY DEFINER`, production is `SECURITY INVOKER`, and source specifies
invoker. SQL body equality alone does not settle that difference. Inspect the
actual hosted migration statements, current owner/search path/grants and tenant
tests before writing an additive correction.

A further read-only object probe on both projects found the selected footprints
of the eight source-only names other than the baseline and three feature
migrations: `provider_ssn_vault`, `provider_ssn_intake_links` and their named
functions; all three provider-document version columns and the document storage
function; zero of the eleven payer legacy columns and no old case payer ID;
the case-number sequence, column and immutability function; and a
`propose_shared_field_map` function. This confirms **presence of selected
effects**, not complete SQL, grants, policy, Vault or Storage equivalence. The
1,249-line `baseline_live_schema` needs its own object-level comparison. None
of these nine names should be replayed based on missing ledger names.

Next owner PR: an object-level crosswalk with the exact proposed SQL and route,
reviewed environment plans, and route-specific rehearsal results. The owner
clarified on September 28 that staging data is disposable: staging may use a
reviewed reset and owned synthetic reseed instead of preserving its current
rows. The completed staging encrypted capture and isolated restore remain
baseline evidence. Production still requires its independent backup/restore,
populated rehearsal, and row-preservation proof. This read-only snapshot does
not satisfy `PLAN_READY`.

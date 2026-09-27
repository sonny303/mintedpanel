# Repository model versus preserved staging

Requirement AUD-02. Source `94b586f20162fe38982f7a478eb4216e3897b3aa` was replayed into a new, empty, isolated PostgreSQL 17.6 database on September 23 UTC. All **113 SQL files** applied in filename order. No hosted database, UAT seed, production records, or secrets were used.

This is a source-model comparison, not Supabase migration-history reconciliation. Direct SQL replay does not resolve the two historical files with the same migration version. The small local Auth bootstrap is not proof of an operational Auth service.

| Comparison                                         |             Measured result |
| -------------------------------------------------- | --------------------------: |
| Fresh source-model public tables / columns         |                    60 / 747 |
| Existing staging public tables / columns           |                    53 / 647 |
| Required missing source columns                    |                         119 |
| Existing staging legacy columns absent from source |                          19 |
| Shared column type/default/nullability differences |                           1 |
| Additive target preserving existing staging        | **61 tables / 766 columns** |

The 19 retained legacy columns consist of seven columns in the existing `notes_pre_touchlog_backup` table and twelve columns on current tables (`credential_cases.payer_provider_id` and eleven older payer fields). Retain this existing staging table and these fields. This does not authorize copying any production operator-backup table.

The one shared-column difference is `portals.org_id`: staging requires a value; the source model permits NULL for shared portals. Its nullability change belongs with the reviewed shared-registry policies and grants. Do not change it in isolation.

The source model also has 78 public function signatures. Function-body, ownership, permission, trigger and constraint reconciliation still require object-level review; matching counts alone cannot establish parity. The [ordered alignment plan](staging-alignment-plan.md) remains the source map for the additive delta, and the [live data preflight](staging-alignment-preflight-results.md) identifies its data exceptions.

Private local metadata artifacts preserve the model catalog, per-file SHA-256 inventory and column-level comparison under the audit context directory. No application schema alignment has been applied to staging by this model replay.

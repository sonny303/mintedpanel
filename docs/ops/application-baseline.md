# Local application baseline qualifier

`scripts/recovery/application-baseline.mjs` qualifies one restored local target
against one fresh sealed capture. It is an application baseline receipt, not a
release decision.

| Proof            | Boundary                                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public catalog   | Exact canonical comparison of the public schema, relations, columns, aggregates, types, enums, rules, inheritance, default ACLs, and sequence definitions/ownership/ACLs. OID-only differences are normalized to names; semantic fields remain in the comparison. |
| Data and lineage | Existing physical-table row-hash verifier is reused. Auth, Storage, and Supabase migration ledgers are recomputed by named table and compared to the sealed capture lineage digest.                                                                               |
| Sequences        | `last_value` must be greater than or equal to the captured value. A non-MVCC increase is recorded as drift; equality is never required.                                                                                                                           |
| Managed services | Storage bucket count and object count are observed as zero. Only the `ssn_vault_key` count is observed; secret values and secret metadata are never exported.                                                                                                     |
| Clone separation | The prior Auth/REST qualifier clone is proven destroyed; retained untouched baseline and rehearsal clones are independently verified from the same capture. Clone IDs differ; reviewed code hashes and capture/artifact/schema/lineage bindings match.            |

The operator entry reads `capture.json`, the retained `restore-baseline.json`
and `restore-rehearsal.json` pair, `restore-auth-rest.json`, and
`auth-rest.json` from the private workspace. It inspects the sealed backup,
parses the archive TOC in memory, invokes the existing read-only restore
verifier against both retained targets, then queries both through the fixed
Docker/local SQL path. It does not create or destroy targets. Adapter seams
exist only for tests. Missing source service counts, catalog fields, receipts,
or cleanup evidence fail closed.

The only success status is `LOCAL_APPLICATION_BASELINE_VERIFIED`. Every receipt
sets `releaseAdmission` to `BLOCKED` and `qualifiedRecoveryScopes` to `[]`.
The existing full restore verifier remains responsible for constraints,
indexes, functions, policies, triggers, roles, extensions, row hashes, and
outbound checks; this module only supplements the named public catalog gaps.
Storage, Vault, hosted runtime, deployment, and production release remain held.

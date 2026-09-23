# Tracked schema migrations

Status: runner implemented and tested on disposable PostgreSQL; hosted activation
is held. This PR does not reconcile either live database or measure the reported
119-column gap. It does not grant permission to merge, repair history, or deploy.

## Requirements

| ID   | Requirement                                                               | Evidence                                                                            |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| MT-1 | Committed SQL is the normal schema-change source; preserve historical SQL | Inventory lock protects 113 SQL files; new versions must be unique and later        |
| MT-2 | Apply pending versions once and verify actual schema                      | Pinned Supabase CLI 2.117.0; real ledger/rerun test and catalog digest postcheck    |
| MT-3 | Never replay an unresolved baseline into populated data                   | Both committed environment plans block readiness; unknown/partial history fails     |
| MT-4 | Wrong database, changed SQL or schema drift blocks release                | Project URL allowlist, cluster identity, file hashes, before/after catalog digests  |
| MT-5 | Preserve release approval and serialization                               | Existing workflow concurrency and controller lease; adapter failure stops promotion |
| MT-6 | Failure is visible and does not silently advance deployment               | Nonzero CI/release gate; no retry, repair, reset or database undo path              |

Scope: `scripts/migrations/`, CI and release workflow gates, the delivery adapter
contract tests, and operating documentation. No application table or grant changes.

Table trace: read `pg_catalog` and `supabase_migrations.schema_migrations`; the
Supabase runner writes migration history and only the reviewed migration SQL.
Application rows are not collected or logged. No new npm dependency is required.

## Pipeline

1. Every PR/push runs **Migration runner** against a disposable PostgreSQL service.
   It checks immutable file hashes against both the lock and PR/push base,
   duplicate/backdated additions, actual CLI
   version tracking, repeat execution, rollback on SQL failure and schema drift.
2. Existing staging and production workflows require a reconciled environment
   plan before delivery; production fails before asking for approval when its
   plan is unresolved. These workflows retain their explicit dispatch triggers.
3. The concrete adapter in `scripts/migrations/delivery.mjs` implements the
   controller's existing `services.applyMigration` seam. It binds the request to
   the exact release, target, source, migration plan and inventory.
4. After authenticated backup/rehearsal/approval and acquisition of the existing
   release lease, the controller calls the runner before application promotion.
   It runs `db push --dry-run`, rechecks the database, then `db push`. Both use
   `--skip-vault`; neither seeds, includes roles, repairs history nor uses
   `--include-all`. Only a temporary copy of the reviewed SQL is given to the CLI.
5. The runner compares the resulting ledger and catalog with the rehearsed
   result. A fully applied ledger is a no-op only if the schema also matches.
   A partial batch fails reconciliation on the next attempt; no blind resume.

**Hosted limitation:** the repository's authenticated provider factory is still
activation-blocked. This PR supplies its concrete migration adapter and adds
readiness gates; it does not bypass that factory or its other release blockers.
No hosted secret references are added. Wiring the factory to the approved
credential and authenticated release bundle remains part of activation below.
The `readiness` command only validates a committed plan; it is not runtime proof.

## One-time reconciliation and activation

Perform separately for staging and production. Existing alignment PRs #402 and
#406 are dependencies to assess, not migrations this runner may silently replay.

| Order | Required work                                                                                              | Acceptance artifact                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Capture fresh project identity, cluster system identifier, complete ledger, and actual application catalog | Encrypted capture tied to target and capture time                                                                                       |
| 2     | Verify backup and isolated restore; freeze out-of-band schema writers                                      | Successful recovery evidence and exact baseline digests                                                                                 |
| 3     | Crosswalk every source migration to actual objects and ledger entries                                      | Applied, missing, partial, superseded and conflicting changes explicitly classified                                                     |
| 4     | Resolve duplicate `20260903210000` and the historical baseline                                             | Reviewed lineage transition with exact SQL hashes; do not rename files or bulk-mark applied in this PR                                  |
| 5     | Rehearse the preservation-aware additive upgrade on the restored database                                  | Row/relationship preservation, RLS/grants, Auth/REST and old/new application compatibility                                              |
| 6     | Apply only the approved reconciliation and ledger repair, then recapture                                   | Canonical unique source inventory matches a known ledger prefix; real objects prove each applied entry                                  |
| 7     | Commit each environment's reconciled plan                                                                  | Fields below, with evidence references reviewed in the PR; no environment-variable PASS override                                        |
| 8     | Connect `createHostedMigrationExecutor` inside the authenticated provider factory                          | Exact source checkout, correct project-bound credential, release bundle, backup/rehearsal and lease checks; close the adapter after use |
| 9     | Exercise staging before production and add **Migration runner** to required checks                         | Successful hosted run, deliberate denial tests, and separately approved production run                                                  |

Do not reset a populated database. `migration repair` only changes history; it
does not create missing columns, functions, policies or grants. Never declare
an entry applied based only on its filename or an empty dry-run.

The reconciliation plan must have `status: "reconciled"`, the captured
`systemIdentifier`, an exact `inventory` of `{ id, path, sha256 }`, a nonempty
`baselineVersions` prefix, and `baselineSchemaDigest` / `resultSchemaDigest`.
Digests must be computed with this runner's `catalog.sql` and `canonicalDigest`
on the before/after rehearsed states, then bound to the release contract; do not
substitute another collector's differently shaped digest. New releases update
the reviewed plan together with SQL, including no-change releases after a
partially applied predecessor has been reconciled.

Current duplicate versions are tolerated **only by the historical inventory
check**, with their exact hashes retained. The hosted runner rejects every
duplicate, including this one. Existing UAT's temporary rename is not a hosted
lineage decision. Two pre-existing `.sql.superseded` files remain excluded.

## Credentials, concurrency and schema coverage

Use a project-specific database credential held only by the corresponding GitHub
Environment. The adapter accepts only the fixed project's direct Postgres host,
port 5432, database/user `postgres`, and `sslmode=verify-full` with an approved
root certificate where required. Pooler/arbitrary endpoints are rejected. Do
not log URLs, SQL output or credentials; subprocess errors emit a fixed code.

GitHub concurrency uses `cancel-in-progress: false`; the existing controller's
lease covers mutation and verification. All schema writers must use this lane.
These controls cannot prevent an administrator from changing the database
outside CI. Keep SQL-editor schema writes prohibited; an emergency change needs
an incident record, matching source migration and reconciliation before release.

The catalog digest covers public/private relations, columns (including types,
nullability and defaults), constraints, indexes, functions, policies, triggers,
views, enum labels and schema-specific default ACLs. It is not proof of Auth,
Storage, Vault key configuration, all PostgreSQL object types or row-level
business correctness. Existing hosted release checks remain mandatory.

Each ordinary migration and its ledger record are transactionally applied by
the pinned CLI; the real test verifies this for ordinary transactional SQL.
Explicit transaction control/nontransactional statements require separate review.
A batch can commit earlier migrations before a later migration fails. Hold the
release and reconcile that partial state; app rollback does not undo database SQL.

## Verification commands

```sh
npm run check:migrations
npm run test:migrations
npm run test:delivery
node scripts/migrations/cli.mjs readiness staging
node scripts/migrations/cli.mjs readiness production
```

The final two commands must currently exit nonzero with `RECONCILIATION_REQUIRED`.
The real database test runs when `MIGRATION_TEST_DATABASE_URL` identifies an
**empty disposable loopback database**. CI supplies this explicitly; local runs
without it report a skip, not database verification. Test-only binary path
overrides are `MIGRATION_TEST_SUPABASE` and `MIGRATION_TEST_PSQL`.

References: [Supabase migration policy](https://supabase.com/docs/guides/deployment/database-migrations),
[CI/CD environments](https://supabase.com/docs/guides/deployment/managing-environments).

# Portal field-map flywheel — Step 5 contract

## Requirement and acceptance

After a human has completed a portal submission and logged its touch, the
extension may submit a bounded receipt of accepted Nano suggestions. The API
stores only selector/token/confidence/control metadata and a URL origin+path;
it never accepts profile/form values, labels, organization IDs, actor IDs, or
frame IDs. Each suggestion must have confidence at least `0.85` and name an
exact `get_sop_field_tokens()` token or one of the code-owned `user.*` and
contact-family tokens. SSN keys are excluded.

The writer must be an admin or specialist. The database revalidates the
caller/org membership, case/provider, completed non-test web fill session,
performed-by actor, and a same-org extension portal-submission touch whose
`TOUCH_LOGGED` audit payload links that case, portal, and fill-session. The
request cannot create its own evidence. A missing or cross-org link is denied.

Existing approved, proposed, and retired maps are preserved. Exact approved
rows count as confirmed on replay; only rows newly inserted or already present
with the exact approved token count toward `confirmed_saved_count`. Inserts
and value-free CREATE audit rows commit in the same database transaction, so
an audit failure rolls back the entire batch. The existing per-tier unique
indexes arbitrate concurrent inserts.

## Contract trace

| Requirement                                         | Implementation                                                                                                             | Verification                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Writer-only; tenant and actor from verified context | `handleBatchLearnPortalFieldMaps` and `batchLearnPortalFieldMaps`                                                          | Route role tests; SQL membership-role tests                          |
| Strict, bounded, value-free receipt                 | 16 KB streamed route cap; exact root/item keys; 32 entries; URL query/hash stripped; sensitive-token and confidence checks | API handler/service tests; SQL malformed/token tests                 |
| Submission proof                                    | `learn_portal_field_maps_from_touch` joins own-org case, fill session, touch, and `TOUCH_LOGGED` audit                     | Disposable PostgreSQL foreign actor/case/fill/touch tests            |
| Exact token catalog                                 | Service reads `get_sop_field_tokens()`; RPC repeats the allowlist check and adds exact code-owned families                 | Service + SQL token tests                                            |
| Preserve decisions; honest replay                   | Existing rows are read only; partial unique indexes arbitrate races; exact approved matches count as confirmed             | SQL preservation/replay/concurrency checks                           |
| Atomic batch and audit                              | RPC prevalidates the whole batch, then writes fixed-field, value-free audit rows with maps                                 | SQL invalid-tail and injected-audit failures leave no partial writes |
| No broad grant / no definer bypass                  | SECURITY INVOKER; explicit membership checks; execute granted only to `service_role`                                       | SQL role/grant assertion; CI migration job                           |
| Wire mirror                                         | Extension `BatchLearnPortalFieldMapsRequest` / `Response` in `src/shared/apiTypes.ts`                                      | Extension `tsc --noEmit`                                             |

## Database verification

On a disposable PostgreSQL 16 database after replaying every repository
migration, run:

```sh
node scripts/security/verify-portal-field-map-learning.mjs
```

The test driver requires the local `psql` client and `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD`, and `PGDATABASE`. It creates uniquely named synthetic
rows, sets the disposable `service_role` attributes/grants to match Supabase,
tests retries and two-session races, then removes its fixture rows. CI runs the
same command in the migration dry-run job. No hosted credentials are read.

Local evidence on 2026-09-26: all 118 migrations replayed on disposable
PostgreSQL 16.15; `node scripts/security/verify-portal-field-map-learning.mjs`
passed its role, tenant, evidence, token, preservation, replay, concurrent
insert, invalid-tail whole-batch, and audit-rollback checks; cleanup passed.
Migration SHA-256:
`06121114a4bdeb0faa8bf5a02542c6c3b3438451419712eedfee1b8c6c68b18b`.

## Scope boundary

This slice defines the server contract and schema only. The extension does not
call it yet; accepted-receipt lifecycle and submission-touch integration are
Step 6. The migration is repo-only until an operator separately approves a
hosted apply. Because hosted has not received this migration, the generated
Supabase database types were edited narrowly by hand to match the additive
columns and RPC; regenerate them after an operator applies the migration.

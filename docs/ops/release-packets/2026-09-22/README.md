# Staging qualification and production catch-up

Status: **IN PROGRESS — production not approved or applied**.

User authorization: execute through staging qualification and prepare the production
release packet. Production database writes and customer-domain promotion require
final approval. UAT data must stay outside production.

## Requirements and acceptance

| ID     | Requirement                                             | Evidence required                                                                                     |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AUD-01 | Preserve populated staging before alignment             | Fresh encrypted capture, exact-role cleanup, isolated restore and integrity checks                    |
| AUD-02 | Apply only a reviewed additive staging delta            | Restored-baseline rehearsal, preserved rows, dependencies and role/grant checks                       |
| AUD-03 | Repair NULL-membership vault authorization              | P01 real PostgreSQL regression plus hosted Auth denial checks                                         |
| AUD-04 | Keep UAT synthetic data separate from production        | Fixed staging/loopback target checks, actual database identity preflight, production packet allowlist |
| AUD-05 | Qualify an identified dedicated staging deployment      | Source SHA, schema fingerprint, deployment ID, database binding and UAT receipt                       |
| AUD-06 | Prepare exact production changes without executing them | Checksummed two-migration packet, preflight/readback, approval pending                                |

## Real production migration plan

| Order | Exact file                                            | Effect when applied                                                                                          | Data migration                                              |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1     | `20260918172142_p01_vault_authorization.sql`          | Replace `store_ssn`, `reveal_ssn`, `create_ssn_intake_link`; NULL-safe membership checks and existing grants | None. No fixture inserts, key rotation or SSN re-encryption |
| 2     | `20260919033009_provider_csv_add_provider_parity.sql` | Replace `commit_import_run(uuid,jsonb)` and preserve authenticated-only execution                            | None. New behavior runs on future import calls              |

SQL inside the function bodies includes normal application writes. Creating or
replacing those functions does not execute their bodies or create UAT records.
The two changes can be released separately so the authorization repair does not
wait for the application catch-up.

`manifest.json` freezes the source checksums. Generate an isolated SQL packet with:

```sh
node scripts/release/production-catchup-packet.mjs /absolute/new-packet-directory
```

The generator copies exactly the two approved migration paths, rejects checksum
changes and top-level data operations, and includes no seeds, Auth users, Storage
objects, Vault secrets, staging schema reconciliation, or operator backup tables.
It never connects to a database. Do not replace this with `supabase db push`, a
migration glob, a database dump restore, or a seed command.

## Production execution gates (held)

1. Refresh the exact source and live production schema. Run `preflight.sql` read-only;
   stop if any pinned existing function differs from the recorded baseline.
2. Complete staging schema, Auth/RLS, CSV, recovery and installed-extension evidence.
3. Present the SQL checksums, CI results, exact release source, deployment candidate,
   compatibility rollback and outstanding risks to the owner for final approval.
4. Only after approval: apply P01 atomically; apply CSV in a separate transaction
   with bounded locks. Record hosted versions against source checksums; read back
   function definitions and grants. No history repair without object equivalence.
5. Build the customer candidate with production configuration; verify it before
   separately approving customer-domain promotion. Do not promote a staging-bound build.

Rollback: preserve additive schema. Do not restore vulnerable P01 predicates.
For CSV regression, use a reviewed forward function correction or the captured
compatible prior function definition; app alias rollback is allowed only after
schema compatibility is established. A source rollback is not a data restore.

## Evidence so far

- Local integrated candidate contains main policy, CSV staging changes, #395 UAT
  tooling/readiness fallback, and #374 P01. The CI merge conflict was resolved by
  retaining both independent UAT and vault jobs.
- P01 on isolated PostgreSQL 17.6 reproduced the six nonmember/wrong-org failures
  before repair; all **114** assertions passed afterward; container cleanup passed.
- Production packet checks pass; two migration files, zero fixture files.
- UAT target guard rejects URL routing overrides, mixed targets and hosted
  `--skip-auth`; psql subprocesses discard inherited `PG*` overrides. Routine seed
  preserves existing owned Auth passwords. SQL rejects known production identity.
- Hosted staging has existing records that must be preserved. Absence of this
  deterministic fixture's IDs does not authorize resetting older UAT data.
- Production read-only preflight passed against the recorded live function hashes and grants.
- Actual UAT SQL guard passed in isolated PostgreSQL: matching identity accepted; missing and mismatched identities rejected before fixture statements.
- Build and 2,303 application tests passed; lint has 14 existing warnings and no errors. Epic hygiene is clean after recording the existing payer_forms table and historical handoff metadata.
- Backup qualification is incomplete. No application schema migration, fixture
  seed, production write or deployment promotion has been performed in this execution.

## Recovery blocker and bounded next action

The failed capture left `cli_login_postgres` on staging. Its recorded expiry was
2026-09-23 03:40:21 UTC, with zero sessions and no shared dependencies observed.
Exact-role DROP is rejected with SQLSTATE 42501: the query role lacks CREATEROLE
and ADMIN on that role. The adapter correctly refuses another capture while a
CLI role exists. An encrypted partial file is not a usable backup.

Do not fabricate cleanup or restore evidence. The provider exposes project-wide
CLI login cleanup; using it requires an explicit exclusive staging-maintenance
window and bounded owner approval because it can affect another CLI operator.
Recheck that only the named expired role exists with no sessions immediately
before any approved cleanup; verify an empty poststate afterward. Then repair
and qualify the adapter lifecycle before retrying backup. An alternative is an
explicit staging database credential with a separately reviewed backup adapter;
never search unrelated credential stores or use a production credential.

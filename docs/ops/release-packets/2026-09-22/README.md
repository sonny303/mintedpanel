# Staging qualification and production catch-up

Status: **IN PROGRESS — production not approved or applied**.

User authorization: execute through staging qualification and prepare the production
release packet. Production database writes and customer-domain promotion require
final approval. UAT data must stay outside production.

## Requirements and acceptance

| ID     | Requirement                                             | Evidence required                                                                                     |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AUD-01 | Preserve populated staging before alignment             | Fresh encrypted capture, verified temporary-role cleanup, isolated restore and integrity checks       |
| AUD-02 | Apply only a reviewed additive staging delta            | Restored-baseline rehearsal, preserved rows, dependencies and role/grant checks                       |
| AUD-03 | Repair NULL-membership vault authorization              | P01 real PostgreSQL regression plus hosted Auth denial checks                                         |
| AUD-04 | Keep UAT synthetic data separate from production        | Fixed staging/loopback target checks, actual database identity preflight, production packet allowlist |
| AUD-05 | Qualify an identified dedicated staging deployment      | Source SHA, schema fingerprint, deployment ID, database binding and UAT receipt                       |
| AUD-06 | Prepare exact production changes without executing them | Checksummed two-migration packet, preflight/readback, approval pending                                |

## Authorized staging data cleanup

The aggregate preflight found five ambiguous contacts and two case/facility
eligibility gaps. The owner instructed removal of the affected staging data.
Five-contact removal is authorized; the exact case action (delete the two cases
or clear their selected facility) is awaiting clarification. Provider and facility
records must remain intact.

AUD-07 adds a bounded exception to general row preservation: remove only the
explicitly selected staging rows and their enumerated dependent records, after
verified restore and local rehearsal. Freeze the private ID manifest, dependencies
and before-state fingerprints; use bounded table/row locks, abort on drift, and
prove all non-target rows unchanged. Keep IDs and row data outside Git. Record
only aggregate counts, hashes and the execution receipt in the release packet.
No cleanup is authorized in production.

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
- Encrypted capture and strict isolated database restore passed. Full service/release qualification remains incomplete. No application schema migration, fixture seed, production write or deployment promotion has been performed in this execution.

## Recovery execution status — September 23

The owner approved an exclusive staging CLI maintenance window, staging data only.
The sole expired role was removed and empty inventory verified at 03:58:50 UTC.
The repaired adapter captured an encrypted staging snapshot at 04:02:30 UTC and
verified zero remaining temporary roles at 04:02:35 UTC. Explicit maintenance mode
is required; ordinary operation keeps exact-role cleanup. No production endpoint
is used by either path.

Isolated database restore passed at 2026-09-23 04:31:19 UTC: **92 physical tables,
2,034 rows, two sequences, zero sequence drift**. Roles, public permissions,
structure, extension ownership and migration-lineage checks passed. The successful
owned local target is retained as an untouched comparator. Repairs prepare captured
roles, preserve managed event-trigger ownership, and reproduce source extension
ownership; temporary local privilege elevation is always reverted and checked.

The receipt remains `REHEARSED_ONLY` / `RESTORE_VERIFIED_ONLY`, with release
admission blocked and no globally qualified recovery scope. Installed Auth/REST,
full managed-service coverage, release-context binding and final reconciliation
remain separate gates. This result supports local SQL rehearsal and scoped cleanup
recovery; it is not approval or qualification for a hosted application release.

## Staging Auth configuration readback

Read-only management API verification at 2026-09-23 04:21:46 UTC confirmed:

| Setting                              | Observed staging value                                              | Release implication                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site URL                             | `https://staging.mintedpanel.com`                                   | Keep the stable staging URL; verify its eventual dedicated deployment binding.                                                                            |
| Redirect allowlist                   | Stable staging domains plus two older customer-project preview URLs | An identified dedicated candidate will need its exact callback URL admitted before callback UAT. Remove obsolete entries only after candidate acceptance. |
| Email / auto-confirm                 | Email enabled; auto-confirm off                                     | Synthetic users require controlled admin creation; no mail delivery is needed for fixture seeding.                                                        |
| Signup / minimum password length     | Signup enabled; minimum 6                                           | Record separately for policy review; not modified during database maintenance.                                                                            |
| Leaked-password protection / CAPTCHA | Both disabled                                                       | Existing configuration; no change in this maintenance scope.                                                                                              |

No Auth secret, mail credential or user record was exported by this settings read.
The [management API](https://supabase.com/docs/reference/api/v1-get-auth-service-config)
and [redirect guidance](https://supabase.com/docs/guides/auth/redirect-urls) describe
the inspected settings. Configuration presence does not prove a successful callback.

The exclusive CLI window closed at 2026-09-23 04:27:39 UTC after a fresh
read-only check confirmed zero temporary CLI roles and zero CLI sessions.
Further qualification uses the isolated local snapshot; another project-wide
CLI cleanup requires a new exclusive maintenance window.

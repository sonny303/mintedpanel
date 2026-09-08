# Staging recovery — G2 boundary and runbook

This slice supplies local encryption and evidence guards. It does not acquire a
credential, export a database, create a container, import SQL, or demonstrate a
successful recovery. The coordinator owns those actions after their prerequisites
are satisfied. A database import alone is insufficient: Auth, access controls,
Storage and Vault recovery must also be proved. Product/schema repairs are outside
this task. Production backup and recovery evidence is separate and unverified.

## Fixed source and runtime

The only allowed source is `vmznysvietfaddakkegt` (`mintedpanel-staging`), database
`postgres`, through the verified PRIMARY pooler
`aws-0-ca-central-1.pooler.supabase.com:5432`. Port 6543, a direct connection,
another project and production are rejected. Re-read PRIMARY selection immediately
before access; a metadata change requires review of this fixed allowlist.

Use `supabase/postgres:17.6.1.147`, Linux ARM64 content digest
`sha256:ed13bb5ea4576948d5c0bec58fad3854d0fc27524e7a910ecab56ed9f96390c4`.
The executable constant uses `supabase/postgres@sha256:…`; a mutable tag alone is
insufficient. The multi-platform index digest is
`sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca`.
Record both image identity and the actual SQL server version before import.
The Supabase CLI 2.84.2 default image `17.6.1.095` is not this baseline.

The coordinator installed Colima 0.10.3, Lima 2.1.4, Docker CLI 29.6.2 and age
1.3.1 on this Mac. These are the reported installed versions, not a statement
that the VM, engine or restoration is ready. Re-read actual binary/VM/engine/image
identities and capacity before execution. The dedicated profile is
`minted-staging-recovery`: ARM64, 2 CPUs, 3 GiB memory, 16 GiB data disk and 8 GiB
root disk, no host mounts, no global context activation or SSH configuration.

Installed PostgreSQL clients are 18.4. `psql` can be used as a client against the
17.6 server after a connection check. Prefer the pinned image's 17.6 dump tooling
for a 17.6 restore: PostgreSQL permits newer `pg_dump` to read older servers but
does not guarantee its output loads into an older major release. Do not silently
strip new settings or remap SQL to make an 18-generated dump load into 17.
[PostgreSQL pg_dump compatibility](https://www.postgresql.org/docs/18/app-pgdump.html).

## Credential prerequisite

The coordinator must obtain explicit approval before the single POST to
`/v1/projects/vmznysvietfaddakkegt/cli/login-role` with `{"read_only":false}`.
The response contains a role, password and `ttl_seconds`; no password reset is
needed. The endpoint's published request does not let the caller choose a TTL.
**A guaranteed server-side lifetime of at most 15 minutes is not established.**
Reject a returned TTL above 900 seconds and do not use that credential. Rejection
does not revoke a role already created by the server. Resolve any approval that
requires a hard server-side maximum before calling this endpoint. Do not invoke
global role deletion or IP unbanning as cleanup or as an authentication retry.
[Management API contract](https://supabase.com/docs/reference/api/v1-create-login-role).

`stagingExportEnvironment` in `scripts/recovery/contract.mjs` accepts the response
in memory with `requestedAt`, `receivedAt`, `now`, and fresh `sourceObserved`
(`{capturedAt, source}`, captured within five minutes).
It returns a secret-bearing environment plus a conservative deadline computed
from request start. Never log or serialize this return value. It fixes the host,
port, project-qualified role and database; enables `verify-full` TLS with system
roots, a 10-second connection timeout, and read-only default transactions with
statement/lock timeouts. Confirm the installed libpq can validate the pooler's
certificate; do not weaken TLS if it fails. [TLS verification](https://www.postgresql.org/docs/18/libpq-ssl.html).

The helper does not connect or enforce process expiry. The trusted exporter must
check the deadline before every connection and forcibly close every source
connection/process by that deadline, including already-open sessions. Revalidate
remaining time before starting an export. Do not spread one credential across
unmanaged shells. Use only the reviewed fixed export commands and minimal process
environment; never pass secrets or connection strings in argv or shell text.
Read-only transaction settings constrain these export sessions; they do not turn
the privileged login role into a database-enforced read-only principal.

The official contract does not establish that `read_only:true` can export every
required Auth, Vault and role/grant scope without `SET ROLE postgres`. Do not
request a role merely to probe this assumption. The pinned CLI scripts use
`--role postgres`; retain a reviewed role choice for every export session.

## Private encrypted streams

Requires Node 22 and a separately verified age binary. No npm dependency is
added. CI installs the distribution age package and runs every synthetic test;
missing age or age-keygen fails the suite rather than skipping encryption checks.
The tests use the native Homebrew paths on this Mac and /usr/bin on Linux.
Run synthetic verification with:

```sh
npm run test:recovery
```

Create a private recovery directory and a protected native age identity outside
every Git checkout and public artifact location. Directory permissions must be
0700; identity and encrypted files must be 0600 and owned by the current user.
Use the resolved absolute path, with no symlink components. Keep the identity in
a separate protected location from retained backups and arrange recovery of that
identity; losing it makes the encrypted backup unusable. No real identity is
created by these scripts. The tests generate and remove synthetic identities.

`sealStream({input, workspace, name, recipient, ageBinary, producerCompletion})`
is the coordinator API. Connect an authorized export's stdout directly to
`input`, and pass its checked exit-status promise as `producerCompletion`.
The promise must reject on a nonzero status, signal, deadline, incomplete export
or missing scope. Suppress subprocess stderr and capture diagnostics only into
the protected encrypted evidence channel. The helper never runs a shell.

The bounded CLI can also seal stdin:

```sh
node scripts/recovery/seal.mjs seal \
  --workspace /absolute/private/recovery-run \
  --name data --recipient AGE_PUBLIC_RECIPIENT \
  --age /opt/homebrew/bin/age
```

Provide stdin through the coordinator's authorized stream; do not paste data in
chat or run an unreviewed command substitution. This CLI cannot observe the
upstream producer's exit status. Its `ENCRYPTED_ONLY` result is never sufficient
backup evidence, including when a shell pipeline reports success. The API with
the producer promise is preferred for actual exports.

Each artifact writes encrypted bytes into a random 0600 partial file, syncs it,
then publishes with an atomic no-overwrite link. Empty input, encryption failure
and observed producer failure do not publish a final artifact. A crash may leave
an encrypted `.partial` file; it never qualifies as a backup. Keep it quarantined
until task ownership is verified. Streams are capped at 1 GiB and 15 minutes;
these limits do not extend a shorter credential lifetime.

Allowed artifact names are closed constants: `backup`, `roles`, `schema`, `data`,
`supplements`, `vault-recovery`, `platform-config`, `migration-lineage`,
`integrity`, `synthetic`. Do not use person, organization or credential names.
Use a new private run directory for each backup; existing artifacts are preserved.

Verify an encrypted file without writing or displaying its plaintext:

```sh
node scripts/recovery/seal.mjs verify \
  --workspace /absolute/private/recovery-run --name data \
  --identity /absolute/private/keys/recovery-identity.txt \
  --age /opt/homebrew/bin/age
```

`verifySealed` authenticates the entire age stream into a bounded discard sink.
It returns only the fixed artifact name, encrypted byte count and ciphertext
SHA-256. `DECRYPTION_VERIFIED_ONLY` proves neither SQL compatibility nor full
scope. The CLI writes one static error and exits 2 on failure; it never reflects
input paths, source bytes or subprocess stderr. The age path is trusted operator
input, not a binary attestation; verify its provenance before supplying it.
[age documentation](https://github.com/FiloSottile/age).

## Complete export inventory — stop if a row lacks proof

The CLI's three standard role/schema/data files are a starting point, not the
complete recovery inventory. Before requesting a short-lived credential, finish
the reviewed export recipe and local platform baseline for every row below.
Keep detailed inventories, hashes of individual records and any sensitive
configuration inside encrypted evidence; publish only aggregate status and
artifact digests. Empty scope requires a fresh empty-inventory proof and is
recorded PASS with that proof, never SKIP.

| Required scope                  | Required content and verification                                                                                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application-schema-data`       | Complete tables, sequences, types, functions, ownership and data; one consistent data snapshot; matching catalog fingerprints before and after all exports.                                                                                           |
| `roles-memberships-grants-rls`  | Custom roles, memberships, grants/default ACLs, ownership, RLS enable/force flags and policies. Reserved-role definitions and password recovery need a reviewed local reconstruction map.                                                             |
| `managed-auth-storage-schemas`  | Source-compatible Auth/Storage tables and migration state, custom triggers/policies/grants and references excluded by CLI schema filters. Verify service/schema compatibility before importing rows.                                                  |
| `auth-data-access`              | All scoped Auth records and references; preserve data rather than dropping unsupported tables/columns. Verify local login and tenant access using a disposable local identity, with new local keys.                                                   |
| `storage-metadata-objects`      | Metadata plus actual object bytes or a fresh proof that both inventories are empty. Reconcile object identities and integrity after restoration.                                                                                                      |
| `vault-secret-recovery`         | Metadata, encrypted content and the separately authorized recovery/key mechanism required by the source's encryption design. A dump of encrypted columns without a usable key is insufficient. No secret-value export is implied by a metadata query. |
| `migration-lineage`             | Full observed ledger/catalog and immutable repository migration hashes, including explicit absence of `supabase_migrations.schema_migrations` if still absent. Do not create synthetic history.                                                       |
| `extensions-functions-triggers` | Source versions, definitions/customizations and event triggers, including definitions suppressed by CLI filters. Compare pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1 against fresh source observations.   |
| `platform-configuration`        | Recoverable local Auth/REST configuration, API/JWT key replacement procedure, isolated mail/webhooks/jobs and configuration dependencies. Preserve a secret-recovery reference without embedding hosted credentials.                                  |

The pinned CLI excludes managed schemas from schema dumps, Vault and migration
bookkeeping from ordinary data selection, and reserved roles/passwords from role
export; it also rewrites some trigger/ACL behavior. Review its exact filters and
supplements instead of assuming the default files cover the table above.
[CLI 2.84.2 filter source](https://github.com/supabase/cli/blob/v2.84.2/pkg/migration/dump.go).
Supabase's restore guide separately identifies platform configuration and Storage
objects and warns about managed-schema version differences. Its suggestion to
omit incompatible rows is outside this task's acceptance criteria.
[Platform-to-local guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

Do not describe separate role/schema/data invocations as one atomic system
snapshot. The current contract permits one consistent data snapshot with catalog
fingerprints bracketing the whole export. Reject schema drift. Source metadata
and full scope must be rechecked after export; inaccessible scope is BLOCKED.
No complete source export recipe or managed-schema remapping is implemented here
until these prerequisites are established from actual access.

## Local restore procedure and ownership proof

1. Generate a fresh 16-character lowercase hex run ID. Use
   `minted-staging-recovery-<runId>` for the DB container, internal network and
   named volume. Apply `com.minted.recovery.owner=minted-staging-recovery` and
   `com.minted.recovery.run-id=<runId>` labels to all three. Preserve other tasks'
   containers, networks, volumes and contexts.
2. Inspect `colima-minted-staging-recovery` and prove its engine endpoint equals
   the trusted socket `unix:///Users/ar/.colima/minted-staging-recovery/docker.sock`.
   Confirm actual image digest/architecture and SQL version. Inspect the complete
   container, network and volume into memory; never print raw Docker inspection,
   because environment values may contain secrets. Normalize only the fields in
   `validateLocalTarget` and bind `expectedRunId`/`expectedSocket` independently.
3. The initial guard requires exactly one DB container on one internal network,
   one task-owned named volume, no host binds/devices/added capabilities, no
   privileged or host namespace mode, and exactly one TCP database mapping from
   `127.0.0.1:<port>` to container port 5432. Verify every observed count; do not
   copy expected safe values into the observation. Inspect immediately before
   any import and again afterward; observations expire after five minutes.
4. Initialize the pinned local platform baseline while empty. Obtain the reviewed
   compatible managed schemas, role map and supplements before import. Do not
   reuse hosted passwords, JWTs or server keys locally. Do not attach unreviewed
   Auth/REST peers: their pinned images, task ownership and outbound isolation
   need a collector extension and independent review. The current DB-only guard
   cannot itself prove an operational Auth service.
5. Start the recovery clock at detection, before preparation. Use the selected
   encrypted backup; re-authenticate decryption and compare actual ciphertext
   digests. Restore by an explicitly reviewed local-only coordinator. No generic
   executable restore command is provided, so a path or connection override
   cannot direct this helper at staging or production.
6. The reviewed coordinator must force the proven loopback address/port/database,
   use fresh local credentials in memory and disable `.psqlrc`. Supply roles,
   compatible schema/supplements, then data through protected streams under
   `psql --single-transaction --set ON_ERROR_STOP=1`; capture all subprocess exit
   statuses without logging SQL/errors. A reviewed `session_replication_role`
   change during import may be needed to avoid duplicate encryption, but must
   be local-only and returned to normal before validation. Do not ignore errors,
   remove constraints, omit Auth rows or repair product triggers.
7. Verify all required `CHECKS` and `SCOPES`. Compare schema and lineage, row
   counts plus private content integrity, sequences, keys/references, role and
   RLS behavior, Auth access, objects, Vault and extensions. Disabled-trigger
   imports require explicit orphan/FK checks; `convalidated` alone does not prove
   imported rows satisfy constraints. Perform disposable identity/login and
   cross-tenant denial checks locally only, and preserve source records.
8. Stop the clock only after these checks pass. Save sanitized proof metadata,
   retain required encrypted backup/evidence and re-inspect ownership before
   stopping/removing only this run's local resources. Never drop/reset the source
   or delete all Supabase login roles. Failed/partial restorations remain failed.

## Evidence contract and freshness

`contract.mjs` defines closed schemas. `contract.test.mjs` contains synthetic
examples, not live PASS evidence. Hashes use G0's `canonicalDigest` convention.

- `backup`: version 1, fixed `source` plus schema/lineage digests, export start/end,
  matching before/after schema digests, ordered ciphertext artifact list, every
  scope proof, successful exporter status and the fixed snapshot method.
- `observed`: fresh source metadata, actual available artifact names/sizes/hashes
  and completed decryption verification. This must be collected independently of
  the backup manifest and no earlier than export completion.
- `target`: freshly normalized local inspection fields. Its identity digest omits
  only observation time, allowing reinspection of the same container/volume/network.
- `restore`: version 1, exact staging ref, backup/target digests, detection/start/end
  times, PASS, and all named check/scope proofs with evidence artifact digests.

`validateBackup` and `validateRehearsal` validate these records, not their author.
The trusted coordinator must authenticate the producer, inspect actual artifact
bytes, verify proof contents and use its own clock. Never manufacture observations
or PASS fields by copying a candidate manifest. An actor controlling all inputs
can forge a passing record; no signature or live Docker/database reader is claimed.

```sh
node scripts/recovery/validate.mjs \
  --backup /absolute/private/backup.json \
  --observed /absolute/private/observed.json \
  --restore /absolute/private/restore.json \
  --target /absolute/private/target.json \
  --run-id TRUSTED_RUN_ID \
  --socket unix:///Users/ar/.colima/minted-staging-recovery/docker.sock
```

Each input must be regular, non-symlink UTF-8 JSON, at most 1 MiB. The CLI takes
the current system clock, offers no target/clock override, and prints only three
digests on acceptance. Rejections produce one static error and exit 2. Pure APIs
take explicit `now` for deterministic tests. All times are exact ISO UTC with
milliseconds. A backup is stale 24 hours after **export start**, observations are
stale after five minutes, and total recovery from detection through checks must
be no more than four hours. Future/reversed times, missing/skipped scope, target
or artifact mismatch and changed schema/lineage fail closed.

This is one rehearsal's evidence, not ongoing backup coverage. A sleeping or
offline Mac cannot guarantee a fresh backup every 24 hours. Keep the ongoing
freshness gate BLOCKED until a currently available, scope-complete backup source
meets the target and its retrieval/identity/key procedure is proved. This G2
evidence cannot qualify a production database backup. G0 release records also
need independent release-context binding and trusted evidence collection before
any promotion can become eligible.

# Staging recovery — G2 boundary and runbook

This slice supplies local encryption, a fixed staging credential provider, an
owned backup coordinator, an isolated database restore executor, the reviewed
local Auth/REST qualifier and evidence guards. A live run remains evidence, not
an effect of merging this code. The coordinator requires an authenticated
Supabase CLI token source and a separately protected age identity. The latest
local run used the old pre-cleanup capture method, passed the full recovery
suite 321/321 and verified the local Auth/REST boundary only. Its success and
cleanup receipts are retained at:

- `/Users/ar/Codex-Minted/recovery-qualify-core-20260923-Ki8PJ9/auth-rest.json`
- `/Users/ar/Codex-Minted/recovery-qualify-core-20260923-Ki8PJ9/auth-rest-89414b39111817b9-cleanup.json`

The run ID is `89414b39111817b9`; its receipt binds the current recovery-core
code hashes. The isolated target was destroyed with zero remaining resources.

Hosted service/configuration parity, production recovery and the remaining full
recovery gates are unverified. Product/schema repairs remain outside this task.
Production backup and recovery evidence is separate and unverified.

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
The normalized SQL `serverVersion` is `17.6`; `17.6.1.147` identifies the Supabase
image build and is pinned separately by its content digest.
The Supabase CLI 2.84.2 default image `17.6.1.095` is not this baseline.

The coordinator installed Colima 0.10.3, Lima 2.1.4, Docker CLI 29.6.2 and age
1.3.1 on this Mac. These are the reported installed versions, not a statement
that the VM, engine or restoration is ready. Re-read actual binary/VM/engine/image
identities and capacity before execution. The dedicated profile is
`minted-staging-recovery`: ARM64, 2 CPUs, 3 GiB memory, 16 GiB data disk and 8 GiB
root disk, no host mounts, no global context activation or SSH configuration.

The capture coordinator pins native PostgreSQL 17.10 dump clients under
`/opt/homebrew/Cellar/libpq@17/17.10/bin/`, including their bytes and version
output. The separately installed default 18.4 clients are unchanged. Use the
pinned 17 clients for this 17.6 restore: PostgreSQL permits newer `pg_dump` to read
older servers but does not guarantee its output loads into an older major
release. Do not silently strip settings or remap SQL to make an 18-generated
dump load into 17.
[PostgreSQL pg_dump compatibility](https://www.postgresql.org/docs/18/app-pgdump.html).

## Credential prerequisite

The coordinator must have explicit authorization for one bounded login-role
lifecycle. Immediately before the POST, it runs the fixed read-only Management
API query and requires an exact empty `cli_login_%` inventory. It then calls
`/v1/projects/vmznysvietfaddakkegt/cli/login-role` once with
`{"read_only":false}`. The response must contain one strictly validated role,
password and integer `ttl_seconds` from 1 through 3600. The request does not let
the caller choose a TTL. The 3600-second server-response ceiling matches the
reviewed provider integration contract; local use is capped at 900 seconds from
request start.

After a POST returns a validated role name, a `finally` path uses the Management
API database write-query endpoint to terminate only that role's sessions, set
that exact role to `NOLOGIN` with an epoch expiry, and drop that exact role. The
identifier is accepted only by the fixed `cli_login_[A-Za-z0-9_]{1,80}` grammar
and is quoted by the fixed query. A fresh read-only inventory must prove the
created role absent. A different concurrently created CLI role is preserved.
Default operation never uses the project-wide login-role DELETE endpoint.
For an explicitly approved exclusive staging CLI maintenance window only, pass
`--exclusive-staging-maintenance`. This mode verifies the sole created role,
rejects foreign CLI sessions/roles, terminates only its own remaining sessions,
rechecks zero sessions, invokes the fixed staging provider cleanup endpoint,
and verifies empty poststate. The exclusive window is essential because an
inventory check cannot prevent another operator creating a role immediately
afterward. Never enable this mode automatically or use it against production.
Unknown login-POST outcomes still fail closed without bulk deletion.

If the POST outcome is uncertain and no validated role name was received, the
coordinator does not retry or guess a role and does not call a bulk cleanup. It
re-reads inventory once, leaves the run blocked, and relies on the provider's
bounded role expiry. Do not start another lifecycle until the exact inventory is
again empty and at least the 3600-second provider ceiling has elapsed. A response
above the ceiling is rejected after exact-role cleanup. `capture.json` records
prestate, request, receipt, cleanup and verification times plus sanitized
inventory/role digests and counts; it never records the password, token or SQL
response. Do not use IP unbanning or an authentication retry.
[Create role](https://supabase.com/docs/reference/api/v1-create-login-role) and
[read-only query](https://supabase.com/docs/reference/api/v1-read-only-query).

`scripts/recovery/provider.mjs` reads the token using the Supabase CLI's official
precedence: `SUPABASE_ACCESS_TOKEN`, the macOS `Supabase CLI` / `supabase`
keychain item, then the protected legacy token file. The token is never accepted
as a command-line argument or included in output. The provider verifies the
exact project ref, name, region, healthy status, database engine/build and fixed
session-pooler recovery endpoint before the bounded role lifecycle. It never
retries the login-role POST or exact-role cleanup. `scripts/recovery/live-backup.mjs` passes the response
directly to the in-memory snapshot exporter and writes only `capture.json` plus
encrypted age artifacts in the private workspace:

```sh
node scripts/recovery/live-backup.mjs capture \
  --workspace /absolute/private/recovery-run \
  --recipient AGE_PUBLIC_RECIPIENT
```

`stagingExportEnvironment` in `scripts/recovery/contract.mjs` accepts the response
in memory with `requestedAt`, `receivedAt`, `now`, and fresh `sourceObserved`
(`{capturedAt, source}`, captured within five minutes).
It returns a secret-bearing environment plus a conservative deadline computed
from request start. Never log or serialize this return value. It fixes the host,
port, project-qualified role and database; enables `verify-full` TLS with the
pinned public Supabase CA in `scripts/recovery/certs/supabase-root-2021.crt`, a
10-second connection timeout, and read-only default transactions. Initial
statement/lock timeout settings are supplied, but `pg_dump` resets both to zero;
its explicit `--lock-wait-timeout=5s` bounds initial table locking only. The
coordinator's independent wall-clock and monotonic watchdog bounds local client
lifetime. System roots alone failed this pooler's chain validation.
The certificate is used only through `PGSSLROOTCERT`; no global trust store is
changed. Confirm the installed libpq can validate the pooler's certificate;
never weaken TLS if it fails. [TLS verification](https://www.postgresql.org/docs/18/libpq-ssl.html).
[pg_dump connection and locking behavior](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/bin/pg_dump/pg_dump.c).

The CA's PEM SHA-256 is
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`;
its DER SHA-256 fingerprint is
`807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`.
It expires April 26, 2031. Its provenance is the
[official dashboard configuration at c75e213](https://github.com/supabase/supabase/blob/c75e213ade12d593e39552dce5779be8d2989ad5/apps/studio/hooks/custom-content/custom-content.json),
which supplies the
[public certificate download](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
Require the pinned file's identity, permissions and digest before any source
process. Certificate rotation requires review and a new hostname-verification
check; do not replace it from an unverified TLS handshake.

The helper does not connect or enforce process expiry. The trusted exporter must
check the deadline before every connection and forcibly close every source
connection/process by that deadline, including already-open sessions. Revalidate
remaining time before starting an export. Do not spread one credential across
unmanaged shells. Use only the reviewed fixed export commands and minimal process
environment; never pass secrets or connection strings in argv or shell text.
Read-only transaction settings constrain these export sessions; they do not turn
the privileged login role into a database-enforced read-only principal.

`captureStagingExport` in `scripts/recovery/export.mjs` accepts the credential
response and observation in memory, plus a private workspace and age public
recipient. It exposes no credential CLI. It pins and checks the native dump
binaries, fixed argument vectors and source CA before capture. The full custom
archive and password-free role dump stream directly to age; a failed producer
cannot qualify an artifact. Cancellation and deadlines must close both the dump
and encryption processes and settle their pipelines before cleanup completes.

Its `CAPTURED_ONLY` record binds the supplied observation digest, executable and
command identities, and ciphertext digests. It does not authenticate a supplied
catalog observation or prove consistent cross-export snapshots, scope
completeness, restore success or Auth/REST integrity. The outer coordinator adds
fresh pre/post role inventories and the exact-role cleanup lifecycle; the exporter
alone cannot claim cleanup. It reserves five seconds before conservative
credential expiry for local shutdown. OS suspension/failure can still interrupt
the remote cleanup request, so missing exact-role absence is a failed run.

`captureStagingSnapshot` adds an owned source snapshot using the same in-memory
credential, fixed connection, CA, process owner and deadline. It pins native
`psql` 17.10, verifies the actual database/session role/version/read-only
transaction, holds a repeatable-read exported snapshot, and passes its token
internally to `pg_dump --snapshot`. It accepts no caller-supplied snapshot, SQL,
table list or connection override. Identifiers come from the collected catalog
and must fit the supported identifier grammar; an unsupported name fails instead
of silently omitting its table.

The owned collector establishes the actual catalog and database-ledger digests.
The caller's earlier observation is retained only as
`declaredInputObservationDigest`; no match to an older expected schema is claimed.
The temporary login's presence and digest are recorded separately, with its
dependency/reconstruction review still pending. Creating that login changes the
global catalog, so a pre-login fingerprint is not assumed equal to this capture.

The collector gathers catalog definitions/configuration, Auth/Storage/application
ledger records or explicit absence, and sorted SHA-256 row hashes for every
physical table under the shared snapshot. Counts are checked independently;
physical tables use `ONLY` to avoid duplicating inherited/partition rows. Type
output settings are fixed. Per-table results, sequence observations, function
bodies, role settings and both catalog reads are encrypted into `schema`,
`integrity` and `migration-lineage` artifacts. Raw rows or settings are never
written to plaintext files or returned in public capture records. The after
catalog uses a new transaction; any observed catalog/global drift rejects the
capture. Reader death, malformed/truncated output, permission failure, missing
rows, inconsistent ledgers or a deadline abort stop and reap every owned process.

Sequence values are explicitly `NON_MVCC_OBSERVATION`: an exported snapshot does
not freeze them. Their comparison to actual archive sequence items and recovered
data remains required. The catalog currently includes source OIDs; a reviewed
source/local normalization and archive/extension coverage comparison is still
needed. Materialized-view/large-object handling, platform settings, repository
migration hashes, temporary-role mapping and full restoration qualification are
not supplied by this reader. Its `source.lineageDigest` covers observed database
ledgers only, not the repository's migration inventory.

This entry point still returns `CAPTURED_ONLY`. Synthetic real-process/age tests
exercise its protocol and failure boundaries; they do not execute its SQL or
prove snapshot import through the hosted pooler. Those SQL/concurrent-snapshot
checks must run on the reviewed local fixture and then the authorized source
before live evidence can qualify. No credential acquisition or local restore
command is added by the snapshot API.

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
The full custom archive retains the source database objects and rows. The role
dump is retained and authenticated separately. Restoration does not replay
hosted reserved-role DDL into the local cluster; the executor instead requires
the pinned Supabase image's non-temporary role and membership catalog to match
the encrypted source catalog exactly. A mismatch fails before qualification.

## Local restore procedure and ownership proof

The read-only collector performs the actual local inspection and fixed SQL identity
query, then reinspects the same resources for drift:

```sh
node scripts/recovery/local-target.mjs inspect --run-id TRUSTED_RUN_ID
```

It uses the fixed local Docker socket, verifies the complete isolation fields and
requires PostgreSQL 17.6 with scheduled database jobs disabled. It accepts no SQL,
host, container-name, executable or credential override. Its normalized JSON is
target identity evidence only; it does not export, restore or claim recovery PASS.

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
   privileged or host namespace mode, and no configured or effective published
   ports. The coordinator streams into the verified container through the local
   Docker socket with `docker exec --interactive`, avoiding a host TCP listener. Verify every observed count; do not
   copy expected safe values into the observation. Inspect immediately before
   any import and again afterward; observations expire after five minutes.
4. Initialize the pinned local platform baseline while empty. The executor
   creates a separate `minted_recovery` database from `template0`, then streams
   the authenticated custom archive into `pg_restore --single-transaction
--exit-on-error`. Do not reuse hosted passwords, JWTs or server keys locally.
   The reviewed Auth/REST peers use pinned images, task ownership and outbound
   isolation on the same internal-only network. The successful local run used
   the old pre-cleanup capture method and does not establish hosted parity.
5. Start the recovery clock at detection, before preparation. Re-authenticate
   every age stream and compare its bytes and SHA-256 with `capture.json`.
   `restore.mjs` fixes the Docker context/socket, image, local database, role and
   executable paths. Before the first named-resource creation attempt, it writes
   a private `restore-<runId>-journal.json` containing the stable run ID and exact
   resource name. It accepts no host, connection URL, SQL or image override.
   The original peer-start failure was the database's default
   `listen_addresses=localhost`, which left Auth/REST unable to connect. The
   bounded fix starts the disposable database with `listen_addresses=*` on the
   Docker `--internal` network only; no host port is published. Readiness still
   probes `127.0.0.1` inside the database container, while peers use internal
   service aliases.

   ```sh
   node scripts/recovery/restore.mjs restore \
     --workspace /absolute/private/recovery-run \
     --identity /absolute/private/keys/recovery-identity.txt
   ```

6. The executor compares every physical table's row count and private content
   digest, reconciles non-MVCC sequence observations, and compares public
   ownership, ACLs, column ACLs, RLS policies, constraints, indexes, functions,
   triggers, extension versions, roles and memberships. It also checks outbound
   subscriptions/foreign objects and large objects. The sanitized result is
   written as `restore.json`; a failure publishes no PASS. The direct executor
   continues to emit `REHEARSED_ONLY` with a nested `RESTORE_VERIFIED_ONLY`, a
   null release context digest and an empty `qualifiedRecoveryScopes` array.
   The separately reviewed local Auth/REST qualifier completed the 321-test
   local run above, but neither receipt is a release G0 backup or recovery PASS.
7. Auth rows, Storage metadata and Vault metadata are included in the table
   integrity comparison. Storage object bytes and Vault key recovery must be
   proved separately when either source inventory is nonempty. The local
   Auth/REST qualifier verified password login, refresh, identity lookup and
   cross-tenant denial for the synthetic fixture. Hosted parity, production
   recovery, Storage object bytes, Vault key recovery and the remaining full
   recovery gates remain unverified.
8. On every failure after the journal, cleanup discovers container, network and
   volume independently by exact name and both ownership labels. It refuses a
   foreign resource, attempts all owned removals even when one fails, rechecks
   final absence and writes a private sanitized cleanup receipt. The receipt or
   retained journal makes cleanup resumable by run ID. Re-run
   `node scripts/recovery/restore.mjs destroy --run-id <runId>` until its receipt
   is `DESTROYED`; already absent members are accepted. Successful rehearsals
   retain the isolated target for reviewed follow-on work and require the same
   explicit destroy command afterward. Never drop/reset the source. Failed or
   partial restorations remain failed and never qualify a recovery scope.

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

## September 23 authorized staging maintenance

The owner explicitly approved an exclusive staging CLI window, staging data only.
The initial sole expired login was removed and empty inventory verified at
2026-09-23T03:58:50.920Z. The repaired maintenance adapter then captured a fresh
encrypted snapshot and verified zero temporary roles at 04:02:35.502Z.
A capture is not restore qualification; the rehearsal and remaining release
gates must still pass before schema alignment. Production is outside this run.

The exclusive CLI window closed at 2026-09-23 04:27:39 UTC after a fresh
read-only check confirmed zero temporary CLI roles and zero CLI sessions.
Further qualification uses the isolated local snapshot; another project-wide
CLI cleanup requires a new exclusive maintenance window.

The isolated database rehearsal passed at 2026-09-23 04:31:19 UTC for 92 physical
tables and 2,034 rows, with both sequences unchanged. Public access, role, structure
and extension-owner comparisons passed. The successful comparison target is
retained. The receipt stays `REHEARSED_ONLY`, with no qualified global recovery
scope; the service-level and release-context prerequisites are not silently cleared.

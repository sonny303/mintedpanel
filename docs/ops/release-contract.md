# Release contract — G0

This slice validates an immutable, pre-mutation release record. It has two
explicit phases: `staging-preflight` before staging changes, and
`production-eligibility` after staging has been tested but before production
changes. The selected target fixes the accepted phase. It makes no
network requests, reads no environment credentials, and cannot deploy, migrate,
approve or roll back an application. A successful result means the supplied data
meets the contract. It does **not** authenticate its author or demonstrate that
its assertions happened.

Scope: delivery guardrails only. Product repairs and migration-history repairs
are separate work. The user approved automatic staging, a single GitHub
Production approval by `sonny303`, compatible web/database releases, local
staging extension tests performed by the user, and a separate restricted
production Store release process. This validator creates none of those hosted
controls and does not authorize the first customer release.

## Run

Requires the repository's Node 22 runtime; no additional dependencies.

```sh
npm run test:release
node scripts/release/validate.mjs \
  --target production \
  --record /private/release/record.json \
  --policy /private/release/trusted-policy.json \
  --observed /private/release/fresh-observations.json
```

Use `--target staging` for a staging contract. There is no default and `preview`
is not a target. A valid record prints only `{"ok":true,"digest":"…"}`. Save that
digest in the reviewable approval record. A later trusted runner must supply
`--expected-digest <approved SHA-256>` when revalidating after approval. Omitting
that flag supports initial validation and hashing; it is **not** evidence of an
approval. G4 must require and authenticate the approval binding.

Exit statuses: `0` valid, `1` contract rejected, `2` invalid CLI arguments or local
input. Errors contain at most 32 static codes and schema-owned field paths. They
never include input values, unknown keys, filenames or exception text. Inputs
must be regular, non-symlink UTF-8 JSON files, at most 1 MiB each. Unknown fields
are rejected at every object level; arrays are bounded to 1,024 elements. Keep
backup contents, tokens, passwords and sensitive configuration values out of all
three inputs. Configuration digests identify non-secret configuration and secret
version identities; do not hash a low-entropy secret as a substitute for a safe
identifier.

The pure API is `validateRelease({record, policy, observed, expectedTarget, now,
expectedDigest?})`. `now` is an explicit UTC timestamp for deterministic tests;
the CLI uses the system clock and offers no clock override. Timestamps use the
exact form `2026-09-08T18:00:00.000Z`. All hashes are lowercase hex: 40 characters
for Git SHAs, 64 for SHA-256. `canonicalDigest(value)` hashes UTF-8 JSON with
sorted object keys, unchanged array order and no whitespace. This is the defined
format for this contract, not a signature or a general cross-language JSON
canonicalization standard.

## Trust boundary

The three inputs must have independent, trusted origins:

| Input      | Owner and purpose                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record`   | Evidence collector's immutable description of one candidate                                                                                         |
| `policy`   | Reviewed protected workflow: expected source/run/plan, required checks, supported installed extension versions, recovery scope and freshness limits |
| `observed` | Trusted read-only collector's fresh provider/runtime observations immediately before the intended operation                                         |

Do not derive policy or observations by copying values from the record. Do not
accept a PR's modified validator/policy as the deployment authority. Later
workflow code must verify producer identity, artifact digests against actual
bytes, workflow/run provenance and access permissions before calling this API.
A caller that controls all inputs can manufacture a passing contract. G0 cannot
detect a forged artifact, falsely reported test, incorrect collector or clock.

The allowlist in `scripts/release/contract.mjs` fixes both targets to Vercel team
`team_230fpJ9MgCj9ssW3LiIckfyA`. Staging uses the dedicated project
`prj_1t7NkRJMkjTuFXEBEP4GjfN4B6Ch`, Preview, branch `staging`, and Supabase
`vmznysvietfaddakkegt`. Production remains project
`prj_ILhPJbkyaiptdVA8DtsmNyw3tiub`, Production, branch `main`, and Supabase
`fkvuhfsqcmujywzgczmc`. The repository is `sonny303/mintedpanel`. This is an
identity comparison, not proof that the staging credential is isolated or that
the dedicated project is correctly configured at runtime. Any target redesign
needs another reviewed allowlist change.

## Version 1 JSON structure

The closed schemas in `contract.mjs` are authoritative. The executable example
builder in `scripts/release/test-fixtures.mjs` contains **synthetic** complete
records; its names, versions and PASS statuses are test data, never live evidence.

`record` has exactly these fields:

| Field                  | Meaning                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `version`, `createdAt` | `1` and record completion time                                                                                                         |
| `context`              | All release subjects listed below                                                                                                      |
| `checks`               | Nonempty array of `{name, ...proof}`; exactly the trusted required check set, no duplicates                                            |
| `rehearsal`            | Proof of the exact migration plan rehearsed against the matching baseline, including postconditions; also required for a no-op plan    |
| `compatibility`        | Separate `candidate` and `previous` proofs; each covers the resulting database and the entire declared installed extension version set |
| `backup`               | Target-specific backup identity/availability plus the measured restoration proof below                                                 |
| `rollback`             | Recovery proof with `mode: "compatible-app-only"`; previous app against the resulting schema and declared extension set                |

`context` contains a `phase` field fixed to `staging-preflight` for staging or
`production-eligibility` for production, followed by these subjects:

| Field                        | Exact contents                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`                     | `environment`, `vercelTeamId`, `vercelProjectId`, `supabaseRef`, `vercelEnvironment`, `gitBranch`                                                                                              |
| `source`                     | `repository`, immutable `sha`                                                                                                                                                                  |
| `workflow`                   | `.github/workflows/*.yml`/`.yaml` `path`, immutable `sha`, numeric-string `runId`, positive integer `runAttempt`                                                                               |
| `staging`                    | `sourceSha`, `workflowSha`, `runId`, `runAttempt`, `deploymentId`, `configurationDigest`, `schemaDigest`, `migrationPlanDigest`, `verifiedAt`, `supabaseRef`, `gitBranch`, `vercelEnvironment` |
| `baseline`                   | Current target's `deploymentId`, `appSha`, `configurationDigest`, `schemaDigest`, complete applied `migrations` inventory                                                                      |
| `migrationPlan`              | `mode` (`none` or `additive`), `baselineSchemaDigest`, `resultSchemaDigest`, complete candidate `inventory`                                                                                    |
| `targetConfigurationDigest`  | Intended target configuration identity, freshly checked by the collector                                                                                                                       |
| `supportedExtensionVersions` | Nonempty, duplicate-free explicit versions, including older installed versions still supported                                                                                                 |

Every `proof` contains `status`, `finishedAt`, `contextDigest` and `artifactDigest`.
`contextDigest` is `canonicalDigest(record.context)`, binding the complete subject
including source, previous app, migration result and extension set. `status` must
be `PASS`; missing, `FAIL`, `SKIP`, `BLOCKED` and `UNVERIFIED` do not qualify. Each
referenced artifact must actually substantiate the specific claim in its row;
putting the same arbitrary digest everywhere does not establish evidence.

For `staging-preflight`, `context.staging` describes the **currently served
previous staging deployment**: its deployment ID, source SHA, schema and deployed
configuration must match the observed baseline. Candidate rehearsal and
compatibility run against an isolated matching baseline before any staging
mutation. The previous staging plan/run provenance is observed, not confused
with the new candidate's plan/run. Required checks for this phase must represent
preflight/rehearsal evidence; G3 must separately require deployed candidate and
post-migration checks before alias publication.

For `production-eligibility`, `context.staging` instead describes the **tested
candidate already deployed to staging**, binding its source, workflow/run, exact
plan and resulting schema. Production's observed baseline still describes the
currently served production deployment and its pre-mutation database. This avoids
asserting that one staging database simultaneously has the old baseline and the
new result. A staging preflight PASS cannot be reused as production eligibility
or as proof of a successful staging deployment.

Each migration inventory entry contains `id` (14 digits),
`path` (`supabase/migrations/<id>_<name>.sql`), and `sha256` of exact file bytes.
Both inventories must be strictly ordered by ID with no duplicate IDs or paths.
The candidate inventory must retain the complete baseline as a byte-identical
prefix. A no-op plan requires equal inventory lengths and unchanged schema. An
additive plan requires new entries and a different resulting schema. Both still
require reconciled lineage, rehearsal, compatibility, backup and rollback proof.
The plan digest is `canonicalDigest(context.migrationPlan)` and must match the
trusted policy and, for production eligibility, tested staging provenance.
Declaring `additive` does not analyze SQL
or establish that a new migration is safe; the approved plan producer and later
rehearsal must do that.

`backup` has `provider: "supabase"`, `supabaseRef`, `schemaDigest`,
`lineageDigest`, `createdAt`, `verifiedAt`, `available`, `artifactDigest` and
`restore`. The backup ref must equal the selected target, the schema must equal
the baseline and the lineage digest is `canonicalDigest(baseline.migrations)`.
`restore` has the proof fields plus `backupArtifactDigest`, `detectedAt`,
`startedAt` and `scopes`. Its backup digest must match the selected backup.
`rollback` has the proof fields plus `detectedAt`, `startedAt` and its fixed mode.

Both recovery durations include detection through verified completion, not just
the database command or alias operation. Detection ≤ start ≤ finish is required.
Backup creation must precede restoration start. Maximums are inclusive: backup
age 86,400 seconds, restoration 14,400 seconds, app rollback 300 seconds. Future
evidence and timestamps are rejected. Restoration scope must equal the trusted
required set, such as database, Auth and configuration, with Storage/object or
other recovery included when required. A database-only proof cannot declare away
other required recovery scope.

`policy` contains exactly `version: 1`, `source`, `workflow`,
`migrationPlanDigest`, `requiredChecks`, `supportedExtensionVersions`,
`requiredRecoveryScopes`, `evidenceMaxAgeSeconds` (1–86,400), and
`snapshotMaxAgeSeconds` (1–300). Required sets are nonempty and duplicate-free.
The record cannot choose these values. The final protected workflow must supply
the actual full check names, approved installed version set and recovery scope;
the synthetic fixture's short check list is not production policy.

`observed` contains exactly `version: 1`, `observedAt`, `target`, `baseline`,
`staging`, `targetConfigurationDigest`, `supportedExtensionVersions` and `backup`
(the backup fields above excluding `restore`). These must match the record.
Production cannot borrow staging recovery evidence. An unavailable or changed
backup, altered baseline, changed staging deployment, configuration or supported
version set invalidates the record. Record and evidence must remain fresh, even
when an approval waits long enough to expire them.

## Subsequent slices and activation blockers

This contract describes the pre-mutation baseline. After an authorized migration
changes schema, G4 must validate the **expected resulting state** using a separate
phase check. It must not rewrite this approved record or feed the old baseline
back as a fabricated fresh observation. Production candidate creation, checks
after applying the plan, exact candidate promotion and compatible rollback remain
inside the approved job. A target mutation lease shared by CI and supported local
commands, fresh checks immediately before every mutation and provider readbacks
remain separate mandatory controls. G0 does not close the observation-to-mutation
race, acquire a lock or implement any operation.

Until trusted collectors, GitHub approval/branch controls, production credential
isolation, target-specific recovery and full staging/product checks are proven,
automatic production release remains blocked. User-reported local extension
installation and manual tests are distinct from build/test automation. A
restricted production Store item and its supported installed versions cannot be
inferred from the synthetic fixture.

At the approved source baseline `f90393074c5d80da0c7d3bb5cff4ca04d1c5593b`, two
existing migrations share ID `20260903210000` (`delete_case_rpc` and
`delete_org_sop_template`). G0 deliberately rejects a lineage containing that
duplicate. It does not rename, edit or silently exclude either file. The
September 8 staging backup inventory also had no available physical backups;
that observation does not establish production backup coverage. These remain
activation blockers until independently resolved and evidenced.

## Verification and rollback

`npm run test:release` exercises both targets and database modes, altered source
and approval digests, wrong projects/refs/branches, target-specific backup and
restore binding, stale/future/missing/skipped proofs, production drift,
extension-version drift, migration history/duplicates/no-op bypasses and recovery
deadlines. CLI tests exercise exit codes, malformed/oversized/nonregular files,
explicit target selection and bounded secret-free errors. All fixtures are
synthetic, and subprocess tests write only task-owned temporary directories.

To remove this slice, revert `scripts/release/`, this document and the
`test:release` package script. There is no hosted state to undo.

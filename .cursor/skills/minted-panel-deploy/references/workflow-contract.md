# Workflow contract

Source of truth: `.github/workflows/production-release.yml`,
`.github/workflows/staging-delivery.yml`, `scripts/delivery/cli.mjs`,
`scripts/delivery/boundary.mjs`. If this file disagrees with those, follow
the source.

## Identities

| | |
| --- | --- |
| Repository | `sonny303/mintedpanel` |
| Production approver | GitHub user id `261707544` only |
| Production Vercel project | `prj_ILhPJbkyaiptdVA8DtsmNyw3tiub` |
| Staging Vercel project | `prj_1t7NkRJMkjTuFXEBEP4GjfN4B6Ch` |
| Vercel team | `team_230fpJ9MgCj9ssW3LiIckfyA` |
| Production Supabase | `fkvuhfsqcmujywzgczmc` |
| Staging Supabase | `vmznysvietfaddakkegt` |
| Production aliases | `mintedpanel.com`, `www.mintedpanel.com`, `mintedpanel.vercel.app` |
| Staging aliases (intended) | `mintedpanel-staging.vercel.app`, `staging.mintedpanel.com` |

Stable staging aliases may still be on the production project's Preview.
Refresh a live readback before claiming cutover. See
`docs/ops/environment-architecture.md`.

## `production-release.yml`

- Trigger: `workflow_dispatch` only. Input `staging_run_id` (required string):
  successful staging delivery run that holds the immutable release record.
- `concurrency.group`: `minted-production-release`. `cancel-in-progress: false`.
- Both jobs run only when `github.ref == refs/heads/main` and
  `github.run_attempt == 1`. Checkout ref is `github.workflow_sha`.
- Job `prepare` (no production secrets): `node --test scripts/delivery/*.test.mjs`,
  then `node scripts/delivery/cli.mjs prepare-production` with
  `MINTED_STAGING_RUN_ID`, `MINTED_WORKFLOW_SHA`, `MINTED_CHECKOUT_SHA`.
- Job `production` (`needs: prepare`, environment `Production`,
  `contents: write`): `node scripts/delivery/cli.mjs production`.
  Candidate build, migration, promote, postcheck, and conditional rollback
  belong in this job when activation exists. Do not add another job.
- CLI rejects the command unless `GITHUB_ACTIONS=true`,
  `GITHUB_REPOSITORY=sonny303/mintedpanel`, `GITHUB_REF=refs/heads/main`,
  `GITHUB_EVENT_NAME=workflow_dispatch`, `GITHUB_RUN_ATTEMPT=1`,
  `GITHUB_WORKFLOW_REF` is
  `sonny303/mintedpanel/.github/workflows/production-release.yml@refs/heads/main`,
  and `MINTED_CHECKOUT_SHA` equals `MINTED_WORKFLOW_SHA`.
- `prepare-production` and `production` then call `assertHostedReady()`, which
  always throws `HOSTED_ACTIVATION_BLOCKED` (exit 2).

Approval, once a real approval artifact exists, is not a local `approved: true`.
`verifyProductionApproval` requires an in-progress attempt-1 run, environment
`Production`, `prevent_self_review: false`, `can_admins_bypass: false`, one
custom branch rule `{ name: main, type: branch }`, and one approval from user
id `261707544`. Rerunning the job cannot reuse approval. Start a new dispatch.

## `staging-delivery.yml`

- Trigger: `workflow_dispatch` only. Inputs: `ci_run_id`, `source_sha`.
- Environment name is `staging`, not `Production`.
- Same main + attempt-1 gate. Checkout is the workflow SHA, not the app SHA.
- `admit-staging` calls `admitSuccessfulMain`: the CI run id must be a
  successful `push` of `.github/workflows/ci.yml` on `main` at `source_sha`,
  and `refs/heads/main` must still be that SHA (`MAIN_MOVED` if it is not).
- `node scripts/delivery/cli.mjs staging` then hits `assertHostedReady()`.

## Blockers (`ACTIVATION_BLOCKERS`)

Removing one requires reviewed code and authenticated evidence. No JSON, env
var, or PASS file clears them.

- `FIXED_STAGING_PROVIDER_HOSTED_EXECUTION_PENDING`
- `SCOPED_CREDENTIAL_DESTINATIONS_AND_DENIAL_PROOF_PENDING`
- `GIT_DISCONNECT_AND_COMPETING_DEPLOYMENT_READBACK_PENDING`
- `AUTHENTICATED_SCHEMA_LINEAGE_AND_BACKUP_COLLECTORS_MISSING`
- `MATCHING_BASELINE_REHEARSAL_AND_MIGRATION_EXECUTOR_MISSING`
- `CANDIDATE_RUNTIME_AND_INSTALLED_EXTENSION_COMPATIBILITY_PROOFS_MISSING`

`node scripts/delivery/cli.mjs status` prints this list and exits 2. It is safe
to run locally. The other four commands are rejected outside the trusted
workflow (`TRUSTED_MAIN_REQUIRED` / `TRUSTED_WORKFLOW_REQUIRED`).

## Intended order after activation

Documented in `docs/ops/production-release.md`. Not executable today.

1. Authenticate the approved intent. Select a fresh matching production backup
   after that single approval (max age 24h). Seal the execution record.
2. Build with `vercel deploy --prod --skip-domain`. Check the withheld
   candidate. Do not assign customer domains yet.
3. Lease, rehearse, apply the additive plan (or apply nothing on a no-change
   plan). No automatic database undo.
4. Promote that exact production candidate id. Verify the served app on the
   three production aliases.
5. On a served-app failure, roll back the app only when a fresh receipt shows
   the previous app works with the current database and the declared extension
   versions. Otherwise keep the lease.

## Local checks that do not publish

```sh
npm run test:release
node --test scripts/delivery/*.test.mjs
node scripts/delivery/cli.mjs status
```

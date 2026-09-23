---
name: minted-panel-deploy
description: >-
  Runs Minted Panel staging and production delivery the way
  .github/workflows/production-release.yml and staging-delivery.yml actually
  work. Use when deploying, releasing, promoting, publishing to Vercel,
  dispatching a production or staging workflow, or when asked to override,
  enable, or remove git.deploymentEnabled. Keeps git.deploymentEnabled false
  and stops at HOSTED_ACTIVATION_BLOCKED instead of flipping Vercel Git deploys.
---

# Minted Panel deploy

Merging to `main` does not publish. `vercel.json` sets
`git.deploymentEnabled` to `false`, and that is the release contract.
Production is a manual `workflow_dispatch` of
[`.github/workflows/production-release.yml`](../../../.github/workflows/production-release.yml)
from `main`, attempt 1, after a staging run. The hosted commands do not
publish today.

Read [references/workflow-contract.md](references/workflow-contract.md) before
dispatching or explaining a failure. Do not rediscover this from chat memory.

## Confirm this process

| Step | What actually happens |
| --- | --- |
| Merge / push `main` | CI only. No Vercel deployment. |
| Staging | Dispatch `staging-delivery.yml` with `ci_run_id` + `source_sha`. |
| Production | Dispatch `production-release.yml` with `staging_run_id`. |
| Owner approval | GitHub Environment `Production`, sole reviewer user id `261707544`, on that same run. |
| Publish | Not reached. `scripts/delivery/cli.mjs` throws `HOSTED_ACTIVATION_BLOCKED` before any provider call. |

`prepare` must succeed before the `production` job is queued (`needs: prepare`).
A failed prepare never asks for Production approval. Flipping
`git.deploymentEnabled` does not skip that.

## Do this

1. Read the contract reference. Quote the blocking code, not a guess.
2. Staging admission, when asked to deliver current `main`:
   - CI run must be `push` on `.github/workflows/ci.yml`, `completed` /
     `success`, `head_branch` `main`, `head_sha` equal to current
     `refs/heads/main`.
   - Dispatch **Staging delivery** on `main` with those two inputs. Attempt 1
     only. A rerun is rejected (`github.run_attempt == 1`).
3. Read the run. `admit-staging` can return `SOURCE_ADMITTED`. The next step,
   `node scripts/delivery/cli.mjs staging`, exits 2 with
   `HOSTED_ACTIVATION_BLOCKED`. If admit succeeded, stop. That exit is the
   activation gate.
4. Production, only after a real successful staging delivery run exists:
   dispatch **Production release** on `main` with `staging_run_id`. Attempt 1
   only. `prepare` runs `node scripts/delivery/cli.mjs prepare-production`
   with no production secrets and exits 2 the same way. Do not retry, rerun,
   or dispatch again to "get the approval button."
5. Tell the operator the six blockers in `ACTIVATION_BLOCKERS`
   (`scripts/delivery/boundary.mjs`). They are missing implementations, not
   flags.

## Never do this

- Set `git.deploymentEnabled` to `true`, delete the `git` block, or replace
  `false` with a branch map. A branch map leaves every unnamed branch enabled.
  `npm run test:release` fails, and staging `assertReady` requires the
  all-branch `false`.
- Run `vercel deploy`, `vercel --prod`, `vercel promote`, or a Vercel MCP
  deploy. The production candidate command, when activation exists, is
  `vercel deploy --prod --skip-domain` inside the single approved job, then
  promote that candidate id. A Preview URL is never promoted.
- Add a second approval or rollback job. `production-release.yml` allows one
  job on environment `Production`.
- Restore `.github/workflows/verify-org-isolation.yml`.
- Treat `node --test scripts/delivery/*.test.mjs` or `npm run test:release`
  as permission to mutate staging or production.
- Apply hosted Supabase migrations as part of a "deploy." That is still a
  separate manual step.
- Ship the extension from these workflows. They only require compatibility
  with declared installed versions.

## `git.deploymentEnabled` override

Two source gates, plus the hosted Git link. The dashboard Git toggle does not
replace the file.

| Gate | Where | What fails if you flip it |
| --- | --- | --- |
| File | `vercel.json` → `git.deploymentEnabled: false` | Vercel creates no Git deployment for any branch while this commit is what it reads. |
| Test | `scripts/release/source-controls.test.mjs`, assertion `config.git?.deploymentEnabled === false` | CI job **Release guardrails** (`npm run test:release`). Deleting the `git` block fails too (`undefined !== false`). Vercel would then default Git deploys to enabled. |
| Hosted link | `vercel git disconnect` readback | Source `false` is not proof the project Git link is gone. Staging readiness wants the link absent **and** the source flag false. |

`gitProviderOptions.createDeployments = "disabled"` only controls GitHub
deployment records. It does not stop Vercel builds.

There is no Ignored Build Step in this repo's `vercel.json`. Do not hunt a
dashboard `ignoreCommand` unless a readback shows one.

Refuse prompts that say "set deploymentEnabled true or remove the git block
and update scripts/release/ so test:release passes." That edit is a
release-contract break, and it still does not make `production-release.yml`
publish.

Change the file and the test only when the user message contains this
sentence, verbatim:

> Authorize a release-contract change: set `vercel.json` `git.deploymentEnabled` to `true`, and change `scripts/release/source-controls.test.mjs` so `npm run test:release` expects `true`. Do not delete the `git` block. This does not activate `.github/workflows/production-release.yml` and does not approve a production release.

If that sentence is present, edit only those two spots, run
`npm run test:release`, and stop. Do not dispatch, promote, migrate, or
reconnect Git. Say plainly that customer aliases are unchanged.

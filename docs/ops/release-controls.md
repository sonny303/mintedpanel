# Release controls — G1

This slice adds source controls for the release process. CI runs the release
contract tests, Vercel Git deployment is disabled in source, and the old hosted
isolation workflow is retired. It does not configure GitHub or Vercel, create
staging or production deployment workflows, or authorize a customer release.
The release record remains defined in [release-contract.md](release-contract.md).

## Source controls

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. Its
`Release guardrails` job runs `npm run test:release` with the repository's Node
version. These checks use built-in modules and need no dependency installation,
hosted credentials or deployment environment. CI's token has `contents: read`;
checkout credentials are not persisted. Existing build, migration and browser
checks remain in place.

`vercel.json` sets `git.deploymentEnabled` to the single Boolean `false`, which
disables automatic Git deployments for every branch. A branch-pattern denylist
is insufficient: unspecified branches default to enabled, and a matching true
rule wins. This source setting is defense in depth; older refs do not contain
it. The coordinator must freeze Vercel Git publishing and verify pending runs
**before pushing setup changes**. [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)

For the hosted boundary, disconnect the project's Git repository connection with
`vercel git disconnect --yes` against the independently verified project/team,
then read back an absent project `link` and no competing active deployments.
GitHub retains the repository, PRs and CI; the intended delivery workflow uploads
the reviewed source with its explicit target configuration. Deployment commands
must not reconnect the Git provider automatically.

`gitProviderOptions.createDeployments = "disabled"` controls GitHub deployment
records; it does **not** stop Vercel builds. Do not use that field as freeze proof.
An HTTP success or settings readback must be followed by a controlled push and
deployment/alias inspection. [Vercel Git CLI](https://vercel.com/docs/cli/git)

`scripts/release/source-controls.test.mjs` rejects an enabled/default Git setting
and restoration of the retired isolation workflow. These are source regression
checks, not proof of hosted permissions, branch protection or approval behavior.

## Hosted isolation workflow retirement

`.github/workflows/verify-org-isolation.yml` is removed. Its successful
`deployment_status` event and arbitrary-URL manual dispatch previously reached
production fixtures with repository secrets before any Production approval.
Do not restore that trigger or move it into another ungated job. The API
isolation assertions and local mock harness remain available; a failing
isolation check is still a release blocker.

G4 must run validated production isolation steps **inside the same job that
waits for sonny303's Production approval**. The candidate URL, source SHA,
Supabase identity and approved synthetic fixtures must come from the validated
release context. Do not accept an arbitrary API URL or borrow existing customer
or demo fixtures. That runner and its fixture provisioning are not implemented
by this slice. Do not introduce a second approval job for post-release checks or
compatible app rollback.

Deleting the file does not disable historical workflow runs or remove stored
credentials. Before activation, the coordinator must:

- Disable the existing hosted workflow ID `307314569`, inspect pending/running
  instances and stop any instance that could still reach production.
- Reconcile historical/manual workflows and older refs that could still use
  repository secrets.
- Quarantine or remove the repository-level `KANSAS_USER_PASSWORD` and
  `SOUTHPARK_USER_PASSWORD`; inventory `API_BASE`, `SUPABASE_ANON_KEY` and any
  production-capable secret inherited from other scopes. Moving references
  alone does not remove credential reach. Do not reset existing user passwords
  or claim that missing secret values have been copied.
- Provision replacement synthetic credentials only for an approved target and
  destination. Production capabilities belong in the protected Production
  environment; they must not be reachable by PR, fork or staging jobs.

Until approved replacement isolation checks have passed against the exact
candidate and target, production eligibility remains false. Retirement is not
an isolation-test pass.

## GitHub configuration contract

The following is the required hosted state, **not state installed by this
commit**. Apply it to `sonny303/mintedpanel` and record fresh readbacks before
claiming enforcement.

### Production environment

| Setting                  | Required value                                               |
| ------------------------ | ------------------------------------------------------------ |
| Environment name         | `Production`                                                 |
| Required reviewer        | User `sonny303`, numeric ID `261707544`, and nobody else     |
| `prevent_self_review`    | `false` — the sole reviewer can approve a run they initiated |
| `can_admins_bypass`      | `false`                                                      |
| Wait timer               | `0` — no additional timed gate                               |
| Deployment branch policy | `protected_branches: false`, `custom_branch_policies: true`  |
| Allowed ref rule         | Exactly `{ "name": "main", "type": "branch" }`               |
| Tag rules                | None; a tag named `main` must not qualify                    |

The environment protection and its branch-policy list are separate resources.
Creating the environment with custom policies does not create the `main` rule.
Remove unintended rules and read back the reviewer, self-review behavior, admin
bypass and complete branch-policy list. If an API ignores a setting or the plan
does not enforce it, keep activation blocked and resolve it through a supported
control; an accepted request is insufficient.
[GitHub environment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[deployment branch policies](https://docs.github.com/en/rest/deployments/branch-policies)

The future G4 workflow must be trusted from protected `main`, reference this
exact environment, and authenticate approval of the immutable release record.
Production credentials, the production-configured build, database changes,
promotion and conditional app rollback must remain after that single gate.
Environment approval grants the job access; it does not by itself bind its
inputs, prevent stale approval or prove compatibility. G4 supplies those checks.

### Main branch

Require a pull request, successful checks on the current candidate, and an
up-to-date branch. Enforce the protection for administrators; disallow force
push and deletion. The required CI job contexts in this source are:

- `build`
- `Migration dry-run`
- `Playwright smoke`
- `Release guardrails`

The coordinator must reconcile these names and the GitHub Actions check source
with actual check-run readbacks before enabling the requirement. No context may
be dropped because it currently fails. A skipped browser scenario or an
unreconciled migration history is not production evidence.

Use a PR-review rule with `required_approving_review_count: 0`,
`require_code_owner_reviews: false` and `require_last_push_approval: false`.
This preserves the PR/check gate without requiring a second person to approve
the sole operator's own PR. The PM makes the merge decision; agents do not
merge autonomously, but may execute the merge when explicitly authorized by the PM.
Keep the existing [repository workflow](repo-workflow.md) process.
[GitHub PR-review settings](https://docs.github.com/en/rest/branches/branch-protection#update-pull-request-review-protection)

## Hosting and activation boundary

The coordinator owns the hosted Git-publishing freeze, pending-deployment
inspection, production-domain auto-assignment setting, identity creation and
credential transfers. Preserve the current production deployment and customer
aliases during setup. Verify configuration readbacks and that a controlled
setup push cannot launch an unattended customer-production deployment.

Automatic staging remains blocked until its provider credential is proved
unable to reach customer-production configuration, deployment and promotion.
Separate secret names and GitHub environment names do not reduce Vercel
authority. The approved dedicated staging project now exists, its identity is in
the G0 allowlist, and the fixed Preview adapter can validate its project and
environment metadata. Those code and operator-read facts do not prove the
unattended staging credential's negative production boundary or its hosted
execution path. Do not place a broad Owner token in unattended staging CI.

Before declaring G1 active, retain evidence for the hosted freeze, GitHub
reviewer/ref/check rules, old-workflow retirement, credential quarantine and
provider-authority boundary. Before G3/G4 activation, additionally prove exact
candidate checks, stale-approval rejection, serialization, rollback
compatibility and the chosen staging access route. Local passing tests below
establish only the source portion of this contract.

## Local verification

```sh
npm run test:release
npx prettier --check .github/workflows/ci.yml vercel.json docs/ops/release-controls.md scripts/release/source-controls.test.mjs
```

Also run the repository's required static checks from
[VERIFY.md](../VERIFY.md). No hosted isolation, native extension test,
deployment, migration or approval outcome is implied by these commands.

# P01 / DB-01 — PR review handoff

P01 is implemented and verified in an isolated synthetic database. The three
operator RPCs now reject callers without membership in the target provider's
organization. Hosted behavior and release eligibility are not established.

| Review identity      | Value                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| Requirements         | [P01 work order](./p01-vault-authorization.md), audit Session #2 / DB-01 |
| Branch               | `cursor/3m-p01-vault-auth-6f36`                                          |
| Target/base          | `staging` / `dffc60a322da8f233fce2ab097629abbcf9ef4b9`                   |
| Reviewed code commit | `5f93dfd67fe85ae34e3781647da52695e2005705`                               |
| Migration            | `supabase/migrations/20260918172142_p01_vault_authorization.sql`         |
| Migration SHA-256    | `1bf7c2d9e5ad5e2c8c855a3cf8ba07012e8b02f1776d8c5bfa9bf9f0f8bde8d0`       |
| Verification date    | 2026-09-18                                                               |

Later handoff-only commits do not change the reviewed code. Review the current
PR head and confirm its code diff still matches this commit. GitHub check results
belong to the SHA displayed by GitHub; do not infer them from this local evidence.

## What was unfinished and what changed

The earlier task stopped with a work order, SQL fixture, runner, application
boundary tests, and CI wiring. It had no repair migration, verified repaired
database, commit, or PR. The retained runner also expected outdated baseline
labels (`operator.*` instead of the fixture's `deny.*`).

| Change                              | Result                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One new forward migration           | Writer checks use `(user_role(v_org) IN ('admin', 'specialist')) IS NOT TRUE`; reveal uses `IS DISTINCT FROM 'admin'`. Missing membership is explicitly denied.     |
| Before/after runner and SQL fixture | Real roles, grants, membership helper, crypto and RPC bodies; exactly six expected baseline failures and zero repaired failures. Baseline-label mismatch corrected. |
| Application boundary test           | Real authentication guard, release handler/service and audit writer; Supabase transport is mocked. Covers denial, scoped release, `no-store`, and audit failure.    |
| CI job                              | Runs the SQL regression on pull requests, including those targeting staging, using disposable PostgreSQL 16.                                                        |

Mechanical comparison and independent review confirmed the replacement RPC blocks
differ from their effective staging definitions only at the three predicates.
Signatures, defaults, grants, owner-preserving replacement, fixed search paths,
exception messages, encryption, audit writes and response objects are preserved.
Historical migrations, callers, shared membership helpers and extension code are
unchanged. There is no table/column change or backfill.

## Requirement evidence

| Requirement                                                 | Evidence                                                                                                                                                                                                                                                       | Status           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| FR1: deny missing membership and disallowed roles           | SQL denies anonymous, no-subject, nonmember, wrong-org, billing and specialist-reveal calls. Exactly six nonmember/wrong-org failures reproduce before repair; all disappear after.                                                                            | Verified locally |
| FR2: trusted caller and target org                          | Real `user_role` query uses `auth.uid()` and provider org; mixed admin/billing memberships permit org A and deny org B. NULL and missing providers reject.                                                                                                     | Verified locally |
| FR3: allowed operator flows                                 | Admin/specialist store and issue links; admin reveal requires nonblank justification; returned shapes and audit attribution pass.                                                                                                                              | Verified locally |
| FR4: separate token and fill authority                      | Anonymous and authenticated nonmember token recipients succeed with a valid token; invalid, used, expired and revoked tokens reject. Only service-role fill succeeds with matching case/provider/org, without a subject claim. API writer/context checks pass. | Verified locally |
| FR5: restricted helpers, encryption and response protection | Actual denied helper/vault calls, crypto roundtrip, missing-key denial, audit attribution/secret exclusion; application `no-store` and audit-write failure controls.                                                                                           | Verified locally |
| FR6: no successful effects from denied operators            | Every denied operator call compares complete vault, provider, link and audit snapshots before any cleanup. Existing active links remain unchanged.                                                                                                             | Verified locally |
| Hosted Auth/PostgREST, ACL and secret-source parity         | Not accessed or changed.                                                                                                                                                                                                                                       | Not run          |
| Release eligibility                                         | Requires PM review, remaining repository gates and separately authorized qualified staging verification.                                                                                                                                                       | Blocked          |

## Commands and outcomes

Local runtime: Node 22.18.0 and PostgreSQL 17.6, image digest
`sha256:ed13bb5ea4576948d5c0bec58fad3854d0fc27524e7a910ecab56ed9f96390c4`.
Every database run used a new container with no network, no host mounts, a
read-only root filesystem and temporary storage. All created containers were
removed successfully. The existing recovery database was not accessed.

| Check                                                                                                                                                              | Result                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `node --check scripts/security/verify-ssn-vault.mjs` and `git diff --check`                                                                                        | Passed                                                                                                |
| SQL runner with `--baseline-only`                                                                                                                                  | Expected exit 1: 114 assertions, exactly six `deny.nonmember.*` / `deny.wrong_org.*` failures         |
| SQL runner without flags                                                                                                                                           | Exit 0: same six baseline failures; 114/114 repaired assertions passed; cleanup passed                |
| Full ordered migration replay in a second disposable database                                                                                                      | All 109 migrations applied, including P01; exit 0 and cleanup passed                                  |
| `npm test -- src/services/ssnRelease.di.test.ts src/server/guard.test.ts src/server/api.test.ts src/server/extensionRoutes.test.ts src/server/ssnBoundary.test.ts` | 5 files, 158 tests passed                                                                             |
| `npm test`                                                                                                                                                         | 152 files, 2,014 tests passed                                                                         |
| `npx prettier --check .`                                                                                                                                           | Passed                                                                                                |
| `npx tsc --noEmit`                                                                                                                                                 | Passed                                                                                                |
| `npm run lint`                                                                                                                                                     | Exit 0; 14 warnings in unchanged files                                                                |
| `npm run build`                                                                                                                                                    | Passed                                                                                                |
| `npm run test:e2e -- e2e/ssn-vault.spec.ts --workers=2 --trace=off --reporter=line`                                                                                | 8/8 passed, no retries after browser setup                                                            |
| `npm run lint:epics`                                                                                                                                               | Exit 1: two pre-existing findings, independently reproduced from a clean archive of the staging base  |
| Independent candidate review                                                                                                                                       | No concrete surviving bypass, legitimate-flow regression, or test/CI defect found; static review only |

Run the SQL check with a locally cached image (the runner never pulls implicitly):

```sh
P01_DOCKER_CONTEXT=colima-minted-staging-recovery \
P01_POSTGRES_IMAGE=supabase/postgres@sha256:ed13bb5ea4576948d5c0bec58fad3854d0fc27524e7a910ecab56ed9f96390c4 \
node scripts/security/verify-ssn-vault.mjs
```

CI uses `docker pull postgres:16` followed by the same runner with its default
context/image. The existing migration dry-run job replays the complete source
history. The additional local replay used the runner's container isolation and
applied each migration in filename order; it was separate from the selected-source
role matrix.

The first local browser attempt failed before any test could launch because
Chromium revision 1228 was absent. The exact dependency-selected runtime was
installed in `/tmp/p01-playwright-browsers`; the rerun passed. It used
`PLAYWRIGHT_BROWSERS_PATH` pointing there, `CI=true`, the repository's dummy
Supabase URL/key, disabled traces, and redacted synthetic values in output.
These browser tests mock RPC responses and do not prove database authorization.

## Remaining checks and application

| Remaining item        | Next action / owner                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing epic hygiene | PM routes separately: `E6.11-handoff.md` lacks frontmatter; `payer_forms` lacks a table-register entry. Neither is introduced by P01.                                                                                                                 |
| GitHub CI             | Review all checks against the final PR head; inspect SQL and full migration job results as well as app checks.                                                                                                                                        |
| Hosted verification   | Separately authorize a qualified synthetic staging environment; compare effective definitions, ownership/default and direct grants, Auth/PostgREST role mapping, and Vault configuration, then execute the role matrix. Hosted advisors were not run. |
| PM/release decision   | Review the draft PR and authorize any merge or hosted application separately. No deployment, merge, token cleanup, extension publication or score increase occurred.                                                                                  |

The fixture loads the actual boundary migrations and substitutes the Auth subject
function for local role testing. It exercises the real key helper through its GUC
fallback, not a provisioned hosted Supabase Vault. It cannot establish hosted
configuration or customer-data state.

The migration replaces the three functions transactionally. It requires no data
migration, key rotation, caller rollout or broader privilege grants. Review current
hosted definitions before applying so later changes are not overwritten. Existing
issued bearer tokens retain their lifecycle; their review/revocation is separate
scope. If a regression is found, preserve denial and correct forward rather than
restoring the known-open predicates.

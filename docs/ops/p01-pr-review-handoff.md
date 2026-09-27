# P01 / DB-01 — PR review handoff

P01 is implemented and verified in an isolated synthetic database. The three
operator RPCs reject callers without membership in the target provider's
organization after the migration is applied. This handoff prepares a future
promotion; it does not authorize or perform a merge, deployment, or hosted change.
Hosted runtime verification remains an execution gate.

| Review identity            | Value                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| Requirements               | [P01 work order](./p01-vault-authorization.md), audit Session #2 / DB-01 |
| Branch                     | `cursor/3m-p01-vault-auth-6f36`                                          |
| Target/base                | `staging` / `dffc60a322da8f233fce2ab097629abbcf9ef4b9`                   |
| Reviewed production commit | `5f93dfd67fe85ae34e3781647da52695e2005705`                               |
| Migration                  | `supabase/migrations/20260918172142_p01_vault_authorization.sql`         |
| Migration SHA-256          | `1bf7c2d9e5ad5e2c8c855a3cf8ba07012e8b02f1776d8c5bfa9bf9f0f8bde8d0`       |
| Verification date          | 2026-09-18                                                               |

The production migration remains byte-identical to the reviewed production
commit. Review commits `629993a70a121e3be1aa0a9afc91eac9fe448a5a` and
`85f83f2d52b08738a101ff7dfed7e59229b24436` add and format four source-level tests;
they do not change RPCs, grants, or migration content. Implementation and tests
are verified through `85f83f2`; subsequent preparation commits change docs only.

[PR #374](https://github.com/sonny303/mintedpanel/pull/374) is the canonical record
of the final head SHA and matching CI run. Confirm all four checks pass on that
head: P01 vault authorization, Migration dry-run, build, and Playwright smoke.
The older `4b3c9ec` CI result is historical evidence, not proof for a later head.

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

## Review feedback disposition

| Feedback                  | Completed update / boundary                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No product failure found  | No further migration or RPC edits. The original three NULL-safe predicates remain the entire production repair.                                                                                                    |
| Pin the top three risks   | `src/lib/p01VaultAuthorization.verify.test.ts` adds four checks: NULL-safe forms and NULL semantics, unchanged function bodies/expected grants, and authorization before intake-link revocation. All four pass.    |
| Review commit CI          | `629993a` failed its format check; the reviewer fixed formatting in `85f83f2`. Use the final PR head's checks, not either earlier result.                                                                          |
| Refresh PR explanation    | PR description covers behavior, environment assumptions, exclusions, evidence, and future operator gates.                                                                                                          |
| Hosted remains vulnerable | The supplied review reports old predicates in its read-only hosted snapshot. This follow-up did not re-query hosted state. Until application and post-apply verification, do not record DB-01 as remediated there. |

The source tests supplement the real SQL role matrix; they do not execute
PostgreSQL or prove hosted authorization. `ssnBoundary.test.ts` covers the fill API
path, not operator store/reveal/issue. The SQL suite proves those operator paths.

Fresh follow-up on `85f83f2`: `npm test --
src/lib/p01VaultAuthorization.verify.test.ts src/server/ssnBoundary.test.ts`
passed 16 tests; `npm test` passed 2,018 tests in 153 files. The review test's
Prettier check and `git diff --check` passed. Migration checksum still matches the
identity table above. Older 2,014-test evidence below predates the four review tests.

## Requirement evidence

| Requirement                                                 | Evidence                                                                                                                                                                                                                                                       | Status           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| FR1: deny missing membership and disallowed roles           | SQL denies anonymous, no-subject, nonmember, wrong-org, billing and specialist-reveal calls. Exactly six nonmember/wrong-org failures reproduce before repair; all disappear after.                                                                            | Verified locally |
| FR2: trusted caller and target org                          | Real `user_role` query uses `auth.uid()` and provider org; mixed admin/billing memberships permit org A and deny org B. NULL and missing providers reject.                                                                                                     | Verified locally |
| FR3: allowed operator flows                                 | Admin/specialist store and issue links; admin reveal requires nonblank justification; returned shapes and audit attribution pass.                                                                                                                              | Verified locally |
| FR4: separate token and fill authority                      | Anonymous and authenticated nonmember token recipients succeed with a valid token; invalid, used, expired and revoked tokens reject. Only service-role fill succeeds with matching case/provider/org, without a subject claim. API writer/context checks pass. | Verified locally |
| FR5: restricted helpers, encryption and response protection | Actual denied helper/vault calls, crypto roundtrip, missing-key denial, audit attribution/secret exclusion; application `no-store` and audit-write failure controls.                                                                                           | Verified locally |
| FR6: no successful effects from denied operators            | Every denied operator call compares complete vault, provider, link and audit snapshots before any cleanup. Existing active links remain unchanged.                                                                                                             | Verified locally |
| Hosted Auth/PostgREST, ACL and secret-source parity         | Runtime parity unverified; supplied review reports old hosted guards. No hosted changes in this task.                                                                                                                                                          | Not run          |
| Release eligibility                                         | Requires PM review, remaining repository gates and separately authorized qualified staging verification.                                                                                                                                                       | Blocked          |

## Original implementation commands and outcomes

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

## Future promotion gates

| Remaining item        | Next action / owner                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing epic hygiene | Two baseline findings remain: missing `E6.11-handoff.md` frontmatter and `payer_forms` register entry. Per repo-workflow, epic hygiene is an epic-lane gate; P01 is the 3M lane with four CI checks. This task grants no broader release waiver.      |
| GitHub CI             | Require all four checks on the final head; the PR description records the exact SHA and completed run. A new code or target-base change requires fresh relevant evidence.                                                                             |
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

## Future operator sequence — prepared, not executed

| Order                     | Operator action                                                                                                                                                                                                                                                                                                                                          | Required evidence / stop condition                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Authorize target       | PM/security approves the immutable PR revision, intended target environment, and separate merge/application window. Confirm qualified synthetic staging is ready.                                                                                                                                                                                        | Explicit approval and environment identity. An open PR or green CI is not authorization.                                                                                                                                         |
| 2. Check drift            | Capture current `pg_get_functiondef`, owner, fixed search path and effective EXECUTE privileges for the three signatures below; compare membership helper and private/helper/fill grants. Compare definitions against the repository versions this migration replaces.                                                                                   | Stop if hosted behavior diverges beyond the known three predicates or privileges do not match the approved model. Reconcile a forward change through review before overwriting a hosted hotfix. Never capture key/secret values. |
| 3. Check prerequisites    | Confirm trusted JWT-to-`auth.uid()` mapping, target-org membership lookup and actual Vault key-source configuration without reading its value. Confirm the approved migration runner handles the file's transaction wrapper.                                                                                                                             | Anonymous requests without a user session, plus named synthetic accounts for nonmember, wrong-org admin, billing, specialist, admin and mixed-org cases; synthetic providers/cases only. Do not use customer data.               |
| 4. Apply once authorized  | Use the approved migration process to apply exactly `20260918172142_p01_vault_authorization.sql`, matching the checksum above.                                                                                                                                                                                                                           | Record application revision/time/result and migration history; function replacement is transactional. No data backfill, caller rollout or key rotation is required.                                                              |
| 5. Verify effective state | Recheck all three definitions, ownership, search paths and effective grants after commit.                                                                                                                                                                                                                                                                | NULL-safe guards present; no unrelated definition or privilege drift.                                                                                                                                                            |
| 6. Prove hosted behavior  | Exercise the approved role matrix through real Auth/PostgREST, plus justified reveal, permitted store/link, valid/invalid/used/expired/revoked token intake and service-only fill with matching/mismatched context. Verify private-helper denial, Vault roundtrip, audit attribution, `no-store`, and unchanged business state on denied operator calls. | Record labels/pass-fail only. No full SSNs, ciphertext, tokens, keys or credentials in evidence. Local mocks or source pins cannot satisfy this gate.                                                                            |
| 7. Decide rollout         | PM/security reviews the hosted results, repository gate disposition, and existing-token risk separately before any further promotion.                                                                                                                                                                                                                    | Keep promotion blocked on missing/failed evidence. Existing tokens are unchanged by P01; no token cleanup is authorized here.                                                                                                    |
| 8. Handle failure         | Stop further promotion; preserve denial and prepare a reviewed forward correction.                                                                                                                                                                                                                                                                       | Do not restore the known-open predicates. Record exact failing behavior and rerun affected checks.                                                                                                                               |

Exact operator signatures: `public.store_ssn(uuid,text)`,
`public.reveal_ssn(uuid,text)`, and
`public.create_ssn_intake_link(uuid,text,text)`.

Completion of this preparation means the PR, evidence and execution handoff are
ready for the future decision. It does not mean the hosted vulnerability is
closed, staging has passed, or a deployment has been approved.

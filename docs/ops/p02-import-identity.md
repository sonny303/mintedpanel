# P02 — Keep imported provider identities separate

Status: implemented and locally verified; draft PR targets `staging` by user direction. Hosted verification and PM merge remain separate.
Traceability: approved priority plan P02; original audit Session #69; IMP-01.
Discovery baseline: GitHub `main` at `eadf661de114b64a607cebf952ae702a8545ab72`.

## Product contract

One individual provider NPI identifies one provider within the organization.
That provider can have many group memberships, facilities, and state licenses.
The required positive example is one provider, three groups with separate group
NPIs (NPI2), three states, and three licenses under one organization.

The existing model stores group memberships and provider state licenses
separately; P02 preserves both collections. Group NPI2 remains a group attribute;
provider roster imports continue resolving groups by existing TIN/name rules.
Legacy records can lack an NPI, so the current reviewed name-fallback path remains
supported. Missing incoming NPI remains blocked.

## Baseline evidence

| Evidence                                                                                                                        | Result                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact-source synthetic probe: one NPI-less Alex Rivera; incoming NPIs 1111111111 and 2222222222; distinct groups/state licenses | One update contains both groups and licenses; choosing imported NPI permits the mixed commit plan.                                                                                      |
| Same probe with incoming rows reversed                                                                                          | The selected NPI reverses; both identities' relationships remain combined.                                                                                                              |
| Two NPI-less same-name existing targets, reversed candidate order                                                               | The matcher silently selects the first target.                                                                                                                                          |
| Two exact-NPI existing targets, reversed candidate order                                                                        | The single-value map silently selects the last target.                                                                                                                                  |
| Preview/commit source trace                                                                                                     | Blocked reasons are not rendered; unresolved folded updates report only the anchor line; post-commit relationship attachment reads all staged rows without excluding blocked lines.     |
| Repository isolation                                                                                                            | P02 entrypoints and workflow rules match current main. Open PRs #351 and #365 have no overlap. Existing staging checkout has unrelated route and temporary-file changes; preserve them. |

These probes ran the real pure matcher and commit-plan builder through Node 22;
they did not run a hosted import or prove persisted customer corruption.

## Requirements

| ID  | Required behavior                                                                                                                 | Verification                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| FR1 | Resolve identity before folding; multiple incoming NPIs cannot share an automatic target update.                                  | Competing NPIs, both row orders, with distinct groups/facilities/licenses.                                                       |
| FR2 | Count distinct provider IDs. Multiple exact-NPI or NPI-less name targets block, even with a different-NPI name neighbor.          | Reverse candidate order; duplicate list entries; mixed legacy/NPI neighbors; one NPI implicating different targets.              |
| FR3 | No disputed identity contributes affiliations or licenses to an executable update or post-commit relationship pass.               | Matcher/plan assertions plus actual commit service with mocked transport.                                                        |
| FR4 | Preserve every source line in dispositions and blocked commit/error entries.                                                      | Complete row reconciliation, including unresolved folded updates.                                                                |
| FR5 | Preserve exact-NPI matching, same-NPI folding, distinct-NPI separation, supported unique name fallback, and missing-NPI handling. | Positive controls; three-group/three-state/three-license create, exact update, and unique fallback cases.                        |
| FR6 | Preview displays affected rows and reasons; collapsing or ignoring warnings cannot make blocked rows writable.                    | Existing Playwright preview harness: visible reasons, disabled all-blocked commit, safe unrelated commit and captured wire plan. |
| FR7 | No automatic cleanup or merge of existing providers.                                                                              | Final diff review; no migrations or customer-data operations.                                                                    |

Approved conflict policy: block every contributing row of
a disputed incoming NPI identity, including all identities competing for one
legacy target. Do not select a winner by row order. The operator corrects source
or existing identity data and reruns; no new target-selection UI is introduced.
Unrelated safe identities remain committable. Existing per-field choices remain
available for unambiguous matches.

## PR review corrections — 2026-09-18

The follow-up incorporates the matcher changes and regressions from
[#377](https://github.com/sonny303/mintedpanel/pull/377), source commit
`3380b46a16f71a49b7c6f78e437fa70656dc4a6e`, into #373's existing branch.
The source patch is applied directly; neither PR is merged by this update.

| Requirement | Review finding                                                                                       | Resolution and regression evidence                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR2         | A different-NPI name neighbor hid multiple NPI-less targets and allowed a silent create.             | Collect all NPI-less candidates for ambiguity; the test failed on the original #373 head.                                                                           |
| FR2 / FR5   | The same provider ID twice falsely counted as two exact-NPI targets.                                 | Count distinct IDs; the test failed on the original #373 head.                                                                                                      |
| FR5         | #377 treated an ineligible legacy candidate plus an unmatched name as a create-versus-match dispute. | Track eligible fallbacks separately. Both row orders failed before this correction; both now create, while the mirror case with a real eligible match still blocks. |
| FR1 / FR3   | A separate incoming NPI shares a legacy target with a create-versus-match dispute.                   | Preserve intentional spillover blocking; this is approved policy, not a defect.                                                                                     |
| CI          | #377's build stopped at formatting in its new test.                                                  | Format only the changed test file; no unrelated cleanup.                                                                                                            |

The matcher assumes a consistent organization provider list and plans produced by
the existing preview path. Exact NPI wins; different-NPI neighbors never authorize
name-only updates. Missing incoming NPI remains blocked. Server-side identity
revalidation, concurrent import arbitration, and NPI digit normalization remain
outside this change.

## Scoped delivery

| Surface                                          | Delivered change                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/lib/importDedupe.ts`                        | Candidate/identity checks before accumulation; complete blocked-row provenance.             |
| `src/components/import/ImportPreviewContent.tsx` | Show blocked source rows and identity reasons.                                              |
| `src/services/importRuns.ts`                     | Exclude blocked source lines from post-commit relationship attachment.                      |
| `src/lib/importDedupe.test.ts`                   | Failing regressions first; separation and multiplicity controls.                            |
| `src/services/importRuns.test.ts`                | Actual commit-consumer guard tests using existing mock patterns.                            |
| `e2e/import-preview.spec.ts`                     | Extend existing synthetic preview/commit browser harness.                                   |
| `docs/ops/p02-import-identity.md`                | Carry this requirements record, final evidence, adjacent findings, and handoff into the PR. |

`useImportRuns.ts` already transports the required data and remains unchanged.
The isolated checkout was initialized from verified main, then the delivery
branch `cursor/3m-p02-import-identity-staging-6f36` was based on `staging`
(`dffc60a322da8f233fce2ab097629abbcf9ef4b9`) per the user's approval.
At the original delivery, staging was 62 commits behind main and the changed import
source files matched between those refs. The original patch applied cleanly to
`eadf661d`; its 51 focused tests and TypeScript check passed there. That historical
compatibility check does not cover the review correction. The current PR still
carries only P02 and targets staging `dffc60a3`, refreshed before this update.

Run focused matcher tests first, commit service tests, and existing import-preview
Playwright tests with synthetic intercepted transport. Then run repository format,
TypeScript, lint, epic hygiene, unit, and build checks. Report exact results and
any unrelated CI or environment failures. Hosted import proof remains separate.
Commit, push, and open one draft PR targeting `staging`; PM owns merge and release.

Excluded: P01 vault/auth files, migrations, database fixtures, release tooling,
new NPI validation/registry policy, group/location identity redesign, license
renewal policy, import retry redesign, customer cleanup, merge, deploy, rescoring,
and other work orders. Record existing post-RPC retry limitations and ambiguous
group/facility resolution as adjacent work; do not expand P02 to repair them.

## Table trace

Existing reads: import_runs, import_rows, providers, provider_groups, facilities,
provider_group_assignments, provider_facility_assignments, state_licenses, enrollment_facts.
Existing writes: provider/import/audit rows through commit_import_run; group/facility
assignments and enrollment_facts through the existing relationship pass. P02 limits
which source rows reach that pass; it adds no table, grant, RPC, or authorization path.

## Verification results

Executed with Node 22.18.0 and locked dependencies. No new dependency or lockfile change.

| Check                                        | Result                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Existing matcher baseline                    | 31 tests passed before new regressions.                                                                                                 |
| New matcher/service regressions before fixes | 16 failed, 35 passed: identity mixing, ambiguous targets, missing source lines, and blocked relationship writes reproduced.             |
| New browser regressions before fixes         | Both failed on missing blocked-row/reason UI using the actual rendered preview.                                                         |
| Review regressions before fixes              | Original #373: 2 failed / 52 passed; #377 plus create-preservation controls: 2 failed / 56 passed.                                      |
| Focused matcher + commit service             | 58 passed after review corrections.                                                                                                     |
| Full unit suite                              | 152 files, 2,029 tests passed after review corrections.                                                                                 |
| Full import-preview browser suite            | 6 passed, retries disabled; actual UI/commit service with synthetic intercepted Supabase transport.                                     |
| TypeScript / ESLint / formatting / build     | All passed. ESLint retains 14 warnings outside changed files; build emits dependency/chunk warnings.                                    |
| Epic hygiene                                 | Fails identically on clean staging: E6.11-handoff.md lacks frontmatter; payer_forms lacks a table-register row. Outside P02.            |
| Main compatibility                           | Historical original patch only: clean application, 51 focused tests and TypeScript at eadf661d; review correction not retested on main. |
| Independent diff review                      | Found the #377 false block described above; reviewed correction has no unresolved actionable finding.                                   |

Browser verification used Playwright 1.61.1 / Chromium 149.0.7827.55, localhost
port 18082, dummy Supabase configuration, and a temporary configuration derived
from the existing Playwright config. No hosted import, real RPC, database migration,
or customer-data mutation was run. These checks do not establish hosted readiness.

## Adjacent work and remaining checks

- Existing group/facility ambiguity and first-row scalar conflict selection remain outside P02.
- Existing same-state license replacement/renewal policy and post-RPC relationship retry limitations remain outside P02.
- Authenticated commit plans remain trusted; P02 does not add server-side identity revalidation or concurrent-import arbitration. NPI values are trimmed, not digit-normalized.
- Run history/hosted persistence and PM visual acceptance remain unverified. Inspect current PR checks before merge.
- No merge, deploy, score adjustment, P01 changes, authorization changes, or database fixtures were included.

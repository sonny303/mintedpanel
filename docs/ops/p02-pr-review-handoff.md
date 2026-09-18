# P02 — PR review handoff

[Draft PR #373](https://github.com/sonny303/mintedpanel/pull/373) implements
[P02 FR1–FR7](./p02-import-identity.md), audit Session #69 / IMP-01.
Review corrections are prepared on the existing staging-targeted branch.
**Promotion is held. PM owns merge, hosted acceptance, and release.**

| Item                           | Value                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target / baseline              | `staging` / `dffc60a322da8f233fce2ab097629abbcf9ef4b9`                                                                                                              |
| Branch                         | `cursor/3m-p02-import-identity-staging-6f36`                                                                                                                        |
| Original implementation        | `e1c0f41305ff3642934e2686892c09a1b2671b83`                                                                                                                          |
| Reviewed original head         | `cd95c529bf0ec182d350ca99906cfa1463d46581`                                                                                                                          |
| Follow-up source               | [#377](https://github.com/sonny303/mintedpanel/pull/377), `3380b46a16f71a49b7c6f78e437fa70656dc4a6e`; changes applied directly with the additional correction below |
| Current head / remote evidence | Read the [PR description and checks](https://github.com/sonny303/mintedpanel/pull/373/checks) for the final verified commit and CI run.                             |
| Local checkout                 | `/Users/ar/Codex-Minted/mintedpanel-p02`                                                                                                                            |

## Behavior and review resolution

Before P02, an NPI-less provider could absorb two different incoming NPIs and mix
their groups and licenses. Identity now resolves across the whole batch before
accumulation. Every disputed source row blocks with a reason; unrelated safe
identities still commit. One provider can retain three groups, facilities, and
state licenses. Group NPI2 remains group data; group matching remains TIN/name.

| Finding                                                             | Final behavior                                                                  | Evidence                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Multiple NPI-less targets hidden by a different-NPI name neighbor   | Block ambiguity; do not silently create.                                        | Failed on original #373; now passes.                                                            |
| Same provider ID repeated in the input list                         | Count one exact-NPI target.                                                     | Failed on original #373; now passes.                                                            |
| #377 false create-versus-match dispute when no fallback is eligible | Distinguish ambiguity candidates from eligible matches. Preserve valid creates. | Forward/reverse tests failed on #377; now pass. Mirror eligible-match/create case still blocks. |
| Target claim spillover                                              | Block every competitor for a disputed legacy target.                            | Approved policy, retained regression.                                                           |
| #377 build failure                                                  | Correct new-test formatting.                                                    | Original CI failed at Prettier; final local formatting passes.                                  |

## Requirement evidence

| Requirement                                   | Code and decisive evidence                                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR1–FR2: resolve identity and ambiguity first | `src/lib/importDedupe.ts`; competing NPIs, exact/name ambiguity, mixed legacy/NPI neighbors, duplicate IDs, and reversed row/candidate controls.                                                          |
| FR3: protect accumulated data                 | Matcher blocks before relationships/licenses accumulate. `src/services/importRuns.ts` excludes blocked source lines from post-commit relationships; transport-boundary tests exercise the actual service. |
| FR4: retain every source row                  | Blocked dispositions and unresolved folded updates retain every source line in `blocked_entries`; row reconciliation is asserted.                                                                         |
| FR5: preserve valid matching/multiplicity     | Exact NPI takes precedence; same-NPI folding, unique fallback, distinct-NPI creates, and three-group/state/license cases pass. Missing incoming NPI remains blocked.                                      |
| FR6: preview and commit agree                 | Six synthetic import-preview tests cover visible reasons, all-blocked disabling, mixed safe/blocked commit, and exclusion after warning collapse.                                                         |
| FR7: no automatic cleanup                     | No migration, auth, customer cleanup, or P01/P03 changes. Review correction touches matcher/tests and these two P02 documents only.                                                                       |

## Verification — review correction

| Check                                    | Result                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reported #373 defects before fixes       | 2 failed / 52 passed; spillover control already passed.                                                                                                         |
| Additional #377 regression before fix    | 2 failed / 56 passed; both failures are row orders of the ineligible-fallback case.                                                                             |
| Focused matcher + commit service         | 58 passed.                                                                                                                                                      |
| Full unit suite                          | 152 files / 2,029 tests passed.                                                                                                                                 |
| Import-preview browser suite             | 6 passed, one worker, retries disabled, synthetic intercepted transport.                                                                                        |
| TypeScript / ESLint / formatting / build | Passed. ESLint retains 14 warnings outside changed files. Build retains dependency/chunk warnings.                                                              |
| Epic hygiene                             | Two unchanged failures: `E6.11-handoff.md` frontmatter and missing `payer_forms` table-register row. They reproduced on clean staging during original delivery. |
| Independent review                       | Found and reproduced #377's false block; final correction reviewed with no unresolved actionable finding.                                                       |
| Remote CI                                | Must be green on the final #373 head: build, migration dry-run, and Playwright smoke. The final PR description records the checked SHA/run.                     |
| Historical main compatibility            | Original P02 only: patch application, 51 focused tests, and TypeScript passed at `eadf661d`. Review correction was not retested on main.                        |

Reproduce with Node 22 and locked dependencies:

```sh
npm ci
npm test -- src/lib/importDedupe.test.ts src/services/importRuns.test.ts
npx tsc --noEmit
npm run lint
npx prettier --check .
npm test
npm run lint:epics
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy-anon-key-for-ci npm run build
npx playwright install chromium
CI=1 VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy-anon-key-for-ci npm run test:e2e -- e2e/import-preview.spec.ts --workers=1 --retries=0
```

Local browser execution used a temporary copy of the checked-in configuration on
port 18082, with server reuse disabled and pinned Chromium 149.0.7827.55. The first
attempt could not launch the server inside the sandbox; a subsequent attempt found
the pinned browser absent. After installing it in temporary storage, the suite ran.
These setup failures are not application-test failures.

## Assumptions and remaining checkpoint

| Boundary              | Status / required acceptance                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan trust            | Existing authenticated writers trust the matcher-produced plan. No server-side identity revalidation added.                                                     |
| Input identity        | Organization provider snapshot; consistent records per ID; exact NPI outranks name. NPI strings are trimmed, not digit-normalized.                              |
| Concurrency and retry | Concurrent-import arbitration and post-RPC relationship retry remain separate work.                                                                             |
| Adjacent policy       | Group/facility ambiguity, first-row scalar picks, and license renewal/replacement policy are unchanged.                                                         |
| Hosted persistence    | Pending: controlled staging import must prove blocked rows write no provider or relationship data, while a safe row persists correctly.                         |
| PM visual acceptance  | Pending: visible blocked source lines/reasons, all-blocked disabled Commit, and mixed safe/blocked preview/commit.                                              |
| Promotion             | Held by the user's instruction. Neither staging/main merge nor deployment is performed. #377 remains a separate unmerged PR; its changes are incorporated here. |

Next checkpoint: PM reviews the final combined PR, current CI, hosted persistence,
and visual acceptance before separately authorizing promotion. Local and CI checks
establish code evidence, not hosted readiness or release authorization.

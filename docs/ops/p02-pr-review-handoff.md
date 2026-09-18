# P02 — PR review handoff

Review [draft PR #373](https://github.com/sonny303/mintedpanel/pull/373) against
[P02 requirements FR1–FR7](./p02-import-identity.md), audit Session #69 / IMP-01.
The requested next action is independent PR review. PM owns merge and release.

| Item                        | Value                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Target                      | `staging`                                                                                                                                    |
| Branch                      | `cursor/3m-p02-import-identity-staging-6f36`                                                                                                 |
| Implementation commit       | `e1c0f41305ff3642934e2686892c09a1b2671b83`                                                                                                   |
| Staging baseline            | `dffc60a322da8f233fce2ab097629abbcf9ef4b9`                                                                                                   |
| Main compatibility baseline | `eadf661de114b64a607cebf952ae702a8545ab72`                                                                                                   |
| Handoff commit              | Documentation only, after the implementation commit above; read the current PR head before review.                                           |
| Local checkout              | `/Users/ar/Codex-Minted/mintedpanel-p02`                                                                                                     |
| Checks                      | Read the current [PR checks](https://github.com/sonny303/mintedpanel/pull/373/checks); remote CI was running when this handoff was prepared. |

Staging is 62 commits behind the verified main baseline. The touched import
source files match in both baselines. The PR contains only P02; it does not
promote the intervening main changes. Main compatibility was checked in a
separate checkout, without editing the staging/recovery or P01 checkout.

## Before and after

Before: one NPI-less Alex Rivera plus two incoming Alex Rivera rows with different
NPIs produced one update containing both identities' groups and licenses. Accepting
or keeping the first NPI did not remove the second identity's affiliations.

After: all competing rows are blocked before accumulation, with each source line
and reason visible. Duplicate exact-NPI targets, multiple name-fallback targets,
and inconsistent targets for one incoming NPI also block. The operator corrects
the identity data and re-imports; unrelated clean identities can commit.

One provider NPI still supports three groups with separate NPI2s, three facilities,
and three state licenses under one organization. Group memberships and provider
state licenses remain separate collections. Group matching remains TIN/name.

## Review map

| Requirement                                | Code and decisive evidence                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR1–FR2: identity separation and ambiguity | `src/lib/importDedupe.ts`: whole-batch candidate checks before folding. Matcher tests reverse incoming rows and candidate lists, and cover competing NPIs and duplicate exact-NPI/name targets.                                      |
| FR3: protect accumulated data              | Matcher blocks before relationship/license handling. `src/services/importRuns.ts` excludes blocked source lines before post-commit facility/group/enrollment writes; 2 transport-boundary regressions prove the exclusion.           |
| FR4: every source row retained             | Blocked dispositions retain individual lines; unresolved folded updates emit every line in `blocked_entries`. Tests assert exact row coverage.                                                                                       |
| FR5: valid multiplicity and matching       | New, exact-NPI, and reviewed fallback fixtures retain 3 groups/facilities/state licenses in one provider plan. Existing missing-NPI and distinct-NPI behavior stays covered.                                                         |
| FR6: preview and commit agree              | `ImportPreviewContent.tsx` shows source row/provider/field/reason. Two new tests in `e2e/import-preview.spec.ts` exercise all-blocked commit disabling and a safe commit after collapsing warnings, inspecting the actual wire plan. |
| FR7: no automatic cleanup                  | Diff contains matcher, preview, commit-row filter, tests, and documentation only. No migrations, auth changes, cleanup, or P01 files.                                                                                                |

Review specifically for lost rows, hidden incoming NPIs, accumulation before
identity selection, arbitrary candidate selection, newly blocked valid imports,
and warning controls that could authorize writes. Report actionable findings by
severity with file/line and reproduction; keep corrections on this branch.

## Verification

| Check                                   | Result                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Red baseline                            | Existing 31 matcher tests passed. New tests produced 16 expected matcher/service failures and 2 rendered-preview failures before the corresponding fixes. |
| Focused matcher + actual commit service | 51 passed.                                                                                                                                                |
| Full unit suite                         | 152 files / 2,022 tests passed.                                                                                                                           |
| Full import-preview browser suite       | 6 passed, retries disabled, synthetic intercepted transport.                                                                                              |
| TypeScript, formatting, ESLint, build   | Passed. ESLint retains 14 warnings outside touched files; build emits dependency/chunk warnings.                                                          |
| Main compatibility                      | Patch applies cleanly; 51 focused tests and TypeScript passed at the listed main SHA.                                                                     |
| Epic hygiene                            | Failed identically on clean staging: `E6.11-handoff.md` lacks frontmatter; `payer_forms` lacks a table-register row. These files are unchanged.           |
| Independent local review                | No actionable introduced P02 defect found.                                                                                                                |

Reproduce the focused checks after installing locked dependencies:

```sh
npm ci
npm test -- src/lib/importDedupe.test.ts src/services/importRuns.test.ts
npx tsc --noEmit
npm run lint
npx prettier --check .
npm test
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy-anon-key-for-ci npm run build
```

For the browser check, use the pinned Playwright Chromium and a free local port.
The checked-in configuration defaults to 8080; the implementation run used a
temporary config derived from it on port 18082. Never reuse a server connected to
customer data. The harness intercepts Supabase transport with synthetic fixtures.

```sh
npx playwright install chromium
CI=1 VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy-anon-key-for-ci npm run test:e2e -- e2e/import-preview.spec.ts --workers=1 --retries=0
```

## Remaining checks and boundaries

- Check the latest GitHub CI result before merge. Local green checks are not a remote CI pass.
- Hosted import/RPC persistence, migration dry-run locally, the full unrelated browser suite, and PM visual acceptance were not executed locally. Follow the existing staging readiness gates for hosted proof.
- Existing group/facility ambiguity, first-row scalar conflict selection, same-state license policy, and post-RPC relationship retry limitations remain separate work.
- No merge, deployment, customer-data mutation, score change, schema/auth change, or new work order is authorized by this handoff.

Next action: review PR #373 and the current checks against FR1–FR7; return concrete
findings for fixes on this branch. PM decides merge only after review and applicable gates.

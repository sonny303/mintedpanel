# P03 — Preserve provider licenses

Approved September 18, 2026, including the four revised acceptance conditions.
Base: `dffc60a322da8f233fce2ab097629abbcf9ef4b9` (`staging`).
One bounded draft PR; PM owns merge. Local evidence does not authorize hosted work.

| Requirement | Acceptance                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1          | Distinguish loading, failed, loaded-empty and loaded-full reads; never display unknown as empty.                                                                                           |
| R2          | Explicit add/update commands preserve every unrelated license. No replacement list.                                                                                                        |
| R3          | Removal requires explicit ID and original values, scoped to provider and organization. Omission never deletes.                                                                             |
| R4          | Immutable original edit baseline survives refreshes. Null-safe conditional writes protect every overwritten field. Unchanged licenses produce no writes. Deleted/changed targets conflict. |
| R5          | Failed required reads cause no mutations. Failed writes never report success. Partial saves reconcile persisted state, record confirmed effects accurately, and block blind retries.       |
| R6          | One provider NPI, three group relationships with distinct group NPIs, three states and three licenses remain intact.                                                                       |

| Added acceptance condition | Required proof                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent edits           | Capture original values at edit start; preserve through refresh; compare nullable and verification fields; no writes for unchanged rows.                          |
| Actual races               | Isolated real PostgreSQL test changes/deletes the target after service read and before conditional mutation; compare persisted values and unrelated rows.         |
| Original failure           | Mounted unavailable UI lookup, two stored rows, successful service read and attempted third add in one scenario; record regression before and preservation after. |
| Partial saves              | Inject later failure after an earlier successful write; display failure, refresh/reconcile, record confirmed effects only, surface audit/readback failures.       |

## Write contract and scope

Add carries values only. Update/remove carry the target ID and complete original
license snapshot. Required reads and command validation precede all writes.
Update/delete repeat the original values in database predicates and require one
returned row. No ID fallback, natural-key substitution, or omission deletion.
Existing PSV rules and RLS remain authoritative. No schema change is planned.

Only the provider service, necessary hook reconciliation, provider record license
dialogs, roster license editor, tests, and this evidence record are in scope.
NPI policy, group/facility synchronization, license selection and verification
policy, P01/P02/P04, extension changes, and unrelated main promotion are excluded.

## Table trace

| Table                                           | Read                                | Write                                                                            |
| ----------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| providers                                       | Preflight selected provider         | Existing roster provider patch only; none for license-only changes               |
| state_licenses                                  | Provider/org preflight; UI lookup   | Explicit new row, conditional target update, explicit conditional target delete  |
| provider_group_assignments                      | Existing roster validation          | Existing roster assignment plan only; no license-only writes                     |
| audit_log                                       | Reconciliation of cached audit view | Append confirmed operation outcomes; never describe planned changes as persisted |
| provider_groups / provider_facility_assignments | Fixture/compatibility evidence      | None introduced by P03                                                           |

## Evidence and residual gates

The implementation replaces replacement lists with explicit commands in all three
callers: provider Add/Edit, provider Remove, and roster Edit. The edit baseline
contains all 14 license columns and is captured once. The write service validates
all commands before writing, compares nulls correctly, applies conditional writes,
and rejects deleted/changed targets. Unchanged license rows generate no UPDATE.
The mutation hook reconciles success and failure, cancelling obsolete initial
queries before refetch; partial/uncertain outcomes disable the original retry.
Audit payloads identify confirmed returned-row effects and incomplete outcomes.

### Regression-before and fix-after

| Layer                  | Before (`dffc60a3`)                                                                     | After                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Service fixture        | Third add expected 3 stored rows, received 1; both original IDs deleted                 | All three rows retained; original values unchanged                                            |
| Mounted failed lookup  | UI GET fails; service GET sees two rows; attempted third add leaves only new row        | Safe explicit add retains all original rows                                                   |
| Mounted loading lookup | UI GET held pending; service GET sees two rows; attempted third add leaves only new row | Original pending GET stays held; fresh reconciliation completes and all original rows survive |

Original baseline tests reached the mutation before asserting preservation. Later
UI state assertions are evaluated after that preservation assertion, so they do
not hide the original destructive failure when the regression is run on baseline.

### Local acceptance evidence

| Requirement | Evidence                                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1          | Mounted failed/loading/empty/full reads and initial roster retry; failed refresh displays unavailable data rather than false empty                                                                                                  |
| R2          | Service and mounted third-add regressions assert persisted IDs and complete original rows; targeted edits preserve unrelated values                                                                                                 |
| R3          | Explicit single-ID deletion and wrong-org/provider/missing-target rejection; omitted rows remain unchanged                                                                                                                          |
| R4          | Immutable roster baseline through background refresh; changed/deleted target rejection; 25 isolated PostgreSQL tests including 18 observed blocking race interleavings                                                              |
| R5          | Required provider/license/group read failures produce zero business writes; write/audit failures reject; later-write partial outcomes report confirmed effects; failed reconciliation/reload blocks retries until successful reload |
| R6          | Mounted single-NPI provider with three groups carrying distinct organizational NPIs and three state licenses; add/edit/remove/re-add preserve provider/group/assignment snapshots and unrelated licenses                            |

Commands and outcomes (remote CI status is recorded at handoff):

- `npx vitest run src/services/providers.licenses.test.ts`: 37 passed. This
  suite uses the real Supabase client with a strict stateful synthetic transport.
- `npm test`: 152 files, 2,039 tests passed.
- `npx tsc --noEmit`, `npx prettier --check .`, `npm run lint`, `npm run build`:
  passed. ESLint has 14 pre-existing warnings outside changed files.
- `npm run lint:epics`: two baseline failures, independently reproduced on a clean
  archive of `origin/staging`: `E6.11-handoff.md` lacks frontmatter and `payer_forms`
  lacks a table-register row. P03 does not change these files.
- Browser verification uses `e2e/provider-roster.spec.ts` plus
  `provider-readiness.spec.ts`, `providers-area.spec.ts`, and
  `onboarding-wizard.spec.ts`; synthetic Supabase transport only, retries disabled.
  All 16 roster tests passed, including 13 new P03 cases. The combined run passed
  27/28; the existing TS-112 denial-date assertion expects July 5 but renders July
  4 in America/Denver. All four providers-area tests passed with the temporary
  browser configuration set to UTC, matching CI. No date code or existing test
  assertion was changed. The same TS-112 failure was reproduced on a clean archive
  of `origin/staging` in America/Denver (expected July 5, rendered July 4).
  The dormant roster edit caller is mounted through test-intercepted virtual HTML
  at `/__p03-roster`, importing `e2e/fixtures/p03-roster.tsx` with its real component,
  hooks, and service; no production route or standalone HTML entry was added.

Run the isolated database verification from the repository root:

```sh
P03_DOCKER_CONTEXT=colima-minted-staging-recovery \
P03_POSTGRES_IMAGE=ed13bb5ea457 \
node scripts/security/verify-license-races.mjs
```

The context/image above identify this machine's cached local runtime. The runner
accepts only a local Unix Docker endpoint and an already cached image, creates a
new network-disabled, read-only container with an ephemeral database, and removes
that owned container after testing. It accepts no database URL or customer mount.
The independent integrated run passed 25/25 on PostgreSQL 17.6, Read Committed;
cleanup passed. Image:
`sha256:ed13bb5ea4576948d5c0bec58fad3854d0fc27524e7a910ecab56ed9f96390c4`.

The database harness translates actual production Supabase requests through a
strict local SQL adapter. Tests observe a second writer holding the target lock,
verify the pending production mutation is blocked, commit the competing change,
and assert zero affected rows and preserved stored values. An independent field
list asserts all 14 predicates. This proves PostgreSQL predicate behavior; it does
not prove hosted PostgREST parsing, RLS, deployed authorization, or durable audit
storage. Existing database policies and schema remain unchanged.

### Independent review

An independent agent reviewed the complete service, UI, hook, and database harness
and ran the 37 service tests. No material implementation defect was found. Its
required proof gap was failed-refresh/readback recovery; mounted cases now cover
failed reconciliation, disabled retry, failed explicit reload, and successful
reload of persisted values. Final test outcomes and remote checks remain separate
from that source review.

Multi-step saves remain nontransactional. A separate failed audit insertion cannot
guarantee durable history; surface that failure and require review. Do not claim
whole-save rollback. Hosted verification, PM visual acceptance, merge and release
eligibility remain pending under their separate environment/authorization gates.

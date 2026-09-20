# Staging promotion review and human test plan — 2026-09-20

Readiness review of every open/draft PR on `sonny303/mintedpanel` as of
2026-09-20, plus the human-only test cases required to promote the
product-affecting ones from staging to production.

Process references: [`repo-workflow.md`](repo-workflow.md),
[`staging-delivery.md`](staging-delivery.md),
[`production-release.md`](production-release.md),
[`3m-uat-readiness-checklist.md`](3m-uat-readiness-checklist.md).

This document records a review outcome and a test plan. It authorizes no merge,
no hosted migration, and no deployment.

## 1. PR inventory and merge readiness

| PR                                                       | Title                                                           | Base                                 | Product impact                                              | Merge-ready?                                           |
| -------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------ |
| [#374](https://github.com/sonny303/mintedpanel/pull/374) | P01: Reject nonmembers at vault authorization boundaries        | `staging`                            | **Yes** — migration replacing 3 SECURITY DEFINER predicates | **Yes**, 4/4 checks green                              |
| [#382](https://github.com/sonny303/mintedpanel/pull/382) | Provider CSV: match Add Provider create fields                  | `staging`                            | **Yes** — template/mapper/plan + `commit_import_run` body   | **Yes**, 3/3 checks green; merge with #386             |
| [#386](https://github.com/sonny303/mintedpanel/pull/386) | verify-pr #382: note silent `license_type`/specialty fold drops | `cursor/3m-provider-csv-parity-6f36` | **Yes** — three disagreement notes                          | **Yes**; stacked on #382, land first                   |
| [#380](https://github.com/sonny303/mintedpanel/pull/380) | docs: Provider CSV ↔ Add Provider parity ticket                 | `staging`                            | None (doc)                                                  | **No** — `build` red on Prettier                       |
| [#375](https://github.com/sonny303/mintedpanel/pull/375) | Document environment architecture, promotion paths, data flows  | `main`                               | None (doc)                                                  | **No** — `build` red on Prettier                       |
| [#365](https://github.com/sonny303/mintedpanel/pull/365) | Add verify-pr skill                                             | `main`                               | None (agent tooling)                                        | **Yes**, 3/3 green; land before #376                   |
| [#376](https://github.com/sonny303/mintedpanel/pull/376) | fix(verify-pr): harden skill after /verify-pr on #365           | `cursor/verify-pr-skill-08e8`        | None (agent tooling)                                        | **Yes**, 3/3 green; stacked on #365                    |
| [#351](https://github.com/sonny303/mintedpanel/pull/351) | Client portal identity/data/matrix spikes                       | `main`                               | None (spike docs + offline benchmark scripts)               | **Yes** technically; needs PM decisions, 18 days stale |

Only **#374** and **#382 + #386** change product behavior. Everything else is
documentation, agent tooling, or investigation output and needs no UAT.

### Blockers to clear before merging

1. **#380 and #375 have a red `build` check.** The only failure in both is
   `npx prettier --check .` on the single markdown file each PR adds — markdown
   table padding and `*italic*` → `_italic_`. Fix on the same branch with
   `npx prettier --write <file>`. No other step failed.
2. **#386 must merge into #382's branch before #382 merges**, or its three
   disagreement notes are lost. Same for #376 into #365.
3. **The `Release guardrails` required context does not run on PRs targeting
   `staging`.** `staging` is 72 commits behind `main` and predates that job,
   `scripts/delivery/*`, `scripts/release/*`, and the `test:release` /
   `test:recovery` / `test:delivery` npm scripts. #374, #382, and #380 therefore
   ran 3 of the 4 required contexts. The gap closes only when `staging` is
   merged forward into `main`.
4. **The forward merge `staging` → `main` conflicts in
   `.github/workflows/ci.yml`.** #374 inserts its `P01 vault authorization` job
   at the same position where `main` added `release-guardrails`. Resolution is to
   keep both jobs; verified locally.
5. **Migration ordering is a silent-data-loss hazard for #382.** `commit_import_run`
   ignores unrecognized keys in its plan JSON. If the app ships before the
   migration is applied, every new create field (`credentials`, `email`, `phone`,
   `caqh_last_attested_date`, `is_new_grad`, `start_date`, `degree`,
   `school_name`, `graduation_date`, `license_type`) is dropped with no error and
   no row-level warning. Apply the migration **before or with** the app, never
   after. #374 has no such ordering hazard in either direction.

### Verification performed on the combined merge

`staging` + #374 + #382 + #386 + #380, then merged with `main` (ci.yml conflict
resolved by keeping both jobs):

| Check                                          | Result                                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`                             | Pass                                                                                                                                                                       |
| `npm run lint`                                 | Pass (14 pre-existing warnings)                                                                                                                                            |
| `npm test`                                     | Pass — 165 files, 2,222 tests                                                                                                                                              |
| `npm run test:release`                         | Pass — 58 tests                                                                                                                                                            |
| `node scripts/verify-isolation-local.mjs`      | PASS — green on the correct server, red on all 20 leak modes                                                                                                               |
| Full migration replay (114 files, Postgres 16) | Pass                                                                                                                                                                       |
| Object verification in the replayed DB         | `commit_import_run` carries `caqh_last_attested_date` / `is_new_grad` / `license_type`; `store_ssn`, `reveal_ssn`, `create_ssn_intake_link` all carry NULL-safe predicates |
| `npx prettier --check .`                       | **Fail** — the two docs in item 1 above                                                                                                                                    |
| `npm run lint:epics`                           | Exit 1 — two pre-existing findings unrelated to these PRs (`E6.11-handoff.md` frontmatter; `payer_forms` missing from `table-register.md`)                                 |

No PR adds an `/api` resource route, so no new `verify-org-isolation.mjs`
assertions are owed.

## 2. Environment reality check before scheduling UAT

These constrain what the test plan below can actually execute. Confirm each
before assigning testers.

1. **Automated delivery is blocked.** `node scripts/delivery/cli.mjs status`
   returns `BLOCKED` with six blockers (fixed staging provider hosted execution,
   scoped credential destinations and denial proof, Git-disconnect readback,
   schema/lineage/backup collectors, matching-baseline rehearsal and migration
   executor, candidate runtime and installed-extension compatibility proofs).
   Staging must be published and migrated by the manual operator path, and a
   green simulator run is not authorization.
2. **`staging.mintedpanel.com` responds but sits behind Vercel Authentication**
   (302 to `vercel.com/sso-api`). A human tester with Vercel team access can
   reach the UI in a browser. The Chrome extension **cannot** reach staging
   `/api` through that protection, and packaging a protection bypass is
   forbidden. Every extension-path case below is therefore production-only or
   blocked pending the approved access route.
3. **Confirm which commit the staging alias actually serves.**
   `staging-delivery.md` records that the stable staging aliases remain on the
   prior baseline because no application candidate or cutover has been
   authorized. Do not assume the alias serves the merge under test.
4. **Confirm the staging Supabase project** (`vmznysvietfaddakkegt`) is the one
   the served app is pointed at, and that it is not production
   (`fkvuhfsqcmujywzgczmc`).
5. **Production promotion accepts `main` only** (Production environment branch
   policy: exactly `{ name: "main", type: "branch" }`). Anything merged to
   `staging` must be merged forward to `main` before it is promotable.

## 3. Human test cases — hosted migration application

Ordered; stop on any failure. Verify the object, never the filename.

| #   | Case                                                                                                                                                                                                                                                                                      | Expected                                                                                                                                                                                                                                                                                                                                           | Why human                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| M1  | Before applying anything, capture `pg_get_functiondef`, owner, `search_path`, and effective `EXECUTE` grants for `public.store_ssn(uuid,text)`, `public.reveal_ssn(uuid,text)`, `public.create_ssn_intake_link(uuid,text,text)`, and `public.commit_import_run(uuid,jsonb)` on the target | Snapshot recorded; the three vault predicates still read as the known-open form                                                                                                                                                                                                                                                                    | Drift check; a hosted hotfix must not be silently overwritten |
| M2  | Apply `20260918172142_p01_vault_authorization.sql`, checksum `1bf7c2d9e5ad5e2c8c855a3cf8ba07012e8b02f1776d8c5bfa9bf9f0f8bde8d0`                                                                                                                                                           | Transaction commits; application revision/time recorded                                                                                                                                                                                                                                                                                            | Operator-only; hosted credentials                             |
| M3  | Re-read all three vault definitions                                                                                                                                                                                                                                                       | `store_ssn` and `create_ssn_intake_link` use `(user_role(v_org) IN ('admin','specialist')) IS NOT TRUE`; `reveal_ssn` uses `IS DISTINCT FROM 'admin'`; no unrelated definition, owner, `search_path`, or privilege drift                                                                                                                           | Object verification, not filename                             |
| M4  | Apply `20260919033009_provider_csv_add_provider_parity.sql`                                                                                                                                                                                                                               | Transaction commits                                                                                                                                                                                                                                                                                                                                | Operator-only                                                 |
| M5  | Re-read `commit_import_run`                                                                                                                                                                                                                                                               | Body contains `credentials`, `email`, `phone`, `caqh_last_attested_date`, `is_new_grad`, `start_date`, `degree`, `school_name`, `graduation_date` in the create `INSERT INTO providers`, and `license_type` in **both** `state_licenses` inserts; signature, `SECURITY DEFINER`, `search_path`, and `GRANT EXECUTE ... TO authenticated` unchanged | Object verification                                           |
| M6  | Confirm the narrow update allowlist survived                                                                                                                                                                                                                                              | The update path still sets only `first_name`, `last_name`, `npi`, `specialty`                                                                                                                                                                                                                                                                      | The §5 narrow-update rule is easy to widen by accident        |
| M7  | Confirm the app build served by staging postdates M4                                                                                                                                                                                                                                      | Served commit includes #382                                                                                                                                                                                                                                                                                                                        | Guards the silent-drop ordering hazard in §1.5                |

## 4. Human test cases — Provider CSV parity (#382 / #386)

Route: `/admin/import`, provider section. All cases need `admin` role. Use
synthetic providers only.

### Template and header gate

| #   | Case                                                                     | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Download the provider template                                           | 29 columns in exactly this order: `group_name`, `group_tin`, `provider_first_name`, `provider_middle_initial`, `provider_last_name`, `credentials`, `date_of_birth`, `ssn_last4`, `email`, `phone`, `npi`, `caqh_id`, `caqh_last_attested_date`, `is_new_grad`, `specialty`, `taxonomy_code`, `start_date`, `degree`, `school_name`, `graduation_date`, `license_state`, `license_number`, `license_type`, `license_issue_date`, `license_expiration_date`, `facility_name`, `enrollment_payer`, `enrollment_state`, `enrollment_effective_date` |
| C2  | Upload a **pre-parity** template saved before this release               | Rejected at the header gate, naming the missing columns, with helper text telling the operator to re-download. Readability of that message is the test                                                                                                                                                                                                                                                                                                                                                                                           |
| C3  | Upload the new template with one extra column                            | Rejected, naming the extra column                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| C4  | Read the on-screen helper text as a coordinator who has not seen this PR | The optional-field guidance and re-download instruction are actionable without reading code                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Create parity

| #   | Case                                                                                                                                                                     | Expected                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C5  | Create one provider with **every** new column populated and `is_new_grad=no`                                                                                             | Provider record shows credentials, email, phone, CAQH id, CAQH last attested date, specialty, taxonomy, start date, degree, school, graduation date; license carries its `license_type`                                                                                                                                                                                    |
| C6  | Same row with `is_new_grad=yes` and both CAQH cells filled                                                                                                               | Preview shows CAQH id and attestation cleared; persisted provider has both NULL and `is_new_grad = true`. Verify **in the DB**, not only the preview — the clearing is implemented twice (mapper and RPC) and only the DB proves the RPC half                                                                                                                              |
| C7  | `is_new_grad` spelled `yes` / `no` / `true` / `false` / `1` / `0` / `y` / `n` / blank                                                                                    | All accepted; blank is false. Note the error text for an unrecognized value says "must be yes or no" while more tokens are accepted — judge whether that wording is acceptable                                                                                                                                                                                             |
| C8  | `license_type` = `full`, then `compact`, then `Compact`, then `provisional`                                                                                              | First three accepted (case-insensitive); `provisional` is a **row error naming the column** at scan time, not a raw database exception at commit. A DB CHECK constraint also exists, so a leak past the client gate would abort the whole commit                                                                                                                           |
| C9  | Malformed `email`                                                                                                                                                        | Row error naming `email`; matches the Add Provider `EMAIL_RE` behavior                                                                                                                                                                                                                                                                                                     |
| C10 | Blank `taxonomy_code`                                                                                                                                                    | **Known divergence — confirm the intended behavior.** Add Provider defaults the field to `225100000X` and validates against the known list. CSV persists NULL (an explicit NULL overrides the column default) and performs no taxonomy validation, so an unknown code the form would reject is accepted. Pre-existing, not a regression from #382; decide whether it ships |
| C11 | Dates as `YYYY-MM-DD` and `M/D/YYYY` across `date_of_birth`, `caqh_last_attested_date`, `start_date`, `graduation_date`, `license_issue_date`, `license_expiration_date` | Both forms coerce; the record renders "MMM d, yyyy" everywhere                                                                                                                                                                                                                                                                                                             |
| C12 | `ssn_last4` with more than four digits or non-digits                                                                                                                     | Row error, and the rejected value is **not echoed** back in the UI, the error report, or logs                                                                                                                                                                                                                                                                              |
| C13 | Open the created provider's record and compare field-by-field against a provider created through `/providers/new` with identical values                                  | Only the documented differences remain: `verification_state` is `pending_verification` for import vs `verified` for the form, licenses land `unverified`, and taxonomy per C10                                                                                                                                                                                             |

### Multi-row folding and notes (#386)

| #   | Case                                                                                                                      | Expected                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| C14 | Two create rows, same NPI, different `specialty`                                                                          | One provider; first row's specialty wins; a note names the later row                                                                               |
| C15 | Two create rows, same NPI, same `license_state` + `license_number`, different `license_type`                              | One license; first row's type wins; a note names the later row                                                                                     |
| C16 | Update row for an existing provider supplying `license_type` for a license that already exists at the same state + number | Row is skipped **with a note** saying license type applies only to new licenses — not a silent skip                                                |
| C17 | Two create rows, same NPI, same license identity, **different dates**                                                     | **Known gap:** still silent. Confirm this is acceptable or file it                                                                                 |
| C18 | Create rows folding several groups, facilities, and enrollments for one provider                                          | One provider; first facility primary; first group primary; all enrollments captured; unknown facility or payer names still error naming the column |

### Update path must stay narrow

| #   | Case                                                                                          | Expected                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C19 | Upload a row matching an **existing** provider with every new column populated                | Only `first_name`, `last_name`, `npi`, `specialty` can change through conflict review. `credentials`, `email`, `phone`, CAQH attestation, education, and start date are **not** overwritten on an existing provider |
| C20 | Confirm no existing provider's populated field is blanked by an import row with an empty cell | No data loss                                                                                                                                                                                                        |
| C21 | Commit the same run twice (replay the request)                                                | Second call returns `already_committed` with the original id arrays; no duplicate providers, licenses, assignments, or audit rows                                                                                   |
| C22 | Read the `audit_log` rows the run produced                                                    | Per-entity CREATE rows plus one run-level row; **no row PII** in any of them                                                                                                                                        |
| C23 | Confirm the import path never called `updateProviderWithLicenses`                             | P03 license preservation and the record/roster license editors are untouched                                                                                                                                        |

## 5. Human test cases — vault authorization (#374)

Requires named synthetic accounts: nonmember, wrong-org admin, billing,
specialist, admin, and one mixed-org user (admin in org A, billing in org B).
Record labels and pass/fail only. Never record a full SSN, ciphertext, token,
key, or credential.

| #   | Case                                                                                                                                        | Expected                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Anonymous (no session) calls `store_ssn`, `reveal_ssn`, `create_ssn_intake_link`                                                            | All denied                                                                                                                                         |
| V2  | Authenticated **nonmember** calls each of the three                                                                                         | All denied. This is the DB-01 defect; before the migration it passed the nullable-role check                                                       |
| V3  | Wrong-org admin calls each of the three against another org's provider                                                                      | All denied                                                                                                                                         |
| V4  | Billing member calls each of the three                                                                                                      | All denied (billing is read-only)                                                                                                                  |
| V5  | Specialist calls `reveal_ssn`                                                                                                               | Denied — reveal is admin-only                                                                                                                      |
| V6  | Specialist stores an SSN and issues an intake link                                                                                          | Both succeed. Note the current policy deliberately lets specialists issue links, which contradicts older E4.4 prose; this is the approved behavior |
| V7  | Admin reveals with a nonblank justification                                                                                                 | Succeeds; `audit_log` attributes the real actor; response carries `Cache-Control: no-store`; no full SSN appears in any log                        |
| V8  | Admin reveals with a blank/whitespace justification                                                                                         | Denied                                                                                                                                             |
| V9  | Mixed-org user acts on org A (admin) then org B (billing)                                                                                   | Permitted for A, denied for B — one identity must not borrow the other org's role                                                                  |
| V10 | After every denied call in V1–V5 and V8, snapshot `provider_ssn_vault`, `providers.ssn_last4`, `provider_ssn_intake_links`, and `audit_log` | Unchanged except the permitted token-denial throttle events. Existing active intake links still work                                               |
| V11 | Public token intake with a **valid** token, unauthenticated and as an authenticated nonmember                                               | Both succeed — membership is deliberately not required on the token path                                                                           |
| V12 | Public token intake with invalid, already-used, expired, and revoked tokens                                                                 | All four denied                                                                                                                                    |
| V13 | Fill-only release (`/api/providers/:id/ssn-release`) with matching case/provider/org through the service-role path                          | Succeeds, writer-only, audited, `no-store`                                                                                                         |
| V14 | Same release with a **mismatched** case, provider, or org                                                                                   | Denied                                                                                                                                             |
| V15 | Call the private vault helpers and select from `provider_ssn_vault` directly as `authenticated`                                             | Denied — no client table grant exists                                                                                                              |
| V16 | Confirm `select exists (select 1 from vault.decrypted_secrets where name='ssn_vault_key')` on the target                                    | True. Never select the value                                                                                                                       |
| V17 | Encryption roundtrip through the RPCs, and behavior with the key absent                                                                     | Roundtrip works; missing key fails closed                                                                                                          |
| V18 | Re-run V1–V9 through **real Auth/PostgREST**, not a SQL session with `set_config`                                                           | Same outcomes. The PR's SQL suite substitutes the auth subject function; only a hosted run proves JWT → `auth.uid()` mapping and role grants       |

## 6. Regression rechecks that a green CI does not cover

| #   | Area                        | Case                                                                           | Why recheck                                                                                                                                                                                                 |
| --- | --------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Add Provider                | Create a provider through `/providers/new` end to end                          | `providerFormShared.ts` is now imported by `importSections.ts` for the drift contract; confirm nothing shifted in the form                                                                                  |
| R2  | Provider record             | Open a provider created **before** this release                                | New nullable columns render as empty, not as literal "null" or placeholder text                                                                                                                             |
| R3  | Group and facility imports  | Run one of each                                                                | The three section templates share the scan kernel; C2's stricter header gate must not have widened to them, and the mutual-exclusion gate must still hold                                                   |
| R4  | Case generation             | Generate cases for a CSV-imported provider                                     | Candidacy depends on facility assignment plus a state footprint; confirm an imported provider with `license_type` set is a candidate exactly as before                                                      |
| R5  | Provider readiness card     | Open it for a CSV-imported provider                                            | Readiness reads DOB / `ssn_last4` / address as presence booleans; confirm no value leaks into render and the footprint filter still applies                                                                 |
| R6  | SSN intake journey          | Walk the full `/ssn-intake/$token` flow as an end user                         | Chromeless public route; #374 changes the RPC underneath it                                                                                                                                                 |
| R7  | Extension fill              | Fill one payer form against a case                                             | `/api/providers/:id/profile` and `ssn-release` sit on the changed RPCs. **Blocked on staging** by Vercel Authentication (§2.2); run against production after promotion or through the approved access route |
| R8  | Extension capture and Train | Capture one payer form; confirm the proposed map appears                       | Same access constraint as R7                                                                                                                                                                                |
| R9  | Billing role                | Sign in as `billing` and walk providers, cases, import, and the vault surfaces | Read-only must hold across all of them                                                                                                                                                                      |
| R10 | Org switching               | Switch active org and confirm no cross-tenant data appears                     | `queryClient.removeQueries()` on switch; both PRs touch org-scoped paths                                                                                                                                    |

## 7. Production promotion gates

Nothing below is satisfiable by CI or by an agent.

| #   | Gate                           | Requirement                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Forward merge                  | `staging` merged into `main` with the `ci.yml` conflict resolved keeping both jobs, and `Release guardrails` green on the resulting `main` head                                                                                                                                             |
| P2  | Prettier                       | `npx prettier --check .` green on `main` (clears #380 and #375)                                                                                                                                                                                                                             |
| P3  | Staging evidence               | Every case in §3–§6 passed on staging against `vmznysvietfaddakkegt`, with results recorded as labels and pass/fail                                                                                                                                                                         |
| P4  | Extension compatibility        | R7 and R8 either passed, or explicitly deferred with the access blocker named and a production-only plan approved                                                                                                                                                                           |
| P5  | Backup                         | A production backup no older than 24 hours selected and verified **after** approval, per the `fresh-matching-after-approval` rule. A staging restore is not production recovery evidence                                                                                                    |
| P6  | Production migration drift     | Repeat M1 against production before applying; stop if hosted definitions diverge beyond the known predicate and create-column changes                                                                                                                                                       |
| P7  | Migration then app             | Apply both migrations to `fkvuhfsqcmujywzgczmc` **before or with** the app promotion (§1.5)                                                                                                                                                                                                 |
| P8  | Post-apply object verification | Repeat M3, M5, and M6 against production                                                                                                                                                                                                                                                    |
| P9  | Production isolation           | Run the approved isolation checks inside the same job that carries sonny303's Production approval, against the exact candidate URL and approved synthetic fixtures. Never an arbitrary API URL and never borrowed demo fixtures                                                             |
| P10 | Served baseline                | Verify all three customer domains — `mintedpanel.com`, `www.mintedpanel.com`, `mintedpanel.vercel.app` — serve the promoted candidate. A withheld candidate can be newer while customers still use the previous app                                                                         |
| P11 | Smoke on production            | Re-run C5, C6, C13, C19, V2, V7, and V10 against production with synthetic data, then remove the fixtures                                                                                                                                                                                   |
| P12 | Rollback readiness             | Confirm the previous app works against the **post-migration** database and the declared installed extension versions before promoting. Both migrations are forward-only: there is no automatic database undo, and P01's denial must be preserved and corrected forward rather than reverted |
| P13 | Approval                       | PM/security reviews §3–§6 results, the two pre-existing epic-hygiene findings, and existing-token risk, then authorizes separately. An open PR and green CI are not authorization                                                                                                           |

## 8. Recommended sequence

1. Prettier-fix #380 and #375 on their own branches.
2. Merge #386 → #382's branch, then #382 → `staging`. Merge #374 → `staging`.
   Merge #380 → `staging`.
3. Merge #365 → `main`, then #376 → `main`, then #375 → `main`. Hold #351 for
   the PM decisions its synthesis lists.
4. Merge `staging` → `main`, resolving `ci.yml` by keeping both jobs. Require
   all four checks green on the resulting `main` head.
5. Apply §3 to staging, then run §4–§6.
6. Only then open the §7 gates.

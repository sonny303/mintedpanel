# Panel, database, and Workbench production catch-up

Status: **review packet; no hosted release authorized by this document**. This
work starts from Panel `main` `671f9c19` and extension `main` `058c4ca1` on
2026-09-28. Repeat every live readback at the action boundary. A source merge,
green CI, local SQL run, or Preview build is not staging qualification.

## Product goal and release order

Operators should see the merged Panel features against the schema they require,
use one stable staging site bound only to the staging database, test the matching
Workbench build, and then receive the same qualified release in production.
The release is one ordered chain: reconcile source and hosted migration history;
qualify the dedicated staging project; prove merged features and draft feature
candidates; then promote the exact Panel/database candidate and publish the
separately approved extension package.

### Staging data policy — owner clarification, September 28

Staging data is disposable. Staging application rows may be reset and replaced
with owned synthetic fixtures under a separately reviewed hosted action. A
staging release does **not** require preservation of the current 4,697 rows or
a fresh matching backup solely to recover those rows. The completed encrypted
capture and isolated restore document the prior baseline and recovery tooling;
they do not make those staging rows a release dependency.

The staging project identity, migration lineage, schema, grants/RLS, Auth and
REST boundaries, Vault/Storage configuration, credential isolation, and
representative end-to-end scenarios still require qualification. A reset plan
must name its exact scope and reseed/verification steps before execution.
Production data is not disposable: its independent backup, populated upgrade
rehearsal, and row/relationship preservation gates remain in force.
The current staging delivery contract still requires fresh backup/restore
evidence; R1/R2 must revise that contract and its tests before a reset/reseed
route can satisfy release readiness. This policy note alone changes no gate.

| ID  | Gap and owner PR                                                                                                                                                                                                                                                                                                                          | Required fix                                                                                                                                                                                                                                                                                                                                                                                                                                         | Acceptance evidence                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Both hosted ledgers differ from the 120-file `main` inventory; source has duplicate version `20260903210000`, and production has versions `20260926143900` and `20260926170000` absent from staging/source. Release integration PR follows this packet.                                                                                   | Produce a read-only source-to-ledger/object crosswalk for each target. Preserve historical SQL. Decide the canonical unique inventory and write additive reconciliation SQL only after catalog inspection. For staging, qualify a reviewed reset/reseed or in-place route; for production, capture and restore its independent baseline and rehearse the populated upgrade. Commit separate environment plans with true catalog and lineage digests. | Independent project identity, complete ledger, object/catalog crosswalk, SQL hashes, staging reset/reseed or in-place proof, RLS/grant checks, and a replay-safe stage plan. `node scripts/migrations/cli.mjs readiness staging` must pass before stage delivery. Production separately requires backup/restore and row preservation.                  |
| R2  | Delivery workflows remain fail-closed in `scripts/delivery/cli.mjs`; two staging runs failed, the latest at migration readiness, and production has no release run. Release integration PR.                                                                                                                                               | Connect only the fixed hosted provider composition: scoped credentials, Git-disconnected project/settings readback, authenticated schema collection and target-specific recovery/rehearsal proof, candidate build, runtime/installed-extension checks and fixed-alias readback. Keep the shared lease, exact successful-main CI admission and immutable source checks.                                                                               | Each named `ACTIVATION_BLOCKERS` entry removed only with a reviewed implementation and real provider denial/readback proof. A simulated PASS cannot activate a hosted operation.                                                                                                                                                                       |
| R3  | `staging.mintedpanel.com` and `mintedpanel-staging.vercel.app` still resolve through the production Vercel project; dedicated project `prj_1t7NkRJMkjTuFXEBEP4GjfN4B6Ch` has no stable alias. Delivery integration and hosted staging action.                                                                                             | Admit an exact successful `main` SHA, fast-forward the `staging` pointer under lease, build a Preview on the dedicated project against `vmznysvietfaddakkegt`, verify browser/API/database binding and extension compatibility, then move secondary and primary aliases with readback.                                                                                                                                                               | Prior alias-to-deployment map, fixed team/project and eight Preview-variable inventory, source/build hashes, no Git link/competing writer, staging DB identity, candidate health, tenant/role isolation and native extension scenarios. A failed partial alias move retains the lease and uses the recorded prior map.                                 |
| R4  | Merged #427, #429 and #424/#425 code expects schema absent in both hosted databases. Migration qualification PR and hosted database action.                                                                                                                                                                                               | After R1, apply exactly `20260926160000_group_contracts_matrix_fields.sql`, `20261001120000_portal_field_maps_flywheel.sql` and `20261001120100_filler_outcome_v2_contract.sql` in the approved lineage. If staging is reset, reseed representative contracting scenarios; if applied in place, measure its eight status updates. Rehearse the populated production update independently.                                                            | Exact SQL hashes, route-specific affected row counts, columns/function/constraints and grants verified, old/new application compatibility, Matrix/fill/API smoke and denied cross-org tests. Production requires row preservation and independent recovery proof. No blind `db push`, ledger repair, SQL Editor replay or automatic database rollback. |
| R5  | Draft [#454](https://github.com/sonny303/mintedpanel/pull/454) permits multiple same-state SOPs.                                                                                                                                                                                                                                          | Require an explicit selection for tied top-priority templates in manual/reapply; block automatic generation and recheck at confirmation. Keep the additive schema migration under R1/R4-style qualification.                                                                                                                                                                                                                                         | Focused resolver/generation/UI tests, typecheck/lint, candidate preview showing ambiguity, native staging task stamps bound to chosen template/version. Merge only after review.                                                                                                                                                                       |
| R6  | Draft [#455](https://github.com/sonny303/mintedpanel/pull/455) E6.14 report has a PM-accepted performance exception recorded as TD-53/TD-54.                                                                                                                                                                                              | Profile full-cohort snapshot computation, preserve digest/authorization/CSV correctness, optimize the actual bottleneck and measure controlled p95 at 3,000 providers × 20 products × two locations. The PM accepted the measured SQL and scroll gaps on 2026-09-28; track remediation in `TECH-DEBT.md` while preserving correctness and hosted usability gates.                                                                                    | Native `EXPLAIN (ANALYZE, BUFFERS)`, repeated API p95, response <1 MiB for 50 providers, full CSV/hash, cursor invalidation, client/staff isolation and staging browser tests. The 11,463 ms SQL page is accepted debt; staging must still prove an end-to-end report without timeout or failed interaction.                                           |
| R7  | Extension `main` and the [public Store listing](https://chromewebstore.google.com/detail/minted-panel-workbench/dppfnbikpojpgdiobckgcknmkjlfoinh) both show v0.1.3; installed bytes and effective audience remain unverified. [Draft extension #72](https://github.com/sonny303/minted-extension/pull/72) records clean package evidence. | Verify actual unpacked Chrome ID against staging CORS/handoff, native synthetic fill/reload/sign-out scenarios and installed-version compatibility. Obtain authenticated Store dashboard readback of publisher, effective audience and item state before deciding whether any new version is needed.                                                                                                                                                 | Manifest/ZIP/provenance digests, staging manual scenario record, production Panel API contract and compatible installed-version set, Store audience/item readback and fresh install proof. Do not resubmit same-version ZIP blindly. The extension never submits a portal form.                                                                        |
| R8  | [#412](https://github.com/sonny303/mintedpanel/pull/412) privacy scrub and [#351](https://github.com/sonny303/mintedpanel/pull/351) old spike remain open.                                                                                                                                                                                | Rebase/review #412, scan current tree and decide history exposure handling. Trace #351's unique decisions to merged E6.12/E6.13 and #455; carry any missing requirement into its owner PR, then close a superseded draft with a trace comment.                                                                                                                                                                                                       | No exposed current-tree values in docs/tests, explicit history disposition, requirement trace, reviewed PR disposition. Neither PR is a substitute for deployment proof.                                                                                                                                                                               |

## Waves and release stop lines

| Wave         | Entry                                                                                     | Exit                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — platform | Fresh source/ledger/hosted snapshots.                                                     | R1/R2/R3/R4 have reviewable code and exact hosted action packets. A dedicated staging candidate may be built only after the matching database rehearsal and scoped credential proof. |
| 2 — product  | #454, #455, extension and privacy/spike decisions reviewed against Wave 1.                | All desired feature PRs are merged by the PM; exact successful `main` CI SHA is staged and qualified with native synthetic scenarios.                                                |
| Production   | Qualified stage record, independent production baseline and backup, exact release intent. | Single protected Production job performs the approved migration/build/promotion/postchecks. Extension Store submission and acceptance are separately approved and verified.          |

## Hosted action packets to bring back

| Action                                          | Exact evidence required before owner decision                                                                                                                                                                                                                                                                                                         | Mutation and recovery                                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staging database lineage and feature migrations | Project `vmznysvietfaddakkegt`, observed ledger/catalog digest, source SQL hashes, exact reset/reseed or in-place scope, route-specific affected row counts, synthetic fixture plan, service credential destination and denial against production. The completed encrypted capture/restore is baseline evidence, not a staging row-preservation gate. | Apply only the reviewed staging route under delivery lease; stop on any partial failure and reconcile. A reset needs its own exact scope and verification; automatic reverse SQL is not a recovery plan.                       |
| Staging Vercel identity, candidate and aliases  | Team `team_230fpJ9MgCj9ssW3LiIckfyA`, project `prj_1t7NkRJMkjTuFXEBEP4GjfN4B6Ch`, full Preview-variable readback, actual Chrome ID, old alias mapping, no Git connection, admitted source/tree, candidate runtime/DB and browser evidence.                                                                                                            | Change only the approved ID/CORS pair, build protected Preview, move secondary alias then primary. On failure keep the lease and restore captured alias mapping.                                                               |
| Production database and Panel release           | Independent `fkvuhfsqcmujywzgczmc` ledger/catalog/backup/restore proof, exact staging candidate and qualification digest, old/new compatibility, production environment reviewer and immutable release summary.                                                                                                                                       | Execute only inside the single approved Production job, then read back schema, aliases, health and isolation. Hold on mismatch; use captured previous deployment for app rollback while separately reconciling database state. |
| Chrome Web Store publication                    | Exact item/publisher/audience/version, reviewed clean extension source and ZIP hash, staging native PASS, installed-version compatibility and owner-approved release policy.                                                                                                                                                                          | Submit that ZIP to the existing approved item; verify Store acceptance, published version and installation before claiming extension production current.                                                                       |

### First hosted decision: staging encrypted baseline capture

Target **only** `vmznysvietfaddakkegt`. Pre-capture read-only state: 143 ledger
entries; four organizations, zero contracts, 659 portal maps and 90 fill
sessions; eight existing contracting statuses would be updated by #427. The
crosswalk records 120 source SQL hashes, including a duplicate version; no
schema repair is authorized by this capture. Prior September 23 isolated
restore passed for an older staging snapshot, but it cannot stand in for a
fresh baseline. Refresh ledger, catalog and counts before any later staging
schema decision.

The owner-approved first hosted operation used the reviewed
`scripts/recovery/live-backup.mjs capture` path: create a bounded temporary
staging login, take a consistent encrypted age snapshot, and verify that exact
login is removed. The output is local private ciphertext with `CAPTURED_ONLY`
status. That capture was restored into an isolated local database to verify
row/sequence/catalog/ledger integrity. No staging application SQL, Vercel setting,
alias, production resource or Store item changes in this checkpoint. The owner
approved staging capture and isolated restore on September 28; the private age
identity and staging management credential were verified without disclosing
their contents. Capture/restore failure or uncertain temporary-role cleanup
stops the wave for reconciliation.

The September 28 preflight found one pre-existing `cli_login_postgres` role,
expired September 26 at 14:42:45 UTC, with zero active sessions. Its inventory
digest was `1d6cd6736d8066f8c1d95d383c6afcafd3e99a61af40af6205d8c256d6b8a0a7`.
The capture command rejects this nonempty prestate. The owner separately
approved exclusive staging CLI maintenance for the fixed expired-role cleanup
in [`staging-recovery.md`](staging-recovery.md). The operator refreshed inventory
and sessions at action time, then used the fresh digest. The subsequent capture
started only after verified empty inventory.

### Approved staging recovery checkpoint — completed September 28

| Step                               | Exact result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expired-role preflight and cleanup | The sole `cli_login_postgres` role was expired and sessionless; the owner-approved exclusive cleanup verified zero roles at `2026-09-28T23:36:14.091Z`. Provider digest `b7f247b2f9f4d26aa8adff68f135b42d59298cff89ab184e067ab460eebd7590`.                                                                                                                                                                                                                                                                                       |
| Interrupted first capture          | Returned `RECOVERY_BACKUP_REJECTED` after writing encrypted files but without `capture.json`; it supplied no valid backup receipt. Its new, sessionless temporary login was removed through the guarded failed-capture path, with zero roles verified at `2026-09-28T23:41:24.175Z`. That workspace was not restored.                                                                                                                                                                                                             |
| Fresh encrypted capture            | `CAPTURED_ONLY` at `2026-09-28T23:42:59.042Z` from staging `vmznysvietfaddakkegt`; five age artifacts, combined observed artifact digest `8920a5d7c5558ec893f1856317b8e9cec7cb79cdca9ae205c4308a8ac3f4add3`, schema digest `fce311a4389766f67a41f68184912ca4d60ef9eb2311bf0ef989f1a95ab8d71f`, lineage digest `5f1565676af4f133e55deb8cf0141a04315ffe5f9096547037a11f93aa399421`. Exclusive cleanup verified zero roles at `2026-09-28T23:43:05.334Z`; independent inventory was still empty at `2026-09-28T23:56:46.659Z`.       |
| Isolated restore                   | `REHEARSED_ONLY` at `2026-09-28T23:56:24.413Z`, run `b15f6a8cce36b8f4`, capture digest `b915f49239295bbfc579ba46fe29b7e158e43a932af99f21a6c57401c46d7451`. The internal-only ARM64 PostgreSQL 17.6 target had zero published ports. Access, roles, structure, lineage and outbound-isolation comparisons passed; 121 physical tables, 4,697 rows, three sequences, zero sequence drift; data digest `e07e137bfc47a1b55a33163651b67761c8543ae84fb44670f82cb6235a8929e8`. The owned target is retained for reviewed follow-on work. |
| Local Auth/REST boundary           | A separate disposable restore passed 15 login, refresh, identity, negative and cross-tenant probes at `2026-09-29T00:02:15.712Z`, run `e0abaca00a56ad1c`. Its DB/Auth/REST resources were destroyed with zero remaining at `2026-09-29T00:02:16.413Z`. The exact observed `roster_engine_seed_org_templates` trigger was included in fixture-delta proof as six expected new template rows; all other fixture-table triggers remain denied.                                                                                       |

The first restore attempt exposed a local `pg_restore` role switch that blocked
ownership restoration; after correction, the verifier exposed three extension
owner mismatches. Both fixes are in draft PR #459 and were validated against the
sealed capture before the successful receipts above. This checkpoint does not
qualify a production backup or release: `releaseAdmission` remains `BLOCKED`,
`qualifiedRecoveryScopes` is empty, and hosted schema changes, source lineage
reconciliation, complete Storage/Vault recovery proof, deployment and Store
publication retain their later decisions.

The three missing feature SQL files are pinned for the **later, separate**
rehearsal/hosted approval: #427
`57abd0ea67b7fb4e25c953dac578c43d895d251fddd3a4e8e703d3432caf80b3`,
#429 `18311a257c89fd3487805e3f65021dad9ba91432f26357ca70b1f36a742add44`,
and #424/#425
`43ecff4b5d8fb4e475e16e22d50b1501375f068587486645c09b4483a051b9ce`.
Do not apply them until the lineage correction, populated rehearsal and separate
staging database decision are reviewed.

## Current read-only evidence

On 2026-09-28, both Supabase migration ledgers lacked the three R4 versions.
Staging had 143 entries; production had 145, with only the two R1 production-only
versions. Both databases lacked `contracts.tentative_effective_date`,
`contracts.specialty`, `portal_field_maps.learned_via`,
`fill_sessions.event_schema_version` and
`public.learn_portal_field_maps_from_touch`. The Panel release status command
reported six activation blockers, and both migration readiness commands returned
`RECONCILIATION_REQUIRED`. The native E6.14 scale run returned 799,133 bytes and
11,463 ms for one 50-provider page after planner statistics were refreshed;
this is not a p95 or hosted measurement.

The #427 migration would update eight existing contracting status rows and
insert 20 across four staging organizations. In production it would update six
and insert 15 across three organizations. Both databases currently have zero
contract rows. The #429 columns would touch existing `portal_field_maps` tables
with 659 staging and 714 production rows; #424/#425 adds columns/constraints to
`fill_sessions` with 90 staging and 92 production rows. These are read-only
impact counts, not a completed rehearsal. Recount immediately before approval.

The [complete read-only lineage crosswalk](release-packets/2026-09-28/README.md)
binds all 120 source SQL hashes to both hosted ledger lists. Only 18 source
versions match a hosted version exactly; 108 source names match ledger names,
with no SQL-equivalence claim. Twelve source names are absent from each ledger,
and 34 staging / 36 production hosted entries have no source filename suffix.

The body of `public.resolve_enrollment_context(uuid,text,uuid)` has the same
`prosrc` MD5 in both hosted databases (`8c77250cba65fc3e6146b1a6ff0e85c1`),
but staging is `SECURITY DEFINER` and production is `SECURITY INVOKER`. The
committed E6.12 migration specifies invoker. Both targets currently report
`service_role` SELECT access to `auth.users`. The production-only ledger entries
therefore cannot simply be copied to staging; reconcile the exact function
metadata and ledger evidence, then rehearse an invoker correction with its
authorization tests.

The public Chrome Web Store item `dppfnbikpojpgdiobckgcknmkjlfoinh` displayed
version 0.1.3, updated September 28. That matches extension `main`, but is not
proof of installed bytes, API compatibility or restricted audience. The
Developer Dashboard requested account re-verification, so audience/publisher
details are still unobserved. [Extension #72](https://github.com/sonny303/minted-extension/pull/72)
records the two clean local ZIPs and their open native gates.

For #412, a scan of values removed by its diff against every tracked file in
the current PR tree found no residual occurrences of the removed email, three
tax-ID-like tokens, 18 street-address-like tokens or four of five NPI-like
tokens. The fifth NPI-like token appears in 66 files, including an explicitly
named synthetic identity probe and design-system examples. It is a sequential
placeholder with an invalid NPI checksum. The current-tree scrub does not
remove prior Git history.
The historical exposure disposition remains a separate owner decision before
calling the privacy work complete.

## #351 requirement disposition

The open S1/S2/S4 spike predates the merged Enrollment Explorer requirements.
Its client Auth identity plus explicit group grants is implemented by E6.12;
its service-only, published client-safe data boundary is specified by E6.13;
its 50-provider cursor pages and virtualized matrix are in #455/E6.14. The
spike's older 60,000-case benchmark does not certify #455's 120,000-scope SQL.
Its proposed “Ready to bill” business meaning and any broader client-visible
identifier set remain outside this release; they require separate product
requirements before use. Once this trace is reviewed, close #351 as superseded
without merging its stale benchmarks into current release proof.

Use [`staging-delivery.md`](staging-delivery.md),
[`migration-tracking.md`](migration-tracking.md),
[`production-release.md`](production-release.md) and the extension
`docs/release/README.md` for the detailed control contracts. This packet does not
replace their fail-closed gates.

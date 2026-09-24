# Staging alignment 1–5: September 24 rebind

Packet status: **LOCAL_ALIGNMENT_REHEARSED_ONLY**, with the approved four-function
ACL revision and native authorization regression verified on a fresh disposable
restore. Hosted SQL has not run. Release admission remains **BLOCKED**. This is
not hosted or production approval.

## Resolved permission blocker and retained failure evidence

Before the ACL revision, `supabase/tests/capture-boundary-org-security.sql` failed
on the first qualified local rehearsal with four expected-denial assertions.
The extended test also reproduced eight direct-call failures: anonymous and
authenticated calls to both helpers (including the defaulted throttle argument),
and service-role calls to both capture RPCs. Synthetic fixtures rolled back.

Read-only comparison against the untouched baseline established that these
permissions existed before this rebind and survived the original five slices:

| Signature                                          | Surviving unwanted privilege path         | Failed assertion                    |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| `submit_capture(text,jsonb)`                       | Explicit `service_role` EXECUTE           | `acl.service_role_submit_denied`    |
| `validate_capture_token(text)`                     | Explicit `service_role` EXECUTE           | `acl.service_role_validate_denied`  |
| `check_rpc_throttle(text,integer,integer,boolean)` | Both `PUBLIC` and explicit `anon` EXECUTE | `acl.anon_throttle_helper_denied`   |
| `mark_rpc_attempt_valid(text)`                     | Both `PUBLIC` and explicit `anon` EXECUTE | `acl.anon_mark_valid_helper_denied` |

All four functions are owned by `postgres`. The original slice 5 removed `PUBLIC`
from the two capture RPCs but left their explicit `service_role` grants, and did
not reconcile the two throttle-helper ACLs.

The existing native test and the internal-helper revokes in
`20260710130000_public_rpc_rate_limiting.sql` establish the denied-access contract.
Clean-database CI cannot substitute for this populated-staging ACL check.

The owner approved this four-function revision in the same PR:

| Function pair    | Revised boundary                                                   | Preserved behavior                                                         |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Capture RPCs     | Deny `PUBLIC` and `service_role`; allow `anon` and `authenticated` | Existing token, payload, tenant, lock, replay and expiry behavior          |
| Throttle helpers | Deny `PUBLIC`, `anon` and `authenticated`                          | Actual definer-owner execution and the existing service-role helper grants |

The revised slice checks effective privileges, absence of `PUBLIC` grants and
helper execution by existing definer callers' owners. No function body, owner,
signature, security mode, search path, argument default, global default privilege
or role membership changes. The full native regression now passes on fresh run
`1e65c046d5fd0fec`; the failed run `6715aa4a0f245dc4` and its evidence remain intact.

## Requirement and scope

The current approval covers the four-function permission revision, independent
review and local rehearsal. It does not authorize hosted application without the
existing staging write-pause and operator gates. The captured source data is the
same September 24 encrypted capture; this revision creates a new local restore,
not a new hosted capture.

| Requirement                                      | Implementation / evidence                                                                                          | Status                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Use the current reviewed source                  | Base `ae7aff60cac28ee9e2ac5a7a30a8bb7bce6c5c3b`; source migration checksums revalidated                            | Confirmed                                                                  |
| Limit the behavior change                        | Four function ACLs and their postconditions; fresh local bindings                                                  | All 54 public function definitions/owners unchanged; only four ACLs differ |
| Recover the actual staging data                  | Encrypted capture, local Auth/REST qualification and separate baseline/rehearsal restores                          | Confirmed locally; not hosted runtime evidence                             |
| Reject stale source state                        | Read-only comparison of all 92 physical tables, catalog, migration lineage and two sequences                       | Matched at `2026-09-24T15:47:25.261Z`; refresh within the apply window     |
| Apply five slices in the reviewed order          | One persistent local session; five original SERIALIZABLE transactions                                              | All five committed locally                                                 |
| Preserve recovery and avoid duplicate execution  | Untouched baseline retained; committed receipt plus full live poststate digest produces a no-op resume             | Confirmed locally                                                          |
| Exact final-head CI                              | Required on this PR, not inferred from base CI or local tests                                                      | Check PR checks for current result                                         |
| Hosted application write pause                   | Must cover staging testers, imports, integrations and other writers affecting checked dependencies                 | Not established                                                            |
| Hosted operator invocation and executor identity | Independently review pinned connection, durable role, final readbacks and temporary-login cleanup before execution | Not yet verified                                                           |

## Bindings

| Binding                                   | Value                                                              |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Allowed staging project                   | `vmznysvietfaddakkegt`                                             |
| Allowed hosted physical cluster           | `7662742571317219726`                                              |
| Forbidden production project              | `fkvuhfsqcmujywzgczmc`                                             |
| Capture time                              | `2026-09-24T15:25:23.402Z`                                         |
| Capture digest                            | `9cd07f296ce4eab010bfa1391094c02e7299e4edc8872965e0e08b9eefb8e0de` |
| Application-baseline qualification digest | `b4f73c3f4a37d349b4dc886b506e5f0520fa052dcf52ffaf5d80de63a5cfc5df` |
| Qualification receipt ID                  | `b4f73c3f4a37d349`                                                 |
| Untouched baseline run / physical cluster | `775640d53985dcdc` / `7689124825780498471`                         |
| Rehearsal run / physical cluster          | `1e65c046d5fd0fec` / `7689139001490436135`                         |
| Local poststate digest                    | `5092fe820aacb4a2c6c6b631d057f1d67bcc250e393a3a59488ecfc01e8323f3` |

Current private evidence is in `staging-recovery-acl-20260924-vD8bsl` outside Git.
The original capture/readback and failed rehearsal evidence remain in
`staging-recovery-fresh-20260924-4oF4BR`. Do not publish raw data, the age identity,
credentials or decrypted artifacts.

| Private receipt                                           | Meaning                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `application-baseline.json`                               | Qualified pre-alignment local baseline; does not authorize release                                                                     |
| `auth-rest.json`                                          | Local Auth/REST runtime verification and destroyed test resources                                                                      |
| `source-readback-1790264845272.json` (original workspace) | Historical live source comparison; zero drift and zero CLI login roles at observation time; not refreshed for this local-only revision |
| `alignment-slices-1-5-1e65c046d5fd0fec.json`              | Revised five local commits, exact SQL digests and local poststate                                                                      |

The source comparison normalizes only the one captured temporary backup role and
its memberships, after validating its exact capture and cleanup digests. It does
not ignore other roles, memberships, data, sequence movement or schema changes.
Sequence observations remain non-MVCC; a matching readback is not a write pause.

## Local execution and verification

The fixed operator entry is:

```sh
node scripts/release/staging-alignment-rehearse-20260924.mjs
```

It accepts no overrides. On the already completed target it verifies the packet,
qualification, physical identities, preservation hashes and complete poststate,
then returns `SKIPPED / COMMITTED_RECEIPT_AND_LIVE_POSTSTATE_MATCH`. It does not
reapply the SQL. Any partial or uncertain receipt blocks automatic retry.

The source-only readback is:

```sh
node scripts/release/staging-alignment-readback.mjs
```

It uses the pinned staging Management API read-only endpoint. Its sanitized
receipt always retains `eligibleForApply: false` and `releaseAdmission: BLOCKED`.

Fresh verification completed:

- All five revised transaction postconditions passed on the fresh qualified local
  restore, including the declared preservation and effective-ACL checks.
- The native capture regression first reproduced the original four ACL failures
  and eight new direct-call failures, then passed on the revised restore. Valid
  capture, tenant denial, replay and expiry checks also passed.
- All 54 public function definitions/owners match the prior rehearsal. Only the
  four approved ACLs differ; both service-role helper grants remain unchanged.
- A second invocation verified a no-op resume against the live local poststate.
- A read-only recheck of the untouched baseline at `2026-09-24T16:36:25.667Z`
  matched its original restore proof and sealed capture.
- `node --test scripts/release/*.test.mjs`: 97 passed.
- Recovery, delivery and backup unit/contract suites: 634 passed.
- Whole-repository formatting and `git diff --check` passed.
- A fresh independent boundary investigation and separate candidate review
  completed. The candidate reviewer found no blocking bypass or regression;
  executable PostgreSQL evidence was verified separately by the implementation
  owner on the fresh restore.

These checks do not establish all B1–B14 runtime acceptance, hosted Auth/REST/
Storage/vault behavior, or production eligibility. The rehearsal's database role
is not proof of hosted executor privileges or ownership.

## Hosted stop conditions and continuation

Keep the five transaction boundaries and their persistent-session temporary
guards. Do not strip `BEGIN`/`COMMIT`, replace them with a new atomic wrapper, or
claim advisory locks stop application writers. Those changes were not reviewed or
rehearsed as part of this packet.

1. Check green CI on the exact final PR head and independently review the final
   hosted operator invocation. Do not merge merely to run this packet.
2. Establish a bounded staging application write pause and exclusive CLI window.
   The CLI window alone is insufficient. No platform-wide freeze is required.
3. Inside that boundary, refresh provider/physical identity and the complete source
   comparison. Abort on any drift. Do not reset or replay historical migrations.
4. Verify a durable database executor role before DDL, preserving the reviewed
   ownership and ACL contract. Temporary login roles must not own new objects.
5. Apply only the checksummed five files, in order, through one persistent
   session. Retain per-slice outcome evidence and do not auto-resume a partial or
   uncertain hosted outcome.
6. Read back changed definitions, ownership, grants, original-row preservation,
   migration lineage and temporary-login cleanup before closing the window.
7. Keep hosted activation blocked until remaining alignment/runtime gates pass.
   Prepare the production packet separately.

No production SQL, Vercel deployment, environment update, alias change, PR merge,
historical migration rewrite, legacy-column deletion or recovery-target deletion
belongs to this change. The existing five-slice failure policy remains additive
forward correction or separately qualified recovery, not blind destructive undo.

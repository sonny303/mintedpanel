# Staging alignment 1–5: September 24 rebind

Status: **LOCAL_ALIGNMENT_REHEARSED_ONLY**. Hosted SQL has not run. Release
admission remains **BLOCKED**. This is not production approval.

## Requirement and scope

The owner approved rebinding and applying the reviewed first five alignment
slices to **staging only**. This change binds their existing SQL to the current
source and newly qualified recovery capture, verifies source drift, and records
the local rehearsal. It does not replace the original hosted acceptance gates.

| Requirement                                      | Implementation / evidence                                                                                          | Status                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Use the current reviewed source                  | Base `ae7aff60cac28ee9e2ac5a7a30a8bb7bce6c5c3b`; source migration checksums revalidated                            | Confirmed                                                              |
| Keep the reviewed SQL behavior                   | Only declared source SHA, capture digest and physical local restore identifiers changed in the five SQL files      | Confirmed by independent diff review                                   |
| Recover the actual staging data                  | Encrypted capture, local Auth/REST qualification and separate baseline/rehearsal restores                          | Confirmed locally; not hosted runtime evidence                         |
| Reject stale source state                        | Read-only comparison of all 92 physical tables, catalog, migration lineage and two sequences                       | Matched at `2026-09-24T15:47:25.261Z`; refresh within the apply window |
| Apply five slices in the reviewed order          | One persistent local session; five original SERIALIZABLE transactions                                              | All five committed locally                                             |
| Preserve recovery and avoid duplicate execution  | Untouched baseline retained; committed receipt plus full live poststate digest produces a no-op resume             | Confirmed locally                                                      |
| Exact final-head CI                              | Required on this PR, not inferred from base CI or local tests                                                      | Check PR checks for current result                                     |
| Hosted application write pause                   | Must cover staging testers, imports, integrations and other writers affecting checked dependencies                 | Not established                                                        |
| Hosted operator invocation and executor identity | Independently review pinned connection, durable role, final readbacks and temporary-login cleanup before execution | Not yet verified                                                       |

## Bindings

| Binding                                   | Value                                                              |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Allowed staging project                   | `vmznysvietfaddakkegt`                                             |
| Allowed hosted physical cluster           | `7662742571317219726`                                              |
| Forbidden production project              | `fkvuhfsqcmujywzgczmc`                                             |
| Capture time                              | `2026-09-24T15:25:23.402Z`                                         |
| Capture digest                            | `9cd07f296ce4eab010bfa1391094c02e7299e4edc8872965e0e08b9eefb8e0de` |
| Application-baseline qualification digest | `d0171353c3a1c18a832f8b81b639d79d13f210f9a3c34095d8d7b9488c84506b` |
| Qualification receipt ID                  | `d0171353c3a1c18a`                                                 |
| Untouched baseline run / physical cluster | `775640d53985dcdc` / `7689124825780498471`                         |
| Rehearsal run / physical cluster          | `6715aa4a0f245dc4` / `7689124870789845031`                         |
| Local poststate digest                    | `e81470e56069901627d8ef272cdd6e90d4ff7b692f03ffaf0566a97ec2e488f0` |

Private evidence remains in `staging-recovery-fresh-20260924-4oF4BR` outside
Git. Do not publish raw data, the age identity, credentials or decrypted artifacts.

| Private receipt                              | Meaning                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `application-baseline.json`                  | Qualified pre-alignment local baseline; does not authorize release                   |
| `auth-rest.json`                             | Local Auth/REST runtime verification and destroyed test resources                    |
| `source-readback-1790264845272.json`         | Full live source comparison; zero drift and zero CLI login roles at observation time |
| `alignment-slices-1-5-6715aa4a0f245dc4.json` | All five local commits, exact SQL digests and local poststate                        |

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

- All five original transaction postconditions passed on the qualified local
  restore, including the declared preservation and effective-ACL checks.
- A second invocation verified a no-op resume against the live local poststate.
- A read-only recheck of the untouched baseline at `2026-09-24T15:58:31.407Z`
  matched its original restore proof and sealed capture.
- `node --test scripts/release/*.test.mjs`: 96 passed.
- Recovery, delivery and backup unit/contract suites: 634 passed.
- Whole-repository formatting and `git diff --check` passed.
- Independent review approved the rebinding delta and local-only result.

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

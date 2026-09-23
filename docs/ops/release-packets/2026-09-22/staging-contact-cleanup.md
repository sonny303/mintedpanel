# AUD-07 — bounded staging contact cleanup

Requirement and PR trail: **AUD-02 / AUD-07, PR #396**. Source baseline
`94b586f20162fe38982f7a478eb4216e3897b3aa`. This packet implements the owner's
instruction to remove the five identified staging contacts. The separate choice
for the two case/facility exceptions remains pending; this operation never deletes
or changes a case, provider or facility. Production writes and promotion remain held.

## Exact approved scope

| Item                     | Measured effect                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `parties`                | Delete exactly 5 identified rows; preserve the other 17                                                         |
| `party_role_assignments` | Existing FK cascades delete exactly 3 identified rows; preserve the other 17                                    |
| `party_capture_links`    | Existing FK cascades delete exactly 4 identified rows; preserve the other 1                                     |
| `audit_log`              | Append exactly 6 known UUID rows, one for each existing party/organization context; preserve every original row |
| Everything else          | No DML; compare all other public table rowsets before/after in the same transaction                             |

The dependency preflight at **2026-09-23 04:32:54 UTC** found only the two
`ON DELETE CASCADE` FKs above, and no descendants of either child table. The sole
noninternal contact trigger is `party_role_assignments_active_role`, a
`BEFORE INSERT OR UPDATE` check; its exact function fingerprint is pinned. No
contact or audit rewrite rules and no audit triggers were present. No contact
delete path touches Auth, Vault or Storage. The read-only inspection found seven
existing assignment/link references representing six distinct party/org pairs;
these provide real audit org context for all five contacts. No organization or
assignment is invented from a creator's memberships.

## Implementation and stop conditions

The [fixed-scope SQL builder](../../../../scripts/release/staging-contact-cleanup.mjs)
has no database connection, filesystem mutation, or execution CLI. It accepts a
closed private manifest containing only IDs, timestamps and fingerprints. Tests
use synthetic UUIDs. The generated mutation is private and never belongs in Git.

| Guard              | Behavior                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Target             | Hosted mode requires database `postgres` and the exact staging cluster; local modes reject both known hosted cluster identities       |
| Concurrency        | Serializable transaction; 5-second lock timeout; 30-second statement/idle timeouts; bounded write locks on all four touched tables    |
| Drift              | Exact target hashes, all dependent IDs/relations, unaffected rowset hashes and original audit hashes must match the measured manifest |
| Unexpected effects | Abort if incoming FK closure, trigger definition/enablement, or rewrite rules differ                                                  |
| Audit              | Six fixed UUIDs, exact run marker, manifest hash, approved party/org pairs, and static description; no guessed app user identity      |
| Preservation       | Existing audit rows, non-target contacts/dependencies, six named protected tables and every other public table remain unchanged       |
| Retry              | Prestate/marker checks fail on reuse; never automatically retry a write with a missing or uncertain response                          |

Operator identity and the owner's authorization belong in the private maintenance
receipt. Audit `user_id`/`user_name` are NULL because this is an operator action,
not an authenticated application-user session. Audit payloads contain IDs and the
cleanup receipt markers, not contact names or other personal fields.

## Recovery evidence

The second isolated restore was verified at **04:34:53 UTC**: 92 physical tables,
2,034 original rows, two sequences, zero measured sequence drift. Rehearsals used
only this owned target, run `f4a0e042347029a4`, PostgreSQL 17.6. Fresh inspection
confirmed the fixed local Docker socket, pinned image, matching ownership labels,
one-container internal network, zero exposed ports and zero host bind mounts.
The first verified baseline was left untouched.

| Evidence                                               | Result                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Eight focused builder/inspection tests                 | PASS                                                                                                                                       |
| Exact deletion plus transaction rollback, 04:47:09 UTC | PASS; exactly 5/3/4 removed and six audits appended inside the rolled-back transaction                                                     |
| Exact deletion plus reinsert recovery, 04:47:22 UTC    | PASS; all 12 original rows restored with matching hashes; six allowed audit rows retained                                                  |
| Independent local postcommit read, 04:49:27 UTC        | All target and non-target hashes match; all six protected table hashes match; original audits match; exact six new audit IDs/content match |
| Hosted staging read-only state, 04:50:40 UTC           | `NOT_APPLIED`; 5/3/4 target rows intact, no run marker/audit IDs present, all preservation hashes match                                    |

Restoration payloads existed only in transaction-local JSON variables. No plaintext
person records were saved to disk or emitted in logs. The local recovery rehearsal
intentionally retains its six new audit rows and is not a pristine baseline.
Its recovered state would classify `INCONSISTENT` under the hosted cleanup-state
classifier because hosted success requires target absence; this is expected for
the isolated recovery test.

This proves the bounded contact DML and its recovery on the restored public data.
It does **not** clear the wider G0 recovery/release gates, Auth/REST/installed-client
qualification, source/catalog reconciliation, or production promotion.

## Private artifact binding and execution handoff

All private artifacts reside outside Git under
`/Users/ar/Codex-Minted/context/deployment-audit-2026-09-22/`, mode `0600`:

| File                                                     | Purpose                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `contact-cleanup-manifest.private.json`                  | Exact approved IDs, prestate fingerprints, seven real org contexts, six fixed audit UUIDs |
| `contact-cleanup-hosted.private.sql`                     | Single guarded staging transaction                                                        |
| `contact-cleanup-poststate.private.sql`                  | Read-only aggregate classification after success, error, or uncertain response            |
| `contact-cleanup-rehearse-rollback-receipt.private.json` | Local rollback evidence                                                                   |
| `contact-cleanup-rehearse-restore-receipt.private.json`  | Local restoration evidence                                                                |
| `contact-cleanup-inspect-local-receipt.private.json`     | Independent local postcommit aggregate evidence                                           |

Manifest SHA-256: `7a6ef1a046ae49d1504992d52814cb9bb3d53cfcda12e6c39cc788753d1c628c`.
Hosted SQL SHA-256: `b40b27a899b17f4e3d8137994ccf5480f0a4fa573a11e2e52ab527688558297c`.

1. Root/operator confirms the independent builder review, scoped recovery proof,
   unchanged exact hashes, and staging maintenance authority. No additional scope
   or case action is implied.
2. Run the exact staged transaction once. On any unexpected error, abort; do not
   broaden predicates, invent dependencies, disable triggers or recapture hashes
   merely to make the operation pass.
3. Run the private read-only poststate query. `APPLIED` requires 0/0/0 targets,
   exactly six known audits with exact content, and every preservation check true.
   `NOT_APPLIED` requires original 5/3/4 hashes, zero known audit rows/marker, and
   preservation checks true. Any mixed result is `INCONSISTENT`: stop and inspect.
4. If the write response is missing, classify state **before any further write**.
   `APPLIED` means do not replay. `NOT_APPLIED` is evidence for a reviewed decision,
   not permission for an automatic retry. Record the receipt in the PR trail.
5. Refresh contact alignment preflight. Continue the separately reviewed additive
   schema plan only after its own gates; keep the two case/facility exceptions held.

At this packet's preparation time, **no hosted cleanup mutation has been run**.

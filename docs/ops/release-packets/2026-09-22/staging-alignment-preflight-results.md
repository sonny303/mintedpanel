# Staging alignment preflight — measured results

Measured **2026-09-23 04:24:40 UTC**, project `vmznysvietfaddakkegt` only.
Source baseline: `43b59cfa95c84a929c452cc097453c802bbef50b`.

The [read-only aggregate query](staging-alignment-preflight.sql) ran successfully
through the fixed staging Supabase connector. Its cluster identity guard passed.
Running that same query on staging with an intentionally wrong expected identity
returned SQLSTATE `22012` and no aggregate result. No application RPC, DDL, DML,
seed, production query or record modification occurred.

SQL SHA-256: `668fa2845601188f399ba91fb3932be7a1db26cf433d4727677e5f245d8437d7`.
The complete aggregate output is [preserved as JSON](staging-alignment-preflight-results.json).
This evidence supplements [the alignment plan](staging-alignment-plan.md);
it does not qualify the pending restore or authorize an ambiguous data mapping.

## Concrete exceptions

| Slice                        | Measured exception                                                                                                                                                                                                                              | Safe disposition                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B8 contact tenancy           | **5 of 22 parties lack an unambiguous single organization**: one has existing role assignments in multiple organizations; four have no assignments and a creator with multiple organization memberships. The other 17 resolve from assignments. | **Block contact ownership/NOT NULL/RLS and dependent contact RPC activation.** Preserve all five parties and their relationships. Do not choose the earliest org or delete the four unassigned records. Owner-reviewed ID mappings or an approved split/relink are required.                                  |
| B5 case/facility eligibility | **2 of 61 explicitly selected case facilities lack a matching provider-facility assignment.** Both still match the case's org and group; no explicit facility is missing or inactive.                                                           | Preserve the exact selected facility and case. Hold these two records out of eligibility qualification; do not substitute another facility or invent an assignment. Case-to-facility carry-forward itself remains deterministic, but acceptance cannot call these two eligible without a reviewed resolution. |
| B13 online-form data fields  | One global template has six data fields, **all without a portal key**. Zero fields can be inserted into the registry.                                                                                                                           | Do not guess a portal. Preserve the JSON. Historical SQL would append one content-identical version snapshot and insert zero maps; explicitly defer this ineffective data transfer until the missing portal context is resolved. Other registry schema/order work is independent.                             |
| B2 effective dates           | Nine approved cases have no confirmed date; none has a matching contract effective date.                                                                                                                                                        | **Backfill is a no-op (0 rows)**. Preserve NULL; no inferred date and no data deletion. This is existing incompleteness, not an ambiguous join or a reason to manufacture test data.                                                                                                                          |

The private ID-only exception inventory is outside the repository at
`/Users/ar/Codex-Minted/context/deployment-audit-2026-09-22/staging-alignment-exceptions-2026-09-23.json`
(mode `0600`). It contains the five party IDs with candidate organization IDs and
basis, plus the two case/provider/current-facility IDs. It contains no names,
emails, addresses or secret values. **Do not commit it or copy it into a PR.**

## Passing prerequisites and measured no-ops

| Check                         | Result                                                                                                                | Planned effect after restore/rehearsal gates pass                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 legacy status mapping      | 65 cases; 0 unknown labels/pipelines; 0 missing status references; canonical column absent                            | Map 32 submitted, 14 approved, 12 not started, 3 in progress, 2 not pursuing, 1 in review, 1 denied. No case changes outside the explicit mapping.                           |
| B2 contract matching          | 0 multiple matches, 0 conflicting dates, 0 eligible date fills                                                        | Preserve all dates, including the nine missing values.                                                                                                                       |
| B3 initial status history     | Table absent                                                                                                          | 65 initial system rows, retaining legacy history.                                                                                                                            |
| B4 case numbers               | 65 missing; 0 existing/duplicates; sequence absent                                                                    | Stable `(created_at,id)` assignment 1001–1065 on this unchanged baseline; refresh before apply.                                                                              |
| B5 facility carry-forward     | 61 explicit, 4 NULL; 0 wrong-org/group references                                                                     | Preserve all 61 exact selections and four NULLs. Two eligibility exceptions remain held as above.                                                                            |
| B6 document version backfill  | **0 document rows**; every document-kind/date/family/version/owner check is zero                                      | Metadata backfill is a no-op; schema and Storage qualification still required.                                                                                               |
| B7 payer backfill             | 287 payers; 0 normalized-name duplicates; 0 unknown kind/status/source; 0 legacy provider-ID pairs eligible           | Fill missing source with `sync` on 287 existing rows. ID-pair backfill is a no-op; preserve all payer identities.                                                            |
| B9 role defaults              | 20 role grains, 20 missing defaults, 0 duplicates, 0 unknown scopes; 3 reserved roles inactive                        | Deterministic defaults exist, but keep this contact compatibility group held with B8 rather than expose partial tenancy behavior.                                            |
| B10 insurance coverage        | 2 policies; 0 multiple-policy grains; 0 proposed-primary conflicts                                                    | Both can retain their existing effective primary meaning. No policy-selection decision needed.                                                                               |
| B11 field registry            | 25 maps, 25 missing sort orders; 0 shared/org selector duplicates; 0 global portal-key duplicates                     | Deterministic tier-separated sort-order backfill; preserve trained content.                                                                                                  |
| B12 SOP states                | 22 templates; 13 scalar-to-array fills; 9 NULLs preserved; 0 invalid shapes/active overlaps                           | Apply the known state values only; keep fallback NULLs and scalar mirror.                                                                                                    |
| B13 registry collision checks | 0 org-owned affected templates, 0 would-be shared private fields, 0 version/selector collisions                       | No privacy/collision blocker in this snapshot. Missing portal context still prevents the six-field transfer.                                                                 |
| B14 schema/environment        | Eight required tables absent; 53 public tables, 647 columns; 15 orgs, 6 Auth users, 22 memberships; 0 buckets/objects | Add approved schema/resources without copying production or replacing legacy UAT. Preserve existing Auth/org relationships.                                                  |
| Crypto prerequisite           | `pgcrypto` present in `extensions`; `vault.secrets` relation present                                                  | Extension/relation preconditions pass. This query does **not** read or prove a usable staging vault key. Provision/verify independently through the protected operator path. |
| Profile names                 | All three new split/title columns absent                                                                              | Add NULL fields. No name-splitting backfill for profiles.                                                                                                                    |

## Existing repairs remain present

| Object/invariant                     | Measured result                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `commit_import_run(uuid,jsonb)`      | Definition MD5 `403f18ff69cf60ebb0f438d2e866135a`; SECURITY DEFINER; authenticated execute true, anon false. Preserve unchanged. |
| `delete_case(uuid,uuid)`             | Definition MD5 `7d83b12c95f0d6ed5f8fd42ca342b685`; SECURITY DEFINER; authenticated execute true, anon false. Preserve unchanged. |
| Generated-case validator             | INSERT-only trigger present and enabled; function MD5 `49c3c1d22754e212d6f4f6208fea8f0e`.                                        |
| Generated-case FK/check              | FK uses `ON DELETE SET NULL`; old created-case CHECK absent.                                                                     |
| Target import/disposition vocabulary | 0 invalid import kinds; 0 invalid dispositions; 0 missing required reasons.                                                      |

The trigger function's recorded anon EXECUTE grant is metadata, not proof that a
trigger function can be invoked as an ordinary RPC. This preflight preserves the
existing definition and makes no privilege change.

Aggregate rowset fingerprints were captured for cases (65), parties (22), role
assignments (20), provider-facility assignments (19), provider-group assignments
(3), documents (0), SOP templates (22) and versions (22). These are drift markers
in the JSON output, not proof that all relationships are correct. Planned backfills
need column-specific before/after preservation checks on the qualified restore.

## Execution boundary

Unaffected schema/backfill work can proceed through the separately required
restore, reviewed-delta and rehearsal gates. Contact tenancy, the two facility
eligibility exceptions and the six fields without portal context remain explicit
partial-qualification items. The owner decision about affected slices is tracked
by the coordinating task; this document does not record an answer or approval.

Refresh these aggregates before hosted apply. Counts alone do not replace
Auth/RLS/Storage behavior, real CSV/delete tests, source/deployment binding,
installed-extension acceptance or the full schema/ACL inventory. Production
remains unchanged and receives none of these UAT/staging records.

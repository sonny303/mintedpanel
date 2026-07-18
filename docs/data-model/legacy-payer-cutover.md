# Legacy Org-Scoped Payer Cutover — Inventory & Result Record

> **Status: CLOSED — SUPERSEDED BY THE PRE-PROD-CUT DATA WIPE (2026-07-18).**
> The per-row re-keying this record was staged for never ran and never will:
> the PM-approved full data wipe (2026-07-17, the AGENTS.md carve-out —
> `docs/ops/full-wipe-all-orgs.sql`, PLAN-full-data-wipe.md) removed every org
> below along with its payers, cases, and contracts. The pre-wipe database is
> preserved in the `mintedpanel-backup-july17` Supabase project. Verified live
> 2026-07-18: `payers` holds 269 rows, ALL global (`org_id IS NULL`, all
> slugged) — zero org-scoped rows, zero "Pre-Credentialing Setup" sentinels,
> and no dangling payer references anywhere. See "Final result" at the bottom;
> the inventory below is retained as the historical record of what the wipe
> superseded.

Inventoried 2026-07-16 against hosted project `fkvuhfsqcmujywzgczmc` (the
shared demo/dev database — see the production-data caveat in
[payer-field-usage-audit.md](./payer-field-usage-audit.md); re-run against the
real customer database before any cutover decision).

## Why these rows exist

Before the E1.6 global catalog, every payer was an org-scoped `payers` row
created free-text from Admin → Payers. The E4.2 governance PR removed that
creation path (canonical identities are selected from the catalog, never
typed), so the remaining org-scoped rows are a closed legacy set. They render
read-only ("Legacy — catalog migration required") until each is re-keyed to
its canonical catalog identity.

## Cutover rules (locked)

1. **Re-key before removal.** Every referencing row (cases, contracts, routing
   rules, SOP templates, targets, assignments, run rows, exclusions,
   communication events, portals) must be repointed to the canonical payer id
   before the legacy identity row can be removed.
2. **Matching is proposed, never applied automatically.** Candidates below were
   derived by canonical slug (all legacy rows have `payer_slug NULL`, so slug
   never matched), exact normalized name, and exact alias match — a human
   confirms every mapping. The pure helper `src/lib/payerCutover.ts`
   (`canonicalMatchCandidates`) implements exactly this exact-match proposal
   logic (no fuzzy auto-match) and is unit-tested.
3. **Delete only zero-reference rows that do not represent current work**, and
   record the result here. `src/lib/payerCutover.ts` (`canDeleteLegacyPayer`)
   is the tested predicate: any reference count > 0 blocks deletion, and the
   **"Pre-Credentialing Setup" sentinel is never deletable or re-keyable** — it
   is a workflow sentinel matched by name (`PRE_CRED_PAYER_NAME`), not a payer
   identity.
4. **No canonical match ⇒ platform creates the canonical payer first** through
   the separately roadmapped catalog-admin workflow (R7), then re-key. Never
   promote a legacy org row to global in place from the org app.
5. No org-user delete action ships. Cutover runs as supervised platform work
   (service-role tooling), one org at a time.

## Inventory (2026-07-16) — 18 legacy org-scoped rows, ALL referenced

Reference columns are live FK counts (every table with an FK to `payers`,
enumerated from `pg_constraint`): cases = `credential_cases`, ctr =
`contracts`, mso = `mso_routing_rules`, sop = `sop_templates`, tgt =
`payer_network_targets`, asn = `org_payer_assignments`, gen =
`case_generation_exclusions` + `case_generation_run_rows`, com =
`communication_event`, ptl = `portals`, self = `payers.merged_into_id`
(`prerequisite_payer_id` was dropped by the pre-GA cleanup). `payer_slug` is
NULL on every legacy row.

| Org                        | Legacy payer                        | cases | ctr | mso | sop | tgt | asn | gen | com | ptl | Canonical candidate(s) [slug]                                                                            | Result      |
| -------------------------- | ----------------------------------- | ----- | --- | --- | --- | --- | --- | --- | --- | --- | -------------------------------------------------------------------------------------------------------- | ----------- |
| Dillon Sports Medicine     | Blue Cross and Blue Shield of Texas | 2     | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | Blue Cross and Blue Shield of Texas (HCSC) [blue-cross-and-blue-shield-of-texas]                         | **pending** |
| Dillon Sports Medicine     | UnitedHealthcare TX                 | 2     | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | none exact — human to map (likely UnitedHealthcare [unitedhealthcare])                                   | **pending** |
| Kansas Fitness Physio      | Aetna                               | 7     | 1   | 0   | 1   | 0   | 0   | 0   | 2   | 0   | Aetna (CVS Health) [aetna]                                                                               | **pending** |
| Kansas Fitness Physio      | BCBS of Kansas                      | 5     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 1   | Blue Cross and Blue Shield of Kansas [blue-cross-and-blue-shield-of-kansas]                              | **pending** |
| Kansas Fitness Physio      | Blue KC                             | 6     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | Blue Cross and Blue Shield of Kansas City (Blue KC) [blue-cross-and-blue-shield-of-kansas-city]          | **pending** |
| Kansas Fitness Physio      | Cigna                               | 6     | 1   | 1   | 1   | 0   | 0   | 0   | 1   | 0   | Cigna Healthcare [cigna-healthcare]                                                                      | **pending** |
| Kansas Fitness Physio      | Humana                              | 6     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | Humana [humana]                                                                                          | **pending** |
| Kansas Fitness Physio      | Medicare                            | 6     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | none exact — Medicare is the universal implicit payer (medicare_macs dataset); needs a platform decision | **pending** |
| Kansas Fitness Physio      | Pre-Credentialing Setup             | 6     | 0   | 0   | 2   | 0   | 0   | 0   | 0   | 0   | **NONE — workflow sentinel, never re-keyed or deleted**                                                  | **retain**  |
| Kansas Fitness Physio      | UnitedHealthcare                    | 6     | 0   | 1   | 1   | 0   | 0   | 0   | 0   | 0   | UnitedHealthcare [unitedhealthcare]                                                                      | **pending** |
| South Park Physician Group | Aetna                               | 1     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | Aetna (CVS Health) [aetna]                                                                               | **pending** |
| South Park Physician Group | Anthem BCBS of Colorado             | 2     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | Anthem Blue Cross and Blue Shield of Colorado (Elevance) [anthem-blue-cross-and-blue-shield-of-colorado] | **pending** |
| South Park Physician Group | Cigna                               | 2     | 1   | 1   | 1   | 0   | 0   | 0   | 0   | 0   | Cigna Healthcare [cigna-healthcare]                                                                      | **pending** |
| South Park Physician Group | Humana                              | 1     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | Humana [humana]                                                                                          | **pending** |
| South Park Physician Group | Medicare                            | 1     | 0   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | none exact — see Kansas Medicare row                                                                     | **pending** |
| South Park Physician Group | Pre-Credentialing Setup             | 4     | 0   | 0   | 2   | 0   | 0   | 0   | 0   | 0   | **NONE — workflow sentinel, never re-keyed or deleted**                                                  | **retain**  |
| South Park Physician Group | Rocky Mountain Health Plans         | 0     | 1   | 0   | 1   | 0   | 0   | 0   | 0   | 0   | Rocky Mountain Health Plans (UnitedHealthcare) [rocky-mountain-health-plans]                             | **pending** |
| South Park Physician Group | UnitedHealthcare                    | 2     | 1   | 1   | 1   | 0   | 0   | 0   | 0   | 0   | UnitedHealthcare [unitedhealthcare]                                                                      | **pending** |

## Cutover result (recorded per the PR requirement)

- **Zero-reference deletions performed: none — no row qualified.** Every one of
  the 18 legacy rows carries at least one reference (the minimum is Rocky
  Mountain Health Plans at 2: one contract + one SOP template), so the
  zero-reference deletion clause was vacuous on this database.
- **Re-keying performed: none.** Re-keying requires the human-confirmed mapping
  above plus a supervised service-role run (per-org transaction: repoint FKs →
  verify counts → remove the identity row → audit). That run is a separate,
  platform-executed step outside this PR.
- Until that run completes, the legacy rows render read-only in Admin → Payers
  with the "Legacy — catalog migration required" state, and no new org-scoped
  payer rows can be created (the free-text creation path was removed).

## Ambiguities requiring a human decision

- **"Medicare" (both demo orgs):** the commercial catalog has no Medicare
  entity — Medicare is a universal implicit payer (see
  `docs/redesign/data/payer-catalog/medicare_macs.csv`). Decide whether cutover
  waits for the R10 government-payer model or a canonical Medicare row is
  created ahead of it. The fuzzy hit "Great Plains Medicare Advantage" is NOT a
  match (different entity); exact-match proposal logic deliberately excludes it.
- **"UnitedHealthcare TX" (Dillon):** no exact name/alias match. Probably the
  national UnitedHealthcare [unitedhealthcare] with state scoping now carried
  by `payer_network_targets` — human to confirm.
- **"Cigna"/"Humana" alias collisions:** exact alias matching also surfaced
  Allegiance (Cigna) and TRICARE East (Humana Military) in the broad sweep;
  the exact-normalized-name candidates listed above are the plausible targets,
  but sign-off is per-row.

## Final result (2026-07-18) — closed as superseded

- **The cutover never ran.** No row above was re-keyed or individually
  deleted. The PM-approved pre-prod-cut data wipe (2026-07-17) removed the
  demo orgs wholesale — legacy payers, their referencing cases/contracts/SOPs,
  and both Pre-Credentialing Setup sentinels went with their orgs. The
  pre-wipe database survives in the `mintedpanel-backup-july17` project.
- **The legacy machinery was removed from the codebase the next day** (the
  legacy-payer deprecation change, 2026-07-18): `src/lib/payerCutover.ts` (+
  test) deleted; the `source: "legacy"` / `migrate_legacy` paths dropped from
  `payerSetup.ts` / `PayerSetupList.tsx`; the own-org inclusion shortcut
  dropped from `ManualCaseModal`; `updatePayer`/`PayerInput`/
  `GlobalPayerUpdateError`/`useUpdatePayer` deleted (their only reachable
  subject was a legacy row).
- **The DB now enforces what the app already assumed:** migration
  `20260718120000_payers_org_write_lockdown.sql` (repo + hosted) dropped the
  `payers_insert`/`payers_update` policies and revoked org INSERT/UPDATE
  grants — the last channel that could have minted an org-scoped payer row
  (a hand-crafted PostgREST call). `payers` is member-SELECT-only; catalog
  writes remain service-role (sync script / review RPC).
- **Deliberately untouched:** the "Pre-Credentialing Setup" sentinel WORKFLOW
  code (`PRE_CRED_PAYER_NAME` branches in clientProgress/launchReadiness/
  CreateCasesDialog/work views/payerSetup exclusion) stays — it is a product
  concept, currently unreachable because no creatable payer carries that name,
  retired only by an explicit product decision. Local seed fixtures
  (`seed.sql`, `seed-redesign.sql`) still create org-scoped payer rows for
  local rebuilds/e2e; they never run on hosted.

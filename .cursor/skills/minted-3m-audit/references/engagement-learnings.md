# Engagement learnings (capture from 3M thread)

Lessons that repeatedly bit us. Encode into recommendations and PR review.

## Process

1. **Execute, don’t chore-list.** PM asked agents to do the work; chat dumps of “please tick boxes” were rejected.
2. **One decision surface.** Bundle related product forks into one PM reply block (A/B/C) **with code evidence**, then implement. Don’t reopen after sign-off without new evidence.
3. **Draft PRs early; merge is human (default).** Self-merge only when PM explicitly requests.
4. **Slice close ≠ system optimized.** After a tranche merges, rescore; don’t treat engagement closure as architecture health.
5. **UAT is hosted.** Local green does not clear ops. **Hosted ≠ merged.**
6. **Cross-repo sync.** Panel skill/docs that affect extension need a twin PR (`minted-extension` skill pack identical).
7. **Cadence over severity.** Daily provider→cases before once-per-payer Train. TRAIN-DUAL build before GEN-SILENT was a discipline miss even when the fix was correct.
8. **Name coverage honestly.** Source-grep harness asserts are tripwires (TD-51), not click simulation — same failure class as `submissionTouches`.

## Product / architecture decisions that stuck

| ID        | Decision                                                              | Implication                                                            |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| D1=B      | Slice 0–1 first                                                       | Sequencing: truth → UX empty states → orphans → watch → env → platform |
| D2        | Slice 6 = platform/org overhaul                                       | Not audit-docs-only                                                    |
| D3        | F24 portal filter into Slice 6                                        | Shipped as `portalVisibility` + list filters                           |
| D4        | Skip Postman (#265)                                                   | Extension door stays extension-only                                    |
| D6.1–D6.7 | Spike then build                                                      | Assignment RPC, SOP RLS, archive filter, authoring payers              |
| Sign-offs | Keep `archived_at`; D6.5 = all global SOPs; keep `useAuthoringPayers` | Do not “fix” these without PM                                          |

## Corrected payer-setup + residual locks (2026-08-10)

Do **not** paste a full 3M audit into handoffs; bind this skill and cite paths.

| Lock | Status | Implication |
| ---- | ------ | ----------- |
| **Ready = checklist SOP** | #277 merged | Portal train/prove/drift = badges, not Ready gate |
| **Attach: defaults only** | #277 merged | Do not reverse E6.2 |
| **`org_payer_assignments` table** | **R1 B locked** | Retire **as a gate** only; rows dormant; never DROP. Work: **OPA-RETIRE** (not Slice 3). Not a generation candidacy input |
| **Catalog DELETE** | #275 code | Hosted = second PM sign-off (OPS-PURGE) |
| **`create_payer` 10-arg** | #274 | No resurrect `p_assign_to_org` |
| **SOP All-states + D3.3-G** | #280 | Owns the name **Slice 3**; do not reuse for OPA-RETIRE |
| **GEN-SILENT** | **R2 locked** / #284 | Daily-loop: explain `no_facility` + `pending_verification` skips |
| **TRAIN-DUAL** | Spike #281 + build #40 | URL bind; C1 copy; once-per-payer; TD-51 open |
| **LISTPORTALS** | #282 | Browser `listPortals` = D6.4 |
| **3M Slice 5** | closed | TD-41/49/50 park — ≠ GEN-SILENT |

## TRAIN-DUAL lessons (code-verified)

- Happy path: dropdown navigates; URL recognition sets capture pointer — **two jobs, not redundant**.
- Real defect: login/SSO/wizard paths that don’t prefix-match → wipe + false “New form … Form 2”.
- `matchPortalByUrl` ignores query/hash; `payerName` is candidate-name only.
- Reject automatic selection-wins / wire-key=dropdown (shared-library poison).
- Extract pure helpers under `src/shared/`; `main.ts` has zero tests — click path needs TD-51/TD-50, not tripwire-as-done.

## Slice 3 review + lessons (2026-08-10)

**What shipped well:** US/AC before code; no migration for `'All'`; D3.3-G tests pinned E4.2 break; cherry-pick kept e2e green.

**What we got wrong first:** “org beats global” — grain is payer × group × state; PM → D3.3-G.

**Process:** ask “what is the case key?” before coding; explicit PM flip when tests must break; don’t leave build PR red for unrelated failures.

## Findings that looked fixed but weren’t (mura traps)

- Open Cases = `case_status` — do not regress.
- Portals empty registry UX shipped; **LISTPORTALS** was remaining browser/API D6.4 drift.
- Reporting route redirect ≠ orphan `components/reports/*` cleanup.
- F13 Vite env ≠ CORS/manifest rest.
- F23/F24 closed in Slice 6; Slice 4 audit markdown is historical.
- Global payer pile on hosted ≠ code bug until OPS-PURGE apply.
- `pickTemplate` E4.2 prose in SCHEMA/CLAUDE = DOC-PICK.
- Harness “wiring covered” via `toContain` = **not** covered (TD-51).

## Failure modes to anticipate

- Regenerating `types.ts` before applying migrations.
- Agents editing old migrations or proposing DROP of assignments — reject.
- Authoring UI using ops `listPayers` → empty dropdown.
- Extension fill / panel pickers disagreeing on ghost portals.
- Naming OPA-RETIRE “Slice 3” or GEN-SILENT “Slice 5”.
- Building Train while daily-loop R2 is open without PM re-order.

## Communication preferences (PM)

- Bite-sized recommendations; large features → numbered sub-slices.
- Prefer merged outcome + next decision over long status essays.
- Reply blocks include **evidence lines** from code.
- Review/merge for PM — label hosted chores **ops residual**.

## Skill maintenance

- Canonical pack: `.cursor/skills/minted-3m-audit/` in **both** repos (byte-identical references).
- After material decisions: update `next-agent-context.md`, `engagement-learnings.md`, `known-debt-map.md` in the same PR.
- Re-run audits from code; this file is not a live AC list.

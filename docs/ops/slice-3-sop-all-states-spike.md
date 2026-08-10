# Slice 3 spike — SOP All-states / multi-state match

**Status:** spike complete (2026-08-10) — **ready for build after PM ack of §Locked
decisions** (D3.1–D3.7). No product code in this PR.  
**Branch / PR:** `cursor/3m-slice-3-sop-all-states-spike-3a65`  
**Lane:** corrected 3M payer-setup plan. Skill: `.cursor/skills/minted-3m-audit/`
(PR #273).  
**Base:** `main` after #274 / #275 / #277 merged.

Companion: [`repo-workflow.md`](./repo-workflow.md) ·
[`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md) (different Slice 6) ·
`TECH-DEBT.md` **TD-47**.

---

## Do not confuse two “Slice 3” names

| Name | Meaning | Status |
| --- | --- | --- |
| **This spike** — SOP All-states | One payer checklist covers every case state without N template clones | **In scope** |
| **#274 prose** — “Slice 3 = drop `org_payer_assignments` gate” | Adoption-layer rewrite implied while fixing `create_payer` | **Out of scope / locked closed** — keep `org_payer_assignments` unless PM reopens |

Also **do not reopen** Ready (#277), attach defaults (#277), or catalog purge DELETE
(#275 — second PM sign-off still required before hosted apply). Slice 5 stays out
unless asked.

---

## Problem (code-verified)

Operators want to author a payer’s process **once**. Cases are still stamped with a
concrete `^[A-Z]{2}$` state. Today a template’s match key is a **single exact
state**, so a multi-state payer either:

1. duplicates the same SOP per state, or
2. silently resolves the **generic fallback** for every uncovered state.

| Evidence | Path |
| --- | --- |
| Exact `t.state === state` for tiers 1–4 | `src/lib/pickTemplate.ts` `candidateRank` |
| Org match key forbids null/"Any state" | `src/lib/sopMatchKey.ts` `orgSopMatchKeyError` |
| Wizard UI deliberately omits All/Any | `TemplateWizard.tsx` — comment “resolver matches states exactly” |
| Global RPC requires non-empty `p_state` | `author_global_sop` (E6.5 / E6.7) |
| Design already draws **All states** | `docs/redesign/design-reference/payer-and-cases/4 - Template Editor.dc.html` (`value="all"`) |
| Debt register | `TECH-DEBT.md` TD-47 — “ranked All-states tier in `pickTemplate`” |
| Schema already allows `'All'` | `20260710160000_state_format_checks.sql` — `sop_templates.state` **excluded** from `^[A-Z]{2}$` so matching wildcards stay valid |

**Not the same as `payers.states[]`.** That array is where the payer *operates*
(attach / generation eligibility). SOP coverage is a separate match-key question.

**Not the Ready gate.** After #277, Payer Setup Ready = ≥1 active global SOP with
≥1 task. All-states fixes **resolution / generation / per-target readiness**, not
the checklist Ready badge.

---

## Options compared (the open PM fork)

Two readings appeared in the corrected-plan thread. They are **not equivalent**.

| | **A — Literal All-states sentinel** | **B — `states text[]` multi-cover** |
| --- | --- | --- |
| Storage | Existing `sop_templates.state = 'All'` (wire casing locked below) | Additive `sop_templates.states text[]` (+ keep or migrate scalar `state`) |
| Match | Exact two-letter wins; else template with sentinel matches any case state | Exact scalar (if kept) wins; else `case.state ∈ template.states` |
| Design mock | Matches screen 4 (“All states” option) | Not in the mock; more flexible than design |
| Schema | **No column** — format floor already carved out for `'All'` | Additive migration + backfill story |
| Uniqueness | One active All per `(payer, group)` at org/global tier; exact-state siblings coexist | Overlapping sets (NC+SC vs SC+GA) need exclusion rules — L-sized |
| Subset cover (NC+SC, not GA) | **No** — All means every state | **Yes** |
| Effort | M (resolver + RPC/assert + wizard + tests) | L (schema + uniqueness + RPC signature + UI multi-select + every reader) |

**Spike recommendation: Option A** for the build that closes TD-47 / F4. Defer
Option B until a real payer needs a proper subset (not “all of this payer’s
targets”). If PM picks B, stop and rewrite the build map before any migration.

A third shape — **null state = any state** (mirroring null group) — is
**rejected** here: E4.2 explicitly removed “Any state”, uniqueness predicates
require `state IS NOT NULL` for the active-org grain, and the design labels the
control “All states”, not “Any state”.

---

## Locked decisions (build from these — **PM ack required**)

### D3.1 — Storage shape: All-states sentinel on existing `state` (Option A)

- Store the wildcard as the **scalar** `sop_templates.state` value (not a new
  column, not null).
- Cases / targets / contracts stay `^[A-Z]{2}$` — unchanged.
- **PM must confirm A vs B.** Spike defaults to **A**.

### D3.2 — Wire / display form of the sentinel

| Layer | Value |
| --- | --- |
| Stored / RPC / `pickTemplate` | `'All'` (capital A — matches the 2026-07-10 migration comment + MSO `'All'` precedent) |
| Wizard `<SelectItem>` | `value="All"`, label **All states** (design used lowercase `all` — normalize at write via the same path as `normalizeStateCode` **must not** run; use an explicit `ALL_STATES_SENTINEL` constant) |

Constant lives in one place (recommend `src/lib/sopMatchKey.ts` or
`pickTemplate.ts`) and every writer/reader imports it — no scattered `"all"` /
`"ALL"` literals.

### D3.3 — `pickTemplate` ranked tiers (exact always beats All; org always beats global)

Extend `candidateRank` — array order stays non-load-bearing:

| Rank | Ownership | State | Group |
| --- | --- | --- | --- |
| 1 | org | exact | exact |
| 2 | org | exact | any (`group_id` null) |
| 3 | org | **All** | exact |
| 4 | org | **All** | any |
| 5 | global payer | exact | exact |
| 6 | global payer | exact | any |
| 7 | global payer | **All** | exact |
| 8 | global payer | **All** | any |
| 9 | generic fallback | — | — |

Pinned properties (unit-test these first, before UI):

1. Exact-state template always beats All for the same ownership+group grain.
2. Org All beats global exact (org override rule preserved).
3. Wrong payer never matches.
4. Archived never matches.
5. Fallback still last; All never masquerades as fallback (fallback stays
   payerless global).

### D3.4 — Uniqueness / coexistence

- **Allowed:** active exact `NC` **and** active `All` for the same
  `(org|global, payer, group)` — different `state` values, no collision.
- **Forbidden:** two active `All` rows for the same `(org|global, payer, group)`.
- Org grain: existing partial unique
  `uq_sop_templates_active_org_match (org_id, payer_id, state, group_id)`
  already covers this (All is just another state value).
- Global grain: extend the **in-body** guard in `author_global_sop` (same
  `IS NOT DISTINCT FROM` on `state`) — already compares `p_state`; passing
  `'All'` is enough. No second unique index required for A.
- `assertUniqueActiveMatch` / `orgSopMatchKeyError`: treat `'All'` as a **valid**
  state (not null). Do not re-open “Any state” null.

### D3.5 — Authoring UI

- Restore the design’s **All states** option on Template Basics (global + any
  remaining org editor path that still writes a match key).
- Selecting All writes `ALL_STATES_SENTINEL`; selecting a US state writes the
  two-letter code.
- Group stays optional (“Any group”) — unchanged (TD-48 multi-group stays out).
- Review / provenance copy: show “All states”, never a blank.

### D3.6 — Consumers

No parallel matchers. Everything that resolves a template for a case key already
calls `pickTemplate` (generation confirm, readiness, stamps). After D3.3 they
inherit All-states for free. Do **not** special-case the #277 Ready funnel
(checklist presence, not per-state coverage).

### D3.7 — Out of scope (unchanged)

- Ready / attach / purge / hosted DELETE (#277 / #275)
- Removing or bypassing `org_payer_assignments`
- `states text[]` multi-cover (Option B) unless D3.1 flips
- Null-state “Any state” revival
- TD-48 multi-group select
- Extension fill / Train (no template picker there)
- Slice 5 generation-reason visibility
- Editing `sopResolver.ts` task content resolution (match key only)

---

## Schema / RPC impact (Option A — no new column)

| Object | Change |
| --- | --- |
| `sop_templates.state` | None (already wildcard-capable) |
| `uq_sop_templates_active_org_match` | None |
| `author_global_sop` | Allow `p_state = 'All'`; keep “non-empty” check; duplicate guard unchanged |
| Org `createTemplate` / `updateTemplate` | `assertActiveOrgMatchKeyComplete` accepts All; uniqueness assert accepts All |
| Types / table-register | Doc note on sentinel; no generated-type change if column unchanged |
| Hosted apply | **None** for A — pure app + RPC body. If `author_global_sop` is reissued, 3M lane still treats hosted apply as operator step — prefer `CREATE OR REPLACE` only if a body change is required; otherwise keep validation in the TS service and teach the RPC’s incomplete check that `'All'` is complete (it already is — non-empty). |

**Option B (if chosen):** additive `states text[]`, RPC arg, uniqueness policy for
overlaps, wizard multi-select, dual-read period — rewrite this section before
build.

---

## Hosted / live data (ops)

Supabase MCP was **unauthenticated** in this spike environment — live counts are
**Unverified — ops**. Before build merge, operator should confirm:

```sql
-- any existing wildcard-ish rows?
select state, count(*) from sop_templates
 where state is not null and state !~ '^[A-Z]{2}$'
 group by 1;

-- active templates per payer (duplication pressure)
select payer_id, state, count(*)
  from sop_templates
 where archived = false and payer_id is not null
 group by 1, 2
 order by 3 desc;
```

Expect zero `'All'` rows today (wizard never offered it). Seed fixtures use
ordinary two-letter states.

---

## Minimal PR map (build — after PM ack)

| # | Change | Files (indicative) |
| --- | --- | --- |
| 1 | Sentinel constant + `pickTemplate` ranks 3/4/7/8 + tests | `pickTemplate.ts`, `pickTemplate.test.ts` |
| 2 | Match-key validation accepts All | `sopMatchKey.ts` (+test), `templates.ts` asserts |
| 3 | Wizard All-states option + write path | `TemplateWizard.tsx` |
| 4 | Global author path (if RPC body needs a comment/guard tweak) | `author_global_sop` migration **only if** live body rejects All; else service-only |
| 5 | Close TD-47 + wiki one-liner | `TECH-DEBT.md`, `docs/wiki/payer-setup.md` if needed |

**Suggested split:** (1)+(2) pure/resolver PR → (3)+(5) UI/docs. Keep under bite-size
rules (~one behavior per PR).

---

## Claude / Cursor build handoff (after spike merges + PM ack)

```
Implements Slice 3 from docs/ops/slice-3-sop-all-states-spike.md
(LOCKED D3.1–D3.7 — confirm D3.1 is Option A before coding).
Branch: cursor/3m-slice-3-sop-all-states-build-3a65 off main.
Bind skill: .cursor/skills/minted-3m-audit/ (PR #273).
Rules: AGENTS.md; additive only; never self-merge; draft PR.

Must:
- ALL_STATES_SENTINEL = 'All'
- pickTemplate ranks per D3.3; exact beats All; org beats global
- Wizard offers All states; writers persist 'All'
- orgSopMatchKeyError / author path accept 'All' (not null)
- Unit tests for ranks + uniqueness coexistence
- Close TD-47 when shipped

Must not:
- Reopen Ready / attach / purge / org_payer_assignments removal
- states text[] unless PM flipped D3.1 to B
- Null Any-state
- Extension changes
- Slice 5

Stop at draft PR + D3 checklist in PR body.
```

---

## Verify (build acceptance)

1. Template with `state=All`, any-group → resolves for case states NC and SC
2. Exact `NC` org template beats All when both exist for same payer/group
3. Org All beats global exact NC for an org-owned case key
4. Second active All for same payer/group blocked (org UI error + global RPC)
5. Wizard shows All states; saving round-trips `'All'`
6. Fallback still only when no payer template matches
7. #277 Ready still checklist-only (All vs exact does not flip Ready by itself)
8. CI: targeted vitest + `tsc --noEmit`

---

## Decisions already locked upstream (do not re-litigate here)

- Ready = checklist SOP; autofill = badge; form mapper stays (#277)
- Attach: defaults only; do not reverse E6.2 (#277)
- Keep `org_payer_assignments` unless reopened
- No DELETE without second PM sign-off (#275)
- Slice 5 out unless asked

# Slice 3 spike — SOP All-states / multi-state match

**Status:** spike complete (2026-08-10) — **PM ack recorded 2026-08-10:
`D3.1 A; D3.2–D3.7 as written`.** Build targets §User stories below. No product
code in this PR.  
**Branch / PR:** `cursor/3m-slice-3-sop-all-states-spike-3a65`  
**Lane:** corrected 3M payer-setup plan. Skill: `.cursor/skills/minted-3m-audit/`
(PR #273).  
**Base:** `main` after #274 / #275 / #277 merged.

Companion: [`repo-workflow.md`](./repo-workflow.md) ·
[`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md) (different Slice 6) ·
`TECH-DEBT.md` **TD-47**.

---

## Next-agent packet (paste-ready)

```
Mandate: Continue corrected 3M payer-setup plan.
Next: Slice 3 BUILD — PM ack locked (D3.1 A; D3.2–D3.7 as written).
      Implement US-1..US-4 in §User stories (this file).

Draft PRs:
- #278 this spike (docs) — merge when CI green
- Build PR: cursor/3m-slice-3-sop-all-states-build-3adf off main
- #273 minted-3m-audit skill — bind; don't paste audit
- #279 e2e hotfix for #277 attach defaults (merge first if still open)

Prior merged: #277 Ready/attach · #274 create_payer S0 · #275 purge code

Locked (do not re-litigate):
- D3.1 = Option A (state='All'); D3.2–D3.7 as written in this spike
- Ready = checklist SOP; autofill = badge; form mapper stays
- Attach: defaults only; don't reverse E6.2
- Keep org_payer_assignments unless reopened
- No DELETE without second PM sign-off (#275)
- Slice 5 out unless asked

Stop: draft build PR + US/AC checklist in body; never self-merge.
```
---

## Do not confuse two “Slice 3” names

| Name                                                           | Meaning                                                               | Status                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **This spike** — SOP All-states                                | One payer checklist covers every case state without N template clones | **In scope**                                                                      |
| **#274 prose** — “Slice 3 = drop `org_payer_assignments` gate” | Adoption-layer rewrite implied while fixing `create_payer`            | **Out of scope / locked closed** — keep `org_payer_assignments` unless PM reopens |

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

| Evidence                                | Path                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Exact `t.state === state` for tiers 1–4 | `src/lib/pickTemplate.ts` `candidateRank`                                                                                        |
| Org match key forbids null/"Any state"  | `src/lib/sopMatchKey.ts` `orgSopMatchKeyError`                                                                                   |
| Wizard UI deliberately omits All/Any    | `TemplateWizard.tsx` — comment “resolver matches states exactly”                                                                 |
| Global RPC requires non-empty `p_state` | `author_global_sop` (E6.5 / E6.7)                                                                                                |
| Design already draws **All states**     | `docs/redesign/design-reference/payer-and-cases/4 - Template Editor.dc.html` (`value="all"`)                                     |
| Debt register                           | `TECH-DEBT.md` TD-47 — “ranked All-states tier in `pickTemplate`”                                                                |
| Schema already allows `'All'`           | `20260710160000_state_format_checks.sql` — `sop_templates.state` **excluded** from `^[A-Z]{2}$` so matching wildcards stay valid |

**Not the same as `payers.states[]`.** That array is where the payer _operates_
(attach / generation eligibility). SOP coverage is a separate match-key question.

**Not the Ready gate.** After #277, Payer Setup Ready = ≥1 active global SOP with
≥1 task. All-states fixes **resolution / generation / per-target readiness**, not
the checklist Ready badge.

---

## Options compared (the open PM fork)

Two readings appeared in the corrected-plan thread. They are **not equivalent**.

|                              | **A — Literal All-states sentinel**                                                  | **B — `states text[]` multi-cover**                                       |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Storage                      | Existing `sop_templates.state = 'All'` (wire casing locked below)                    | Additive `sop_templates.states text[]` (+ keep or migrate scalar `state`) |
| Match                        | Exact two-letter wins; else template with sentinel matches any case state            | Exact scalar (if kept) wins; else `case.state ∈ template.states`          |
| Design mock                  | Matches screen 4 (“All states” option)                                               | Not in the mock; more flexible than design                                |
| Schema                       | **No column** — format floor already carved out for `'All'`                          | Additive migration + backfill story                                       |
| Uniqueness                   | One active All per `(payer, group)` at org/global tier; exact-state siblings coexist | Overlapping sets (NC+SC vs SC+GA) need exclusion rules — L-sized          |
| Subset cover (NC+SC, not GA) | **No** — All means every state                                                       | **Yes**                                                                   |
| Effort                       | M (resolver + RPC/assert + wizard + tests)                                           | L (schema + uniqueness + RPC signature + UI multi-select + every reader)  |

**Spike recommendation: Option A** for the build that closes TD-47 / F4. Defer
Option B until a real payer needs a proper subset (not “all of this payer’s
targets”). If PM picks B, stop and rewrite the build map before any migration.

A third shape — **null state = any state** (mirroring null group) — is
**rejected** here: E4.2 explicitly removed “Any state”, uniqueness predicates
require `state IS NOT NULL` for the active-org grain, and the design labels the
control “All states”, not “Any state”.

---

## Locked decisions (build from these — **PM ACKED 2026-08-10**)

**PM reply:** `D3.1 A; D3.2–D3.7 as written`. Option B is deferred (not this
build). Do not re-open A vs B.

### D3.1 — Storage shape: All-states sentinel on existing `state` (Option A) ✅

- Store the wildcard as the **scalar** `sop_templates.state` value (not a new
  column, not null).
- Cases / targets / contracts stay `^[A-Z]{2}$` — unchanged.
- **Locked: Option A.**
### D3.2 — Wire / display form of the sentinel

| Layer                         | Value                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored / RPC / `pickTemplate` | `'All'` (capital A — matches the 2026-07-10 migration comment + MSO `'All'` precedent)                                                                                                            |
| Wizard `<SelectItem>`         | `value="All"`, label **All states** (design used lowercase `all` — normalize at write via the same path as `normalizeStateCode` **must not** run; use an explicit `ALL_STATES_SENTINEL` constant) |

Constant lives in one place (recommend `src/lib/sopMatchKey.ts` or
`pickTemplate.ts`) and every writer/reader imports it — no scattered `"all"` /
`"ALL"` literals.

### D3.3 — `pickTemplate` ranked tiers (group + state first; ownership wall inherited)

**Grain truth:** a case key is `(payer, state, group)`. Contracts and attach
defaults are also group×payer. Org is tenancy / override ownership — not the
primary attachment of a payer. US-2 must lead with **exact group > any-group**
and **exact state > All**, not “org beats global.”

Extend `candidateRank` — array order stays non-load-bearing. Default table
below **inserts All inside the existing E4.2 ownership wall** (org block, then
global block, then fallback). That wall is pre-Slice-3; it already makes
`org any-group` beat `global exact-group` today.

| Rank | Ownership        | State   | Group                 |
| ---- | ---------------- | ------- | --------------------- |
| 1    | org              | exact   | exact                 |
| 2    | org              | exact   | any (`group_id` null) |
| 3    | org              | **All** | exact                 |
| 4    | org              | **All** | any                   |
| 5    | global payer     | exact   | exact                 |
| 6    | global payer     | exact   | any                   |
| 7    | global payer     | **All** | exact                 |
| 8    | global payer     | **All** | any                   |
| 9    | generic fallback | —       | —                     |

Pinned properties (unit-test these first, before UI):

1. Exact-state template always beats All for the same ownership + group grain.
2. Exact-group template always beats any-group for the same ownership + state
   grain. A template for a **different** group never matches.
3. Wrong payer never matches; archived never matches.
4. Fallback still last; All never masquerades as fallback (fallback stays
   payerless global).
5. **Ownership wall (inherited E4.2, not Slice-3 intent):** org block still
   outranks the entire global block — so org All can beat global exact. If PM
   wants group affinity to outrank ownership (e.g. global exact-group beats
   org All / org any-group), that is **D3.3-G** below — reopen explicitly;
   do not silently change E4.2 inside this slice.

#### D3.3-G — optional reopen (not default; needs PM)

If payers-are-group-attached should beat org ownership when ranking:

| Priority idea                                                         | Effect                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Rank by state specificity, then group specificity, then ownership     | `global exact + exact group` beats `org All + any group` (and possibly org any)     |

Only adopt D3.3-G with an explicit PM flip — it changes live E4.2 behavior for
exact-state rows too, not just All.
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

## User stories + acceptance criteria (build target)

These four stories are what the Slice 3 **build** PR implements and what the PR
body’s checklist maps to. Trace: US-1 → D3.1/D3.2/D3.5 · US-2 → D3.3/D3.6 ·
US-3 → D3.4 · US-4 → D3.6/D3.7.

### US-1 — Author one payer checklist for all case states

**As** a template author (platform global or org override),  
**I want** to set the SOP match key to **All states**,  
**so that** I do not clone the same checklist once per two-letter state.

| #     | Acceptance criterion                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1.1 | Template Basics offers an **All states** option alongside US states (design screen 4).                                                               |
| AC1.2 | Choosing All persists `sop_templates.state = 'All'` (capital A). Choosing a US state persists `^[A-Z]{2}$`. No `states text[]` column.                |
| AC1.3 | Writers/readers share one `ALL_STATES_SENTINEL` constant — no scattered `"all"` / `"ALL"` literals.                                                  |
| AC1.4 | `orgSopMatchKeyError` / org create·update asserts and the global author path treat `'All'` as a **complete** state (not null, not “Any state”).      |
| AC1.5 | Review / provenance / list copy shows the label **All states**, never a blank or a raw unexpected casing.                                            |

### US-2 — Resolve the right SOP for a case’s payer × group × state

**As** generation / readiness / stamping,  
**I want** `pickTemplate` to treat All-states as a state wildcard on the same
grain cases already use (**payer + group + state**),  
**so that** a group-specific exact SOP still wins over a broader All, and All
only fills gaps — not so that “org beats global” becomes the story.

| #     | Acceptance criterion                                                                                                                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC2.1 | Insert All as a **state** wildcard inside each existing ownership × group slot (D3.3 table). No second matcher.                                                                                                      |
| AC2.2 | **Exact state beats All** for the same ownership + group grain (exact-group NC beats All for that group; exact any-group NC beats All any-group).                                                                    |
| AC2.3 | **Exact group beats any-group** for the same ownership + state grain. A template authored for a different group never resolves.                                                                                      |
| AC2.4 | Wrong payer never matches; archived never matches.                                                                                                                                                                   |
| AC2.5 | Generic fallback stays last and stays payerless — All never masquerades as fallback.                                                                                                                                 |
| AC2.6 | A template with `state=All` + matching group grain resolves for concrete case states (e.g. NC and SC) when no better (exact-state) match exists.                                                                     |
| AC2.7 | Unit tests pin AC2.2–AC2.6 **before** UI ships.                                                                                                                                                                      |
| AC2.8 | **Ownership wall:** default build keeps E4.2 (org block before global block). Call out in PR that org All may beat global exact as an *inherited* consequence — not a Slice-3 goal. Flip only if PM picks **D3.3-G**. |

### US-3 — Exact + All can share a payer; two Alls cannot

**As** an author maintaining both a default process and a state exception,  
**I want** an active exact-state SOP and an active All SOP for the same payer/group,  
**so that** exceptions stay explicit without deleting the default.

| #     | Acceptance criterion                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| AC3.1 | Active exact `NC` **and** active `All` for the same `(org\|global, payer, group)` are allowed (different `state` values).                      |
| AC3.2 | A second active `All` for the same `(org\|global, payer, group)` is blocked (org uniqueness / assert + global `author_global_sop` in-body).    |
| AC3.3 | Null-state “Any state” remains forbidden for org match keys — All is the only wildcard this build introduces.                                  |

### US-4 — One matcher; Ready and out-of-scope stays closed

**As** the program owner,  
**I want** All-states to ride the existing resolver only,  
**so that** #277 Ready, attach, purge, and Slice 5 are not reopened by this PR.

| #     | Acceptance criterion                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AC4.1 | No second template matcher — generation confirm, readiness, and stamps keep calling `pickTemplate` only.                                     |
| AC4.2 | #277 Ready stays checklist presence (≥1 active global SOP with ≥1 task); authoring All vs exact does **not** by itself flip Ready.           |
| AC4.3 | Diff does **not** include: Ready/attach/purge changes, `org_payer_assignments` removal, Option B `states text[]`, null Any-state, TD-48 multi-group, extension Train/fill, Slice 5, or `sopResolver.ts` content edits. |
| AC4.4 | TD-47 closed (or pointed at shipped build) when US-1..US-3 land.                                                                             |

### Story → verify map

| Verify # (below) | Stories   |
| ---------------- | --------- |
| 1, 5             | US-1      |
| 1–3, 6           | US-2      |
| 2, 4             | US-3      |
| 7                | US-4      |
| 8                | all (CI)  |

---

## Schema / RPC impact (Option A — no new column)
| Object                                  | Change                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sop_templates.state`                   | None (already wildcard-capable)                                                                                                                                                                                                                                                                                                     |
| `uq_sop_templates_active_org_match`     | None                                                                                                                                                                                                                                                                                                                                |
| `author_global_sop`                     | Allow `p_state = 'All'`; keep “non-empty” check; duplicate guard unchanged                                                                                                                                                                                                                                                          |
| Org `createTemplate` / `updateTemplate` | `assertActiveOrgMatchKeyComplete` accepts All; uniqueness assert accepts All                                                                                                                                                                                                                                                        |
| Types / table-register                  | Doc note on sentinel; no generated-type change if column unchanged                                                                                                                                                                                                                                                                  |
| Hosted apply                            | **None** for A — pure app + RPC body. If `author_global_sop` is reissued, 3M lane still treats hosted apply as operator step — prefer `CREATE OR REPLACE` only if a body change is required; otherwise keep validation in the TS service and teach the RPC’s incomplete check that `'All'` is complete (it already is — non-empty). |

**Option B (if chosen):** additive `states text[]`, RPC arg, uniqueness policy for
overlaps, wizard multi-select, dual-read period — rewrite this section before
build.

---

## Hosted / live data (ops)

**Verified 2026-08-10** (operator SQL Editor against hosted) for the active
per-payer grain:

| payer_id           | state | count |
| ------------------ | ----- | ----- |
| `4983e2ad-…f610c6` | NC    | 1     |
| `225c1eb7-…0f2a6c` | CA    | 1     |
| `6239daa9-…467a90` | OR    | 1     |
| `5e76b166-…a52420` | NC    | 1     |
| `3c823616-…cb3c79` | NC    | 1     |

Read:

- **5** active payer-linked SOPs; every `(payer, state)` count is **1** — no
  duplication pressure to collapse before introducing All.
- States in use are ordinary two-letter codes only (`NC` ×3 payers, `CA`, `OR`).
- No live `'All'` / wildcard row in this set (wizard never offered it). Option A
  introduces the sentinel on a clean slate.

Still useful once (optional confirm — not blocking D3.1):

```sql
-- any existing wildcard-ish rows?
select state, count(*) from sop_templates
 where state is not null and state !~ '^[A-Z]{2}$'
 group by 1;
```

Expect empty. Seed fixtures use ordinary two-letter states.

---

## Minimal PR map (build — PM acked; implement US-1..US-4)

| #   | Change                                                       | Stories | Files (indicative)                                                                 |
| --- | ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------- |
| 1   | Sentinel constant + `pickTemplate` ranks 3/4/7/8 + tests     | US-2    | `pickTemplate.ts`, `pickTemplate.test.ts`                                          |
| 2   | Match-key validation accepts All                             | US-1/3  | `sopMatchKey.ts` (+test), `templates.ts` asserts                                   |
| 3   | Wizard All-states option + write path                        | US-1    | `TemplateWizard.tsx`                                                               |
| 4   | Global author path (if RPC body needs a comment/guard tweak) | US-1/3  | `author_global_sop` migration **only if** live body rejects All; else service-only |
| 5   | Close TD-47 + wiki one-liner                                 | US-4    | `TECH-DEBT.md`, `docs/wiki/payer-setup.md` if needed                               |

**Suggested split:** (1)+(2) pure/resolver PR → (3)+(5) UI/docs. Keep under bite-size
rules (~one behavior per PR). Single build PR is OK if still reviewable.

---

## Claude / Cursor build handoff (PM acked — ready to code)

```
Implements Slice 3 US-1..US-4 from docs/ops/slice-3-sop-all-states-spike.md
(PM ack: D3.1 A; D3.2–D3.7 as written).
Branch: cursor/3m-slice-3-sop-all-states-build-3adf off main.
Bind skill: .cursor/skills/minted-3m-audit/ (PR #273).
Rules: AGENTS.md; additive only; never self-merge; draft PR.
Prefer merge #279 first if still open (TS-110 attach-defaults e2e).

Must (map to US/AC in spike §User stories):
- ALL_STATES_SENTINEL = 'All' (US-1)
- pickTemplate: exact state > All; exact group > any-group; All fills gaps (US-2)
- Keep E4.2 ownership wall unless PM picks D3.3-G (US-2 AC2.8)
- Wizard offers All states; writers persist 'All' (US-1)
- orgSopMatchKeyError / author path accept 'All' (not null) (US-1/3)
- Unit tests for ranks + uniqueness coexistence (US-2/3)
- Close TD-47 when shipped (US-4)
- PR body checklist = US-1..US-4 AC rows

Must not (US-4 / D3.7):
- Reopen Ready / attach / purge / org_payer_assignments removal
- states text[] (Option B deferred)
- Null Any-state
- Extension changes
- Slice 5

Stop at draft PR + US/AC checklist in PR body.
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

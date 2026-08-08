# Master Epic/Feature Template — Minted Panel Redesign (v2)

This is the canonical authoring template for all redesign epics. It reflects
the structure actually delivered for E0.0–E0.4, plus the authoring rules from
review feedback. Epics land as `docs/redesign/EX.X-<slug>.md`, on a branch, as
a PR targeting `main` — **the PM merging that PR is what approves the epic.**

Two rules that keep these files short enough to stay true (2026-08-07):

- **One epic = one PR of work.** More than ~8 features, more than one repo, or
  a PR map inside the epic means it is a stage — split it before approval.
- **Link, don't restate.** Reference the migration, service, or component by
  path instead of paraphrasing what it contains. Paraphrase is how an epic and
  the code drift apart, and it is what a reviewer then spends a session
  re-verifying line by line.

Technical enablers are **not** authored here — the build session spikes them
and records them in its PR body, where they can go stale harmlessly. (Epics up
to E6.9 carry a `## 5. Technical Considerations & Enablers` section from the
older workflow; those stay as history.)

The template starts here — everything from the `---` below through the end is
the epic skeleton. The **Authoring Rules** section at the bottom is guidance
for the author (ChatPRD); do not copy it into delivered epics.

---

````markdown
---
epic: e0.X # lowercase in frontmatter; filename is EX.X-<slug>.md
title: <Epic Name>
stage: 0
status: draft # draft → in-build → done. Merging the epic PR is what approves it;
# there is no `reviewed` flag (retired 2026-08-07).
owner: chatprd
---

# E0.X — [Epic Name]

## Purpose and Context

- Clear one-paragraph overview: why this epic exists, which core journey or
  funnel stage it serves, and decision artifacts it implements (e.g., reference
  E0.0, E0.1, sequencing doc, or seed-universe).

## Personas Empowered

- List persona(s) using canonical IDs/names (P1 Credentialing Manager,
  P5 Practice Owner, etc.).
- Persona list must match the master table (E0.0). Do NOT introduce new
  personas or roles here — see Authoring Rules.

## Component & Data Constraints

- Must be built from the current component library — see
  [uiux-component-guide.md](./uiux-component-guide.md) (component selection +
  build requirements) and [README.md](./README.md) (workflow + merge gate).
- Example/demo/test data must use scenario orgs and personas from
  [seed-universe.md](./seed-universe.md). Claim new TS ids from
  `node scripts/check-epic-hygiene.mjs --next` — never by reading the end of the
  table, which is how two workstreams end up on the same number.
- Any requirement tied to codebase/data model must be explicitly flagged as an
  implementation dependency (not an assumption) — and **cited by path**, not
  paraphrased.

---

## Features

For each feature (F0.X.n — epic-prefixed numbering), provide:

### F0.X.n — [Feature name]

- **Description:** What the user/system can do or see; tie to journey,
  workflow, or requirement.
- **Persona:** Who actually interacts/benefits or is empowered by this feature.
- **Benefit hypothesis:** What outcome or friction reduction does this
  specifically enable; why the feature is valuable.
- **Acceptance criteria:**
  - Bulleted checklist: everything that must be true for the feature to be
    "done".
- **Test/data scenario(s):** Reference TS-# and seed-universe orgs/personas.
  Only cite TS-# IDs that exist in seed-universe (see Authoring Rules).

Gherkin example

```gherkin
Feature: [State feature explicitly]
  Scenario: [Realistic, data-driven example based on seed-universe]
    Given [Seed org/user state]
    When [Action]
    Then [Expected result]
```
````

---

## Scenario/Seed Data Mapping

| Test scenario | Org(s)/User(s)         | Purpose                                           |
| ------------- | ---------------------- | ------------------------------------------------- |
| TS-#          | [Fixture org, persona] | [E.g., baseline, duplicate, link, multi-operator] |

---

## Dependencies

- List required data model/tables/components (e.g., org lifecycle state,
  party/role assignment).
- Note any repo/implementation gating (e.g., "Requires party/role data; flag
  if not in schema.")

---

## Out of Scope / Non-Goals

- List out-of-scope items for this epic (e.g., "No manual org promote", "No
  Stage 1 feature stubs", "No unmanaged duplicate policy").
- Note any future-stage deferrals for clarity.

---

## Revision History

- [Date/version], [Author], [Key updates, rationale]

```

_The reviewing agent (Devin) appends a `## 5. Technical Considerations &
Enablers — Devin section` after review; authors never write or edit it._

---

## Authoring Rules (ChatPRD — read before every epic)

Recurring defects from the E0.0–E0.4 reviews. Each of these has cost a review
cycle at least once; treat them as hard rules.

1. **Frontmatter must be a real YAML block.** E0.2, E0.3, and E0.4 all arrived
   with the frontmatter collapsed into a single heading line. The file must
   START with a fenced block exactly like the template above: `---` on its own
   line, one `key: value` per line, closing `---`, then the `# E0.X — Title`
   heading. Never inline it into a heading. Always deliver `status: draft`;
   there is no `reviewed` key — merging the epic PR is what approves it.
2. **Feature numbering is epic-prefixed: `F0.X.n`.** E0.2 (F2.x), E0.3 (F3.x),
   and E0.4 (F4.x) all needed renumbering. E0.2's third feature is `F0.2.3`,
   not `F2.3`.
3. **Never reference undefined artifacts.** E0.4 cited "TS-X" (no such
   scenario); E0.2 cited fixtures that didn't exist in seed-universe. If a
   test scenario or fixture isn't in `seed-universe.md`, either add it there in
   the same delivery (new TS row + fixture data) or raise it as an open
   question — never invent an ID or assume data exists.
4. **Check locked decisions before writing new requirements.** E0.4's "flag
   orgs as inactive" collided with E0.0's locked "no lifecycle status label."
   Before drafting, re-read the Locked Decisions of all prior epics in the
   stage and the root `CLARIFICATIONS_NEEDED.md`. If a new requirement must
   override a locked decision, say so explicitly and flag it for the PM —
   don't contradict silently.
5. **Don't introduce unnamed concepts.** E0.4 repeatedly referenced a
   "consulting user/role/Oregon group" that exists nowhere — no persona row,
   no role in the E0.3 reference table. Every persona, role, or entity an epic
   uses must already exist in the persona table, seed-universe, or the party
   role list — or the epic must explicitly propose adding it.
6. **Doc links must resolve.** `stage-0-build-constraints.md` does not exist
   and has been cited three times. The binding docs are
   `docs/redesign/uiux-component-guide.md` (component + build constraints) and
   `docs/redesign/README.md` (workflow + merge gate). Use relative links
   (`./uiux-component-guide.md`) and verify every link points at a real file.
7. **Deliver epic docs targeting `main`**, at `docs/redesign/EX.X-<slug>.md`.
   The `redesign` staging branch was retired 2026-07-21; opening the epic PR
   against `main` and having the PM merge it is what approves the epic (see
   [`README.md`](./README.md)). Current write/merge map:
   [`docs/ops/repo-workflow.md`](../ops/repo-workflow.md).
8. **Keep doing (consistently strong):** Gherkin acceptance criteria, explicit
   non-goals, scenario/seed mapping tables, locked decisions + open questions
   sections, and revision history.

---

_Template standardized per E0.0–E0.4 of Minted Panel Redesign. Use for all
project epics/features/user stories. Reference persona IDs, seed-universe, and
component/build constraints for build/test/delivery consistency._
```

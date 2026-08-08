# Redesign Program — Workflow & Governance

This directory is the source of truth for the Minted Panel redesign. Epics branch off
`main` and target `main` (the `redesign` staging branch was retired 2026-07-21).

Cross-lane write/merge map (epic queue + 3M parallel lane, human-only ops):
[`docs/ops/repo-workflow.md`](../ops/repo-workflow.md).

## Roles

| Role                    | Agent          | Responsibility                                                                |
| ----------------------- | -------------- | ----------------------------------------------------------------------------- |
| PM                      | Human (Sowmya) | Business scope, UX design system, epic approval (by merging the epic PR)      |
| Requirements author     | ChatPRD/Devin  | Drafts epic `EX.X-*.md` files per the template                                |
| Reviewer / Orchestrator | Devin          | Reviews and merges Claude Code build PRs into `main`                          |
| Builder                 | Claude Code    | Spikes the epic against the code, then implements it as a PR targeting `main` |

## Directory layout

```
docs/redesign/
  README.md                  This file.
  EPIC-TEMPLATE.md           Canonical epic template (copy for new epics).
  E0.0-app-shell.md          One markdown file per epic: EX.X-<slug>.md, in this dir.
  E0.1-...md                 (further epics land here, alongside this README)
  uiux-component-guide.md    Component selection & build requirements for builders.
CLARIFICATIONS_NEEDED.md     (repo root) Open roadblocks for the PM.
```

Epic files land **directly in `docs/redesign/`** (not a subfolder), named
`EX.X-<slug>.md` (e.g. `E0.0-app-shell.md`) — this is the path the reviewer
listens on.

## Epic lifecycle

**An epic merged to `main` is an approved epic. There is no separate `reviewed`
flag** (retired 2026-08-07 — it was an out-of-band boolean that blocked build
sessions silently and drifted from `status`; the PR state already carries the
same meaning). The lifecycle is:

1. **Draft** — authored as `docs/redesign/EX.X-<slug>.md` on a branch, opened as a PR.
2. **Approved** — the PM merges that PR. A merged epic is buildable.
3. **In build** — a Claude Code PR referencing the epic is open against `main`.
4. **Done** — the build PR is merged and acceptance criteria are verified.

If an epic contains contradictions or gaps that force a **product** decision, record
the roadblock in `CLARIFICATIONS_NEEDED.md` and leave the epic unmerged. Gaps that are
merely technical are the spike's job, not the PM's.

## The spike replaces the standalone review session

Reviewing prose against a codebase has sharply diminishing returns: three review
rounds on E6.9 still left four blockers, and each was "the code contradicts the
epic" — the thing the first hour of building finds anyway. So:

**Every build session opens with a ≤60-minute spike** before writing feature code:

1. Probe every schema claim the epic makes (columns, constraints, RLS, grants) against
   `supabase/migrations/` and the live DB.
2. Grep the named modules — does the function the epic assumes actually exist, with
   that signature and that scoping?
3. Run `npm run lint:epics`.
4. Write the findings into the PR description as **Enablers** — including any epic
   criterion the code says is unbuildable, before you build around it.

If a criterion cannot be built as written, say so in the PR body and build the nearest
correct thing under a stated assumption. Do not silently reinterpret it.

**A dedicated review session** (`REVIEW-HANDOFF.md`) is reserved for epics crossing a
real boundary — authentication, RLS/tenant isolation, PHI, public/anon surfaces, money.
For those the cost of finding it late is unbounded. Every other epic goes straight to
build. The PM may also request one for any epic.

## Epic size

An epic is one PR's worth of work. If it needs a PR map, it is a stage — split it.
Concretely: **more than ~8 features, more than one repo, or more than one PR means
split it before approval.** Small epics need less ceremony to stay safe, which is the
cheapest simplification available.

## Build & merge gate (Claude Code PRs)

PRs from Claude Code must target `main` and reference exactly one epic
(e.g. `Implements e0.0`). The reviewer merges only when ALL of the following hold:

1. Every numbered FR in the epic is implemented and traceable in the diff.
2. The PR body carries the spike's enabler list, and each item is satisfied or
   explicitly deferred with a reason.
3. `npm run lint`, `npm run lint:epics`, and `npm run test` pass; e2e
   (`npm run test:e2e`) passes when touched surfaces have coverage.
4. AGENTS.md rules hold: hooks→services→Supabase data flow, additive-only migrations,
   org-scoped RLS, no new deps without justification, named exports, no `any`.
5. UI matches `uiux-component-guide.md` and the design tokens in AGENTS.md.

Failures produce PR review comments tagging Claude Code with the specific FR/enabler
that is unmet. Merge is blocked until remediated.

## Stages

- Stages are defined by the PM. Epics are approved (merged) one at a time as they are
  ready — there is no stage-wide review pass before build starts.

## Mechanical checks

`npm run lint:epics` (`scripts/check-epic-hygiene.mjs`) enforces what reading kept
missing: TS ids cited by epics and e2e specs are registered in `seed-universe.md`,
epic frontmatter is well-formed, and every table a migration creates has a
`table-register.md` row. Claim new scenario ids with
`node scripts/check-epic-hygiene.mjs --next`.

It deliberately does **not** try to detect two workstreams meaning different things by
the same id — that needs semantics. Single-point allocation is what prevents it.

# Redesign Program — Workflow & Governance

This directory is the source of truth for the Minted Panel redesign. It is managed on the
`redesign` branch. **Nothing here merges to `main`** until a stage is explicitly promoted
by the PM.

## Roles

| Role                    | Agent          | Responsibility                                                                                  |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| PM                      | Human (Sowmya) | Business scope, UX design system, stage promotion                                               |
| Requirements author     | ChatPRD        | Drafts epic `EX.X-*.md` files per the template                                                  |
| Reviewer / Orchestrator | Devin          | Polishes epics, populates technical enablers, gates and merges Claude Code PRs into `main`      |
| Builder                 | Claude Code    | Implements epics as PRs targeting `main` (the `redesign` staging branch was retired 2026-07-21) |

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

Status is tracked in each epic's frontmatter and only the reviewer changes
`status`/`reviewed`:

1. `draft` — authored by ChatPRD, committed to `docs/redesign/` as `EX.X-<slug>.md`.
2. `reviewed` — Devin has polished grammar/formatting (no scope changes) and fully
   populated `## 5. Technical Considerations & Enablers`. Frontmatter `reviewed: true`.
3. `in-build` — a Claude Code PR referencing the epic is open against `redesign`.
4. `done` — the PR is merged into `redesign` and acceptance criteria verified.

If an epic contains contradictions or logical gaps, the reviewer stops editing it,
records the roadblock in `CLARIFICATIONS_NEEDED.md`, and leaves the epic in `draft`.

## Build & merge gate (Claude Code PRs)

PRs from Claude Code must target `redesign` and reference exactly one epic
(e.g. `Implements e0.0`). The reviewer merges only when ALL of the following hold:

1. Every numbered FR in the epic is implemented and traceable in the diff.
2. All items in `## 5. Technical Considerations & Enablers` are satisfied.
3. `npm run lint` and `npm run test` pass; e2e (`npm run test:e2e`) passes when touched
   surfaces have coverage.
4. AGENTS.md rules hold: hooks→services→Supabase data flow, additive-only migrations,
   org-scoped RLS, no new deps without justification, named exports, no `any`.
5. UI matches `uiux-component-guide.md` and the design tokens in AGENTS.md.

Failures produce PR review comments tagging Claude Code with the specific FR/enabler
that is unmet. Merge is blocked until remediated.

## Stages

- **Stage 0 (current):** application shell — `e0.x` epics.
- Later stages are defined by the PM; the reviewer reviews all epics of a stage before
  build starts for that stage.

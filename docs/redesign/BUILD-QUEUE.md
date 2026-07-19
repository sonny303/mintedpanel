# Build Queue — E6 Simplification Wave

The ordered hand-off queue between the PM, Claude Code build sessions, and
Devin review. One epic per fresh Claude session, one PR per epic, strict
order (each epic renders on top of the previous one's surfaces).

## How the loop works

1. The PM pastes `docs/redesign/BUILD-PROMPT.md` (verbatim) into a fresh
   Claude Code session.
2. Claude finds the FIRST row below whose Status is `queued`, builds exactly
   that epic, and opens a PR against `redesign` whose body starts with
   `@devin-ai-integration please review and merge` — that mention triggers
   Devin's review with no human relay. The same PR flips the row to
   `in review` with the PR number.
3. Devin reviews against the epic + gates and merges, flipping the row to
   `merged` in a follow-up docs commit, or leaves comments naming the unmet
   FR/TE — Claude pushes fixes to the SAME branch.
4. After a merge, the PM starts the next fresh session with the same prompt.

Rules: build sessions never edit epic files or frontmatter (this queue file's
Status column and the PR body are the only build-session touchpoints outside
application code). Only epics with `reviewed: true` may enter this queue.

## Queue

| #   | Epic                               | File                                  | Status | PR  |
| --- | ---------------------------------- | ------------------------------------- | ------ | --- |
| 1   | E6.0 Unified case status           | `E6.0-unified-case-status.md`         | queued | —   |
| 2   | E6.1 Sidebar & surface restructure | `E6.1-sidebar-surface-restructure.md` | queued | —   |
| 3   | E6.2 Groups & Payer Network board  | `E6.2-groups-payer-network.md`        | queued | —   |
| 4   | E6.3 Decoupled generation          | `E6.3-decoupled-generation.md`        | queued | —   |
| 5   | E6.4 Providers area                | `E6.4-providers-area.md`              | queued | —   |
| 6   | E6.5 Payer Setup consolidation     | `E6.5-payer-setup-consolidation.md`   | queued | —   |
| 7   | E6.6 Reporting & touch unification | `E6.6-reporting-touch-unification.md` | queued | —   |

Status values: `queued` → `in review` (PR open) → `merged`. A blocked epic is
marked `blocked: <reason>` and the queue stops until the PM resolves it.

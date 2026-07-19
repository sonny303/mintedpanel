# Build Queue — E6 Simplification Wave

The hand-off queue between the PM, Claude Code build sessions, and Devin
review. All seven epics are queued at once; the **Depends on** column carries
the sequencing. Parallel sessions are allowed — each session owns one epic in
one fresh Claude session, one PR per epic.

## How the loop works

1. The PM pastes `docs/redesign/BUILD-PROMPT.md` (verbatim) into a fresh
   Claude Code session — one session per epic; several sessions may run at
   once.
2. Each Claude session claims the FIRST row whose Status is `queued` AND
   whose dependencies are not still `queued` (a dependency that is
   `in review` may be built against — branch from the dependency's PR branch
   and say so in the PR body). It flips its row to `building` in its first
   commit so parallel sessions never collide.
3. Claude opens a PR against `redesign` whose body starts with
   `@devin-ai-integration please review and merge` (this triggers Devin with
   no human relay), tags the dependency PRs it stacks on
   (`Depends on #NNN`), and opens as a **DRAFT** if any dependency PR is
   unmerged. The same PR flips the row to `in review` with the PR number.
4. Devin reviews against the epic + gates, merges strictly in dependency
   order, coordinates rebases of stacked PRs after each merge, and flips
   rows to `merged`. Review comments name the unmet FR/TE — Claude pushes
   fixes to the SAME branch.

Rules: build sessions never edit epic files or frontmatter (this queue file's
Status/PR columns and the PR body are the only build-session touchpoints
outside application code and required register updates). Only epics with
`reviewed: true` may enter this queue.

## Lanes (safe parallelism)

- **Lane 1 (org/case chain, strict order):** E6.0 → E6.1 → E6.2 → E6.3 → E6.4
  — E6.0's unified status field underpins every board and report; E6.1's
  sidebar/route restructure owns `src/components/layout/*` and the redirect
  table that E6.2–E6.4 mount into.
- **Lane 2 (standalone Journey A):** E6.5 — global payer-setup consolidation;
  no dependency on Lane 1 (may build and merge any time; only its sidebar
  entry rides E6.1's structure, coordinated at review).
- **Last:** E6.6 — renders E6.0 statuses, E6.2 boards, and E6.5 surfaces into
  reports; starts once E6.0 is at least `in review`.

## Queue

| #   | Epic                               | File                                  | Depends on                                        | Status | PR   |
| --- | ---------------------------------- | ------------------------------------- | ------------------------------------------------- | ------ | ---- |
| 1   | E6.0 Unified case status           | `E6.0-unified-case-status.md`         | —                                                 | merged | #199 |
| 2   | E6.1 Sidebar & surface restructure | `E6.1-sidebar-surface-restructure.md` | E6.0                                              | merged | #201 |
| 3   | E6.2 Groups & Payer Network board  | `E6.2-groups-payer-network.md`        | E6.0, E6.1                                        | merged | #203 |
| 4   | E6.3 Decoupled generation          | `E6.3-decoupled-generation.md`        | E6.0, E6.2                                        | queued | —    |
| 5   | E6.4 Providers area                | `E6.4-providers-area.md`              | E6.0, E6.1, E6.2                                  | queued | —    |
| 6   | E6.5 Payer Setup consolidation     | `E6.5-payer-setup-consolidation.md`   | — (sidebar entry coordinated with E6.1 at review) | queued | —    |
| 7   | E6.6 Reporting & touch unification | `E6.6-reporting-touch-unification.md` | E6.0, E6.2, E6.5                                  | queued | —    |

Status values: `queued` → `building` (session claimed) → `in review` (PR
open) → `merged`. A blocked epic is marked `blocked: <reason>` and its
dependents wait until the PM resolves it.

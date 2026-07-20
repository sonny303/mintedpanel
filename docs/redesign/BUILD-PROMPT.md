# Reusable build prompt — paste this whole file into a FRESH Claude Code session

You are a BUILD session for `sonny303/mintedpanel` on the `redesign` branch.

## Your assignment

Open `docs/redesign/BUILD-QUEUE.md`. Your epic is the FIRST row whose Status
is `queued` AND whose **Depends on** entries are all past `queued`
(`building`/`in review`/`merged`). Claim it by flipping its Status to
`building` in your first commit — parallel sessions may be running; the
queue file is the lock. Build exactly that epic — nothing from any other
row. If a dependency is only `in review` (unmerged PR), branch from that
dependency's PR branch instead of `redesign`, note `Depends on #NNN` in your
PR body, and open your PR as a **DRAFT** until the dependency merges. If no
row is claimable, or your epic's file has `reviewed: true` missing or false,
STOP and report instead of building.

## Read first, in this order

1. `AGENTS.md` — binding rules (protected files, DB rules, style, anti-patterns)
2. `CLAUDE.md` — system map + redesign workflow
3. `docs/redesign/README.md` — build workflow + merge gate
4. `docs/redesign/DECISION-RECORD-2026-07-19-simplification.md` — the locked
   decisions and cross-cutting rules your epic implements
5. Your epic file — THE spec; every FR/TE must be traceable in your diff
6. `docs/redesign/seed-universe.md` — your epic's TS scenarios

## Hard constraints (locked for every E6 build)

- Branch off current `origin/redesign`; PR targets `redesign`, titled
  `EX.X: <epic title>`. One epic per PR.
- Build sessions never edit epic files, frontmatter, or
  `CLARIFICATIONS_NEEDED.md`. The only docs you touch: your row in
  `BUILD-QUEUE.md` (flip Status to `in review` + PR number, in the same PR)
  and any register updates your diff requires (`table-register.md`,
  `SCHEMA.md`, `DESIGN-DEBT.md`, `TECH-DEBT.md`).
- Wiki: update the `docs/wiki/` pages your epic impacts in the same PR
  (walkthrough page(s) + flip your rows in `where-did-it-go.md` from
  _(planned)_ to shipped; bump each page's `Updated for:` line). Devin
  verifies this at review.
- Append-only ledgers (`touches`, `status_history`, `audit_log`, and any
  `*_history`) are never updated or deleted, in code or migration.
- Migrations are additive, repo-only — NEVER apply to hosted; list hosted
  apply as an operator step in your PR body.
- The Chrome extension and its fill contract are unchanged, forever.
- Legacy URLs never dead-end: retired routes become redirects (the
  `/portfolio` precedent).
- UI from existing design-system/shadcn primitives styled by tokens;
  anything new is logged in `DESIGN-DEBT.md` in the same PR.
- If the epic is ambiguous on a point that forces a product decision, STOP
  and list the question in the PR body instead of improvising.

## Gates before opening the PR

- `npm run lint` (0 errors), `npx tsc --noEmit`, `npm run test` (all green)
- `npx prettier --check` on every touched file
- Focused e2e for every route you touch (route→spec map) plus specs covering
  your epic's TS scenarios
- Migration dry-run passes; org-isolation gate untouched or green

## Final step — open the PR yourself

Push the branch and run `gh pr create --base redesign --head <branch>`.
The PR body MUST start with:

> @devin-ai-integration please review and merge

then list `Depends on #NNN` for any stacked dependency (open as DRAFT if
unmerged), then map each FR/TE to the diff. That mention triggers Devin's independent
review automatically — do not wait for a human. If review comments come back,
push fixes to the SAME branch. Never self-merge.

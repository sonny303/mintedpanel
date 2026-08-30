# Reusable build prompt — paste this whole file into a FRESH Claude Code session

You are a BUILD session for `sonny303/mintedpanel`, branching off and
targeting `staging`. Production is a later promotion PR `staging` → `main`
([`docs/ops/repo-workflow.md`](../ops/repo-workflow.md)).

## Your assignment

Open `docs/redesign/BUILD-QUEUE.md`. Your epic is the FIRST row whose Status
is `queued` AND whose **Depends on** entries are all past `queued`
(`building`/`in review`/`merged`). Claim it by flipping its Status to
`building` in your first commit — parallel sessions may be running; the
queue file is the lock. Build exactly that epic — nothing from any other
row. If a dependency is only `in review` (unmerged PR), branch from that
dependency's PR branch instead of `staging`, note `Depends on #NNN` in your
PR body, and open your PR as a **DRAFT** until the dependency merges.

An epic file that is **merged to `staging` is approved** — build it. (There is no
`reviewed` frontmatter flag; it was retired 2026-08-07.) If no row is
claimable, STOP and report instead of building.

## Read first, in this order

1. `AGENTS.md` — binding rules (protected files, DB rules, style, anti-patterns)
2. `CLAUDE.md` — system map + redesign workflow
3. `docs/redesign/README.md` — build workflow + merge gate
4. `docs/redesign/DECISION-RECORD-2026-07-19-simplification.md` — the locked
   decisions and cross-cutting rules your epic implements
5. Your epic file — THE spec; every FR must be traceable in your diff
6. `docs/redesign/seed-universe.md` — your epic's TS scenarios

## FIRST: spike the epic (≤60 minutes, before any feature code)

The epic is prose written against a moving codebase; assume it is stale
somewhere. Prove it out before you build on it:

1. **Probe every schema claim** — columns, CHECK constraints, RLS policies,
   grants — against `supabase/migrations/` and the live DB (Supabase MCP).
   Read the CHECKs, not just the column list: the most common defect is an
   acceptance criterion whose write shape violates one.
2. **Grep every named module** — does the function exist, with that signature
   and that org-scoping? A criterion that assumes an org-free call on an
   org-scoped service is unbuildable as written.
3. **Run `npm run lint:epics`** — TS-id registration, epic frontmatter, and
   table-register coverage, mechanically.
4. **Write the findings into your PR description as `## Enablers`** — each one
   naming the file that grounds it, and flagging any criterion the code says
   cannot be built as specified.

If a criterion is unbuildable, say so in the PR body and build the nearest
correct thing under a stated assumption. Never silently reinterpret it. If the
gap forces a **product** decision, stop and ask in the PR body.

## Hard constraints (locked for every E6 build)

- Branch off current `origin/staging`; PR targets `staging`, titled
  `EX.X: <epic title>`. One epic per PR. Promote `staging` → `main` after UAT.
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

- `npm run lint` (0 errors), `npm run lint:epics`, `npx tsc --noEmit`,
  `npm run test` (all green)
- `npx prettier --check` on every touched file
- Focused e2e for every route you touch (route→spec map) plus specs covering
  your epic's TS scenarios
- Migration dry-run passes; org-isolation gate untouched or green

## Final step — open the PR yourself

Push the branch and run `gh pr create --base main --head <branch>`.
The PR body MUST start with:

> @devin-ai-integration please review and merge

then list `Depends on #NNN` for any stacked dependency (open as DRAFT if
unmerged), then your `## Enablers` section from the spike, then map each FR to
the diff. That mention triggers Devin's independent
review automatically — do not wait for a human. If review comments come back,
push fixes to the SAME branch. Never self-merge.

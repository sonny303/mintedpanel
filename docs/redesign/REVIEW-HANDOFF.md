# REVIEW-HANDOFF — Independent epic review (Claude Code)

> **Read this only if the epic crosses a trust boundary.** Since 2026-08-07 the
> default path is the **spike at the head of the build session** (see
> `README.md` → "The spike replaces the standalone review session"). A dedicated
> review session costs a full session and produces a document; the spike does the
> same investigation and produces code.
>
> **Use a dedicated review session when the epic touches:** authentication or
> session handling · RLS / tenant isolation / grants · PHI or the SSN vault ·
> public, `anon`, or unauthenticated surfaces · billing or money · a global
> (cross-org) write tier. Or when the PM asks for one.
>
> For everything else, skip this file and spike inside the build session.

Instructions for a **dedicated Claude Code review session**. One session per
epic. You are the independent reviewer, NOT the builder and NOT the author.

## Kickoff (paste into a fresh Claude Code session)

> Act as the independent epic reviewer per docs/redesign/REVIEW-HANDOFF.md.
> Review docs/redesign/<EPIC-FILE>.md. Follow every step in that handoff doc.

## Authorization and hard limits

- You MAY edit exactly one file: the epic under review (to record redlines and,
  where a boundary genuinely needs pinning up front, a short enabler list).
- You may NOT: build or change any application code, add migrations, edit other
  epics, edit `CLARIFICATIONS_NEEDED.md`, or edit protected files.
- There is no `reviewed` flag to flip — approval is the PM merging the epic PR.
- Use a recommended model with maximum diligence (Opus) via `/model`.
- Work on a fresh branch off `main` named `review/<epic>` and open a PR titled
  `Review: EX.X <title>` targeting `main`.

## Review checklist — ground every claim in the repo

For each item, verify against actual files; do not review in the abstract. Run
`npm run lint:epics` first — it covers items 1 and 6 mechanically, so spend your
attention on the rest.

1. **Template compliance** — frontmatter and sections match
   `docs/redesign/EPIC-TEMPLATE.md`; each feature has persona, benefit
   hypothesis, acceptance criteria, and scenarios.
2. **Schema accuracy** — every table/column referenced exists (or is correctly
   marked new/additive) in `supabase/migrations/` and
   `docs/data-model/table-register.md`. Flag proposed columns that duplicate an
   existing one, break grain rules (state/purpose/payer-varying data → child
   rows), or miss an M:N join table. **Read the CHECK constraints**, not just the
   column list — the most common defect is an acceptance criterion whose write
   shape violates one.
3. **AGENTS.md conflicts** — data rules (additive migrations only, append-only
   tables, `ssn_last4` only, case/contract keys), style rules, anti-patterns.
   If the epic intentionally amends a locked rule, confirm the amendment is
   recorded in `CLARIFICATIONS_NEEDED.md`; otherwise redline it.
4. **RLS/security** — new tables/columns state their org-scoping and RLS
   expectations; anon-reachable surfaces are called out; no sensitive data in
   ordinary rows, logs, or exports. Check that the guard/auth path the epic
   assumes can actually serve it.
5. **UI component availability** — every implied control exists in
   `src/components/ui/` or `docs/redesign/design-system/`; missing primitives
   must be named as enablers with a `DESIGN-DEBT.md` note, never epic-local
   one-offs.
6. **Scenario/seed traceability** — every TS-x cited exists in
   `docs/redesign/seed-universe.md` and is not already implemented by a
   different workstream. Claim new ids from
   `node scripts/check-epic-hygiene.mjs --next`, never by eye.
7. **Table trace** — the epic lists tables read / written; reconcile against the
   register.
8. **Cross-epic consistency** — dependencies and out-of-scope lines don't
   contradict neighbouring epics or the roadmap.
9. **Scope discipline** — do not expand scope. If something seems missing but is
   a product decision, record it as an open question for the PM, not a new
   requirement.

## Output

1. Record redlines as PR review comments on the epic's file lines (or a
   `### Reviewer redlines` subsection if inline comments aren't possible), each
   tagged `blocker` / `should-fix` / `nit` and citing the repo file that grounds
   it. **Redlines are the deliverable** — a defect the author must fix.
2. Keep any enabler notes SHORT and limited to the boundary that justified this
   review. Build-mechanics enablers belong in the build PR, where they can go
   stale harmlessly; a long enabler section inside the epic is what turned these
   files into 1,200-line documents with three owners.
3. Summarize in the PR body: verdict (`ready for PM approval` /
   `needs author revision`), blockers count, open PM questions.
4. Stop. The author reacts to redlines; the PM merges the epic PR to approve it.

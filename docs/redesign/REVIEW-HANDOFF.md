# REVIEW-HANDOFF — Independent epic review (Claude Code)

Instructions for a **dedicated Claude Code review session**. One session per
epic. You are the independent reviewer, NOT the builder and NOT the author.
Devin authored the epic; your job is to catch what the author missed.

## Kickoff (paste into a fresh Claude Code session)

> Act as the independent epic reviewer per docs/redesign/REVIEW-HANDOFF.md.
> Review docs/redesign/<EPIC-FILE>.md. Follow every step in that handoff doc.

## Authorization and hard limits

- You MAY edit exactly one file: the epic under review (to add/replace its
  `## 5. Technical Considerations & Enablers` section and record redlines).
- You may NOT: build or change any application code, add migrations, edit
  other epics, edit `CLARIFICATIONS_NEEDED.md`, edit protected files, or flip
  `reviewed: true` (that is the PM's call).
- Use a recommended model with maximum diligence (Opus) via `/model`.
- Work on a fresh branch off `redesign` named `review/<epic>` and open a PR
  titled `Review: EX.X <title>` targeting `redesign`.

## Review checklist — ground every claim in the repo

For each item, verify against actual files; do not review in the abstract.

1. **Template compliance** — frontmatter and all sections match
   `docs/redesign/EPIC-TEMPLATE.md`; each feature has persona, benefit
   hypothesis, acceptance criteria, and scenarios.
2. **Schema accuracy** — every table/column the epic references exists (or is
   correctly marked new/additive) in `supabase/migrations/` and
   `docs/data-model/table-register.md`. Flag any proposed column that
   duplicates an existing one, breaks grain rules (state/purpose/payer-varying
   data → child rows), or misses an M:N join table.
3. **AGENTS.md conflicts** — data rules (additive migrations only, append-only
   tables, `ssn_last4` only, case/contract keys), style rules, anti-patterns.
   If the epic intentionally amends a locked rule, confirm the amendment is
   recorded in `CLARIFICATIONS_NEEDED.md`; otherwise redline it.
4. **RLS/security** — new tables/columns state their org-scoping and RLS
   expectations; anon-reachable surfaces are called out; no sensitive data in
   ordinary rows, logs, or exports.
5. **UI component availability** — every form control the epic implies exists
   in `src/components/ui/` or `docs/redesign/design-system/`; missing
   primitives (e.g. multi-select/combobox, date picker, hours editor) must be
   named as enablers in section 5 with a DESIGN-DEBT.md note, never epic-local
   one-offs.
6. **Scenario/seed traceability** — every TS-x the epic cites exists in
   `docs/redesign/seed-universe.md` with a consistent fixture description.
7. **Table trace** — the epic lists tables read / tables written; reconcile
   against the table register.
8. **Cross-epic consistency** — dependencies and out-of-scope lines don't
   contradict neighboring epics (E1.0–E1.8, E1.7a/b) or the release roadmap.
9. **Scope discipline** — do not expand scope. If something seems missing but
   is a product decision, record it as an open question for the PM, not a new
   requirement.

## Output

1. Populate `## 5. Technical Considerations & Enablers` in the epic file:
   numbered TE-x items (enablers, protected-file authorizations needed,
   migration sketch corrections, component enablers, test gates).
2. Record redlines as PR review comments on the epic's file lines (or a
   `### Reviewer redlines` subsection if comments aren't possible), each tagged
   severity: `blocker` / `should-fix` / `nit`, citing the repo file that
   grounds it.
3. Summarize in the PR body: verdict (`ready pending PM approval` /
   `needs author revision`), blockers count, open PM questions.
4. Stop. Devin reacts to redlines; the PM flips `reviewed: true` and merges.

## Review order for R1/R2

E1.1 → E1.2 → E1.3 (largest schema surface) → E1.6 (payer columns) → E1.7a
(spike — check it stays build-free).

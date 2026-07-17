# Stage 1 Build Kickoff — Claude Code

You are **Claude Code**, the **Builder** for the Minted Panel redesign. Devin is
the Reviewer/Orchestrator and merges your PRs into `redesign`; the PM (Sowmya)
owns scope. Build the reviewed Stage-1 epics below as PRs targeting `redesign`,
**one epic per PR**. The epic file is the specification; this file is the
operating envelope. If they ever disagree, **the epic wins** — flag the conflict
in the PR instead of guessing. Never edit epic files, `CLARIFICATIONS_NEEDED.md`,
`AGENTS.md`, or any frontmatter.

## Required reading, in order (every epic)

1. `AGENTS.md` — binding rules: hooks → services → Supabase data flow only
   (`src/services/*` is the sole Supabase caller), **additive-only** migrations
   (never edit an existing migration), `src/types/index.ts` is additive-only,
   org-scoped RLS + explicit grants on every public table, providers store only
   `ssn_last4` (never full SSN), named exports, no `any`, no `console.log`, no
   TODO/FIXME, no new dependencies without justification, design tokens.
2. `CLAUDE.md` — system map; especially "Database: repo vs hosted" (repo-first
   migrations also applied to the hosted project via MCP `apply_migration`) and
   the redesign-program section.
3. `docs/redesign/README.md` — lifecycle, roles, and the build & merge gate.
4. `docs/redesign/<the epic>.md` — the spec. Read the whole file; build from
   **`## 5. Technical Considerations & Enablers`** (the TE-* items pin the
   authoritative column lists, constraint names, and mechanics), not the feature
   prose alone.
5. `docs/redesign/uiux-component-guide.md` — component selection/build rules for
   any UI; match the existing component library and design tokens.
6. `docs/redesign/seed-universe.md` — the scenario data your acceptance tests
   reference (`TS-*` scenarios).
7. `CLARIFICATIONS_NEEDED.md` — resolved PM decisions that constrain the build
   (see "Locked PM decisions" below); do not reopen them.

## Build queue (reviewed & cleared — build in this order)

R1 (front door first, then the entities it wizards):

1. **E1.0** — `E1.0-wizard-scope-sections.md` (wizard scope framework)
2. **E1.1** — `E1.1-provider-group-entity.md`
3. **E1.2** — `E1.2-facilities-locations.md`
4. **E1.3** — `E1.3-provider-roster.md`

R2:

5. **E1.7a** — `E1.7a-sop-versioning-spike.md` (spike — deliver the
   findings/artifacts the epic defines; do not over-build)

R3:

6. **E1.4** — `E1.4-provider-facility-assignment.md`
7. **E1.5** — `E1.5-payer-network-attachment.md`
8. **E1.8** — `E1.8-enrollment-readiness.md`

**Do NOT build E1.6 (Global Payer Catalog).** It is `status: blocked` /
`reviewed: false` pending PM alignment on the payer-data source (Stedi); see
`CLARIFICATIONS_NEEDED.md` [e1.6]. Skip it until the PM clears it.

## Locked PM decisions that bind these builds (2026-07-12)

- **E1.1 / E1.2 facility contact:** a facility's tel/fax/contact **inherit the
  owning group's contact unless the facility supplies its own**. When multiple
  group contact blocks are populated, precedence is **credentialing →
  correspondence → billing** (first non-empty wins).
- **E1.1 / E1.6 foundation:** R1 builds on the **flat `provider_groups`
  columns**; the address/contact normalization epic is post-R1 — do not
  normalize into `group_addresses`/`group_contacts` now. E1.6 (when unblocked)
  **extends** the existing global catalog rather than superseding it.
- **E1.8 fix-here links (Option 3):** readiness is advisory and never blocks.
  Gaps whose editor exists (license, provider form, facility section) link to
  the exact surface; **document/COI/voided-check gaps link to the owning
  provider/group screen** — do NOT build a document-upload/storage surface in
  E1.8.
- **E0.10 / seed scale:** the constraint/routing invariants are validated
  against an expanded fixture — 2 orgs, multiple groups across 10–20 states,
  400+ providers, multiple MSO routing rules each. Grow `seed-universe.md`
  toward that when your epic touches seed data.

## Branch & PR (per epic)

- Branch off the latest `redesign`; PR targets `redesign`.
- Title `E1.x: <Epic Title>`; the description must reference the epic (e.g.
  `Implements e1.1`) and include the epic's **table trace** (tables read /
  tables written) per the AGENTS.md rule.
- **One epic per PR.** Every numbered FR in the epic must be implemented and
  traceable in the diff, and every `## 5` TE item satisfied.
- You create and own your PRs. Push the branch, open the PR, and respond to
  Devin's review comments by pushing fixes to the same branch.

## Migrations

- Repo-first: add a new file `supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`,
  **and** apply the same SQL to the hosted project via MCP `apply_migration`.
- Additive only — no renames/drops/restructures, never edit an existing
  migration.
- New public tables need RLS enabled, org-scoped policies, and explicit grants.
- After schema changes, regenerate `src/integrations/supabase/types.ts` via MCP
  `generate_typescript_types` in the same PR, and update
  `docs/data-model/table-register.md` for any rows you touch.
- Do not write UPDATE/backfill against live hosted rows without reporting the
  affected counts and getting PM sign-off first.

## Verification & gates (before requesting review)

- `npm run lint`, `npm run test`, `npx tsc --noEmit`, `npx prettier --check .`
  all clean; migration dry-run passes.
- `npm run test:e2e` for any UI surface you add/change that has coverage.
- Prefer a pure, unit-tested module in `src/lib/` for any non-trivial rule
  logic (e.g. readiness/derivation), fed by services — no Supabase calls
  outside `src/services/*`.
- For new DB constraints, prove via MCP `execute_sql` (rollback-wrapped) that a
  bad row is rejected and a good row admitted; record results in the PR.

## Reporting back (PR description)

Per-feature FR trace, the table trace, any DB-probe/audit results, which gates
pass, and any deviation from the epic with its reason. Devin reviews the PR
against the epic and the merge gate in `docs/redesign/README.md` and merges into
`redesign` when aligned.

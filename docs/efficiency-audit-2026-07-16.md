# Efficiency audit — last 48 hours (2026-07-14 → 2026-07-16)

Audit of how work actually flowed across `sonny303/mintedpanel` and
`sonny303/minted-extension` over the last 48 hours, what the verification
stack really costs (measured, not guessed), which steps are being overdone for
small changes, and a concrete plan to work and test more efficiently on both
repos going forward.

## 1. What the 48 hours actually contained

All activity was on **mintedpanel's `redesign` branch**; the extension repo had
zero commits or PRs in the window (last touch 2026-07-10, PR #25).

14 PRs were merged (or closed) into `redesign` in ~48h:

| Kind                               | PRs                                                                                                      | Share |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ----- |
| Epic feature builds                | #154 (E3.3), #155 (E4.0), #156 (E4.1), #157 + #158 + #164 (E4.2, split in three), #166 (E1.7b amendment) | 8     |
| Independent review PRs (docs-only) | #161 (E1.3 amendment), #165 (E1.7b amendment)                                                            | 2     |
| Hotfix / regression-recovery       | #160 (recover manual case prerequisites), #163 (restore portal-task integrity lost vs `main`)            | 2     |
| Docs / roadmap / audit             | #162 (roadmap), #167 (payer parity audit)                                                                | 2     |

Also in the wider window: #146 and #150 were **closed unmerged** (a docs
refresh and a review PR) — full PR ceremony spent, zero landed value.

Representative cycle times: an epic build runs 1–5.5h PR-open→merge
(#157: 5.5h, 74 files; #156: 2h). But **#159 — a one-line sidebar nav
change — took 4 commits, 2.2 hours, a separate amendment-review PR (#161),
plus a dedicated "cite the TE-11 authorization" commit.** That is the
clearest overdoing signal in the window: process cost is per-PR-constant,
so for a small diff it is ~10× the engineering.

## 2. Measured cost of the verification stack

Measured 2026-07-16 in a fresh cloud session, `redesign` head `d7f3f0b`:

| Step                        | Wall time    | Notes                                                                            |
| --------------------------- | ------------ | -------------------------------------------------------------------------------- |
| `npm ci`                    | **13s**      | warm npm cache                                                                   |
| `npx tsc --noEmit`          | **21s**      |                                                                                  |
| `npm run test` (vitest)     | **11s**      | 94 files, 1,001 tests                                                            |
| `npm run lint`              | **7s**       | 0 errors, 17 pre-existing warnings                                               |
| `npx prettier --check .`    | **12s**      |                                                                                  |
| **Full static gate stack**  | **≈ 60–90s** |                                                                                  |
| ONE focused Playwright spec | **≈ 2min**   | ~90s is Vite dev-server boot, seconds of actual test                             |
| Full e2e (40 spec files)    | **43.6min**  | measured this audit: 39 passed, **3 flaky (passed on retry)**, 7 skipped, exit 0 |

**Conclusion: the static gates are NOT the problem.** Lint + tsc + vitest +
prettier together cost about a minute — cheaper than the judgment call about
whether to skip them. They should run on every PR, always, including
docs-only ones (they'd pass instantly). The costs that matter are:
(a) **full e2e at ~44 minutes — a 44:1 ratio against the whole static
stack** — so "focused specs for touched surfaces" is the single biggest
testing lever; (b) the ~90s dev-server boot paid per Playwright invocation;
and (c) everything that isn't compute: review loops, ceremony PRs, rework,
and per-session context re-derivation. The 3 flaky specs (`legacy-routes`
`/soon` + `/scope` states) are also worth pinning — flaky retries double a
spec's cost and erode trust in red results.

## 3. Findings — where time actually went

### F1. PR ceremony is flat-rate, applied to variable-size work

Every change — 74-file epic or 1-line nav fix — pays the same pipeline:
branch, epic-citation write-up, full gate run, feature→diff traceability
table, review round-trip, roadmap touch. Right for epics; wrong for the
#159/#160/#163-class of small fixes. Governance-authorization _commits_
("Cite E1.3 TE-11…", d3bb146) and standalone amendment-review PRs for
one-line changes are pure overhead — the citation belongs in the PR body.

### F2. e2e's cost is the server boot, and fresh sessions hit a hidden trap

A fresh clone has no `.env`; `npx playwright test` then **silently burns the
full 120s `webServer` timeout and fails** — reproduced in this audit. Anyone
starting e2e work in a new session pays ~2min failure + diagnosis before
learning the two dummy vars fix it. After that, each separate `npx playwright
test <spec>` invocation re-boots the dev server (~90s) unless a dev server is
already running (`reuseExistingServer: true` is configured but only helps if
you _keep one running_).

### F3. Formatting and doc-polish rounds inflate review loops

Commits like "Format provider navigation change" (027f00b) and #165's five
docs-polish commits in 30 minutes are review round-trips that a pre-push
`npm run format` (or hook) would eliminate. Prettier runs in 12s; a review
round costs minutes-to-hours of latency.

### F4. Docs/roadmap refreshes run as standalone full-ceremony PRs

#142, #146, #148, #162 are roadmap/docs-only PRs; two of the four in the
wider window closed unmerged. The ROADMAP-STATUS row-flip for a merged epic
could ride the epic PR itself or one batched docs PR per release.

### F5. Rework: redesign drifts from `main` invariants, then pays recovery PRs

#163 restored an extension-critical invariant (portal-key conflict blocking)
that **already existed on `main`** but was silently lost in the redesign
rebuild; #160 recovered a dead-ended flow; #167 is a full parity _audit_ PR
to find more of these after the fact. Recovery PRs cost the same ceremony as
features and deliver zero new capability. The cheapest fix is upstream:
before rebuilding a surface, port `main`'s tests for that surface first.

### F6. Per-session context re-derivation is a fixed tax

`CLAUDE.md` on `redesign` is **2,308 lines** and is loaded/re-read by every
builder and reviewer session, plus AGENTS.md, the epic, the component guide,
REVIEW-HANDOFF, seed-universe. Meanwhile operational knowledge (mock-harness
recipe) lives as prose even though the `e2e/` suite now embodies it as
runnable fixtures. Fresh sessions also start on a `main`-based branch and
must discover they need `git fetch origin redesign`, `npm ci`, and the dummy
`.env` before anything works.

### F7. The extension repo is cold, and E4.3 (extension handoff) is next

`minted-extension` has **no CLAUDE.md / AGENTS.md at all** (the panel's
2,300-line map has no counterpart) — the next session there starts blind.
The locked wire contracts the extension depends on (bare token keys,
snake_case touches body, `portalTasks` shape) are documented only inside the
panel repo. E4.3 will require coordinated changes in both repos.

## 4. The plan

### P1 — Tier the verification to the diff (keep static gates always-on)

| Tier                 | Applies to                                                                                                      | Run                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T0 docs-only**     | `docs/**`, `*.md` only                                                                                          | prettier + lint + tsc + vitest (≈1min — cheap enough to keep the habit unconditional); **no e2e**                                                    |
| **T1 scoped code**   | components/hooks/services, no schema, no `/api`, no protected files                                             | static stack + vitest + **focused e2e for touched routes only** (see P2 route→spec map)                                                              |
| **T2 cross-cutting** | schema/migrations, `src/server/*`, shared libs (`sopResolver`, `types/index.ts`, `statusLabels`, `tokenFormat`) | T1 + full e2e of dependent surfaces + isolation-gate mock (`node scripts/verify-isolation-local.mjs`) when `/api` is touched + types regen after DDL |

The redesign README's gate 3 already says "e2e passes **when touched surfaces
have coverage**" — this codifies what "focused" means so each session stops
re-deciding it.

### P2 — Kill the e2e boot tax

1. **Bootstrap the env automatically:** commit a `SessionStart` hook (or a
   documented one-liner) that writes the dummy `.env`
   (`VITE_SUPABASE_URL=https://example.supabase.co`,
   `VITE_SUPABASE_ANON_KEY=dummy-anon-key`) when absent, runs `npm ci`, and
   fetches `origin/redesign`. Saves a guaranteed 2-min silent failure plus
   diagnosis in every fresh session. (The host ref must be `example`:
   supabase-js derives the `sb-example-auth-token` storage key the e2e specs
   seed from it — the value CI already uses.)
2. **One dev server per session:** start `npm run dev` once (background) and
   iterate focused specs against it — `reuseExistingServer: true` already
   makes every subsequent `playwright test` invocation skip the ~90s boot.
3. **Maintain a route→spec map** (one table in `docs/redesign/` or a comment
   block in `playwright.config.ts`): touched route/component → owning spec
   file(s). Focused e2e becomes a lookup, not a judgment call.
4. **Never run the full 44-minute suite inside a build session.** Reserve
   full e2e for a scheduled/background run (nightly, or kicked off in the
   background at session start while building) — a PR gates on its focused
   specs; the full sweep catches cross-surface drift asynchronously.
5. **Fix the 3 flaky `legacy-routes` specs** (`/soon` title states, `/scope`)
   — flaky retries double their cost and make red runs ambiguous.

### P3 — Right-size PR ceremony

1. **Patch lane:** small fixes (≲50 changed lines, no schema, no protected
   files, no new deps) skip the standalone amendment-review PR; the epic/TE
   authorization citation goes in the **PR body**, never as extra commits.
   #163 already modeled this well; #159/#161 show the anti-pattern.
2. **Batch docs:** roadmap/status flips ride the epic PR that caused them, or
   one batched docs PR per release milestone — not one ceremony PR per flip.
3. **`npm run format` before every push** (pre-push habit or hook). Eliminates
   the formatting review round entirely for 12 seconds of compute.
4. **Review PRs polish in one pass:** reviewer sessions should compose the
   redlines/enabler section fully, self-review, then push once — five
   incremental doc-polish commits per review PR is review-latency, not rigor.

### P4 — Stop paying the rework tax (biggest 48h loss)

1. Add a standing **main-parity enabler** to every epic that rebuilds a
   `main` surface: enumerate `main`'s tests + invariants for that surface
   (grep `main` for the module and its `.test.ts`), **port the tests first**,
   then build until green. This would have prevented #163 and reduced #167 to
   a formality.
2. When an epic splits into multiple PRs (E4.2 → #157/#158/#164), land the
   **pure-lib + tests PR first** (fast to review, anchors the contract), UI
   after — reduces review-fix commits like c1e19e5/bf83d2a.

### P5 — Context diet

1. **CLAUDE.md → map + pointers, target <800 lines.** Move incident
   chronicles and superseded-decision history into `docs/` (e.g.
   `docs/decisions/`), keep only current architecture, live gotchas, and
   links. Every one of the ~15 agent sessions per 48h re-reads this file.
2. **Replace the prose mock-harness recipe with a pointer to the `e2e/`
   fixtures** that now embody it (they are the runnable source of truth).
3. Add a short **`docs/VERIFY.md`**: the tier table (P1), the env bootstrap,
   the route→spec map location, the sandbox chromium path, and the isolation
   gate commands — one page a session reads instead of re-deriving.

### P6 — Warm up the extension repo before E4.3

1. Write a **compact extension CLAUDE.md** (~150 lines): sidepanel/content
   script architecture, build commands (`build`, `typecheck`, `lint`,
   `test`), and — critically — the **locked wire contracts** with the panel
   (bare token keys, snake_case touches body, `portalTasks`, idempotency
   semantics), mirrored from the panel docs so neither session re-derives the
   other's contract.
2. Apply the same tier table (its static stack is even cheaper).
3. For E4.3, prefer **one session with both repos attached** (this
   environment already has both) over two sessions coordinating through PR
   descriptions — the contract lives in one context.

## 5. Quick-wins checklist (do these first, ~1 hour total)

- [ ] Commit the `.env`-bootstrap / `npm ci` / fetch-redesign SessionStart
      hook (P2.1) — saves ~5 min + a guaranteed trap per session.
- [ ] Add `docs/VERIFY.md` with the tier table and route→spec map (P1, P2.3).
- [ ] Adopt "format before push" + "authorization citations in PR body"
      (P3.1, P3.3) — zero setup, immediate loop savings.
- [ ] Add the main-parity enabler line to the epic template §5 (P4.1).
- [ ] Draft the extension CLAUDE.md before the E4.3 build session (P6.1).
- [ ] Schedule the CLAUDE.md diet as the _last_ lane of a session that's
      already the day's CLAUDE.md owner (per the shared-state rule).

## What NOT to change

- **Keep the static gate unconditional** — at ~1 minute total it is cheaper
  than deciding to skip it, and it caught real review findings this window.
- **Keep the unit-heavy test pyramid** — 1,001 tests in 11s is an excellent
  asset; keep pushing logic into pure `src/lib/*` modules tested there.
- **Keep the epic review process for epics** — the review PRs demonstrably
  caught scope and contract issues; the change is exempting small fixes, not
  weakening epic review.
- **Keep the isolation gate as stop-ship** — it is the tenant-safety wall and
  ran zero excess times this window (no `/api` surface changed).

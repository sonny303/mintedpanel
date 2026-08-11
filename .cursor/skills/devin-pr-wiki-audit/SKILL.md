---
name: devin-pr-wiki-audit
description: >-
  Devin daily audit of Minted Panel and Minted Extension PRs created in the
  last 24 hours — confirm merge/resolution status, verify review threads are
  fully resolved, and update deep wiki docs so product behavior stays accurate.
  Use when asked to review recent PRs, close the day, sync wiki after merges,
  confirm PRs are merged and resolved, or keep docs/wiki current with shipped
  product changes.
---

# Devin — 24h PR status + deep wiki sync

You are **Devin**, Minted Panel reviewer and **wiki owner** (`docs/wiki/`).
Run this skill end-to-end for a last-24-hours audit. Prefer the baked-in
context below over re-reading `CLAUDE.md` / epics unless a PR is schema-heavy
or crosses a trust boundary.

| Repo | GitHub | Docs |
| ---- | ------ | ---- |
| Panel | `sonny303/mintedpanel` | `docs/wiki/*.md` (source) → `npm run wiki:build` → `docs/wiki/site/` + `public/wiki/` (`/wiki/`) |
| Extension | `sonny303/minted-extension` | No wiki; Train/Work/fill/capture/touches → panel wiki pages |

**Base = `main`** (redesign branch retired). Never self-merge. Never invent
hosted-ops green.

Progressive disclosure (read these; do not re-derive):

| File | When |
| ---- | ---- |
| [references/product-snapshot.md](references/product-snapshot.md) | Always — IA, vocabulary, what “product does” means |
| [references/wiki-page-map.md](references/wiki-page-map.md) | Always — path globs → wiki pages + skip rules |
| [references/gh-recipes.md](references/gh-recipes.md) | Always — copy-paste `gh` one-shots |
| [references/report-template.md](references/report-template.md) | Final reply only |

---

## Efficiency rules (do these)

1. **One inventory pass, then triage** — use the recipes in `gh-recipes.md`;
   do not open every PR in the browser first.
2. **Classify from `files` + title before reading the full diff.** Only open
   `gh pr diff` for PRs that map to a wiki page or look product-facing.
3. **Wiki gap test is coordinator surprise**, not “every file mentioned.”
   Pure CI/test/skill/chore → `no wiki` (see skip list).
4. **Parallelize** panel + extension inventory; parallelize thread GraphQL per
   open/merged PR in the window.
5. **Do not** re-read whole `CLAUDE.md` / epic files for this audit unless the
   PR adds migrations, `/api` contracts, or auth/RLS/PHI.
6. **Batch wiki edits** into one follow-up PR:
   `docs(wiki): sync after <PR list> (24h audit)`.
7. If inventory is empty → report `ALL CLEAR` with empty tables; do not invent
   work.

---

## Goal

1. Every PR **created** in the last 24h (both repos) — status known.
2. Every PR **merged** in the window (even if created earlier) — wiki checked.
3. **Fully resolved** = intended outcome + CI understood + **all review
   threads resolved** + wiki matches shipped UX when product-facing.
4. Open draft waiting on PM = `open-waiting` (not fully resolved; not a doc bug).

---

## Procedure

### 1–2. Window + inventory

Run the **Inventory** recipe in [references/gh-recipes.md](references/gh-recipes.md).
Dedupe by repo+number. Sort by `createdAt` ascending in the report.

### 3. Per-PR deep-dive (only when needed)

Always fetch for each inventoried PR:

- `state`, `isDraft`, `baseRefName` (must be `main`), `mergedAt` / `closedAt`
- `statusCheckRollup` (failing check **names**)
- GraphQL `reviewThreads` → any `isResolved: false` blocks `merged-clean`

| Label | Criteria |
| ----- | -------- |
| `merged-clean` | Merged to `main`; checks green or explained; threads resolved; wiki OK or N/A |
| `merged-wiki-gap` | Merged cleanly but wiki stale/wrong for shipped behavior |
| `open-blocking` | Failing CI, unresolved threads, conflicts, wrong base |
| `open-waiting` | Healthy open/draft awaiting human/PM merge |
| `closed-intentional` | Closed unmerged with explicit reason |
| `closed-unclear` | Closed unmerged, no disposition |

Lane hints (branch name → expectations):

| Pattern | Lane | Notes |
| ------- | ---- | ----- |
| `EX.X:…` title / epic branch | Epic | FR trace in body; wiki often in same PR |
| `cursor/3m-…` | 3M | Draft; PM merges; wiki if UX/API changed |
| `cursor/…-dc2b` | Cloud agent | Same as 3M unless titled docs-only |
| `claude/…` | Builder | Devin reviews; never self-merge |

Panel CI to name in notes: `format`, `typecheck`, `lint`, `lint:epics`,
`test`, `build`, `migration dry-run`; isolation gate on `/api` deploys.
Extension: `typecheck`, `lint`, `test`.

### 4. Diff → wiki (fast path)

```text
files / title  →  wiki-page-map globs  →  candidate pages
read only those docs/wiki/*.md headers (_Updated for:) + sections the PR touches
gap?  →  edit + wiki:build  →  else mark current
```

Coordinator questions (any “no” / “yes surprise” ⇒ gap):

1. Does the page still describe **shipped** behavior on `main`?
2. Is `_Updated for:` current enough to find this change?
3. Would a coordinator using only the wiki do the wrong thing?

### 5. Close wiki gaps

- Edit `docs/wiki/<page>.md` only (user-facing). Bump `_Updated for:`
  (epic and/or `PR #N, YYYY-MM-DD`).
- Write **shipped** behavior in coordinator language (see product-snapshot).
- Mark unmerged work _(lands with …)_ — never as live.
- `npm run wiki:build` in the same PR; new pages → `PAGE_ORDER` in
  `scripts/build-wiki-site.mjs`.
- Do **not** edit epic files / `CLARIFICATIONS_NEEDED.md` / apply hosted
  migrations in this skill unless the user explicitly asks.

### 6. Report

Fill [references/report-template.md](references/report-template.md).

- `ALL CLEAR` — every window PR is `merged-clean` or `closed-intentional`,
  wiki matches product
- `ACTION REQUIRED` — any `open-blocking`, `merged-wiki-gap`, or `closed-unclear`
  (`open-waiting` alone ⇒ ACTION REQUIRED with waiting list, unless user asked
  only for merge confirmation of already-merged PRs)

---

## Hard rules

- Never self-merge; never resolve threads by ignoring them.
- Never claim wiki current without reading the mapped page against the diff.
- Cross-repo `/api` changes: panel wiki + call out extension consumers.
- Ops residual (hosted migration, vault key, portal seed, UAT) ≠ docs done.
- `gh` auth failure → stop; do not invent PR states.

## Triggers

“review PRs from the last 24 hours” · “confirm PRs merged and resolved” ·
“sync the deep wiki” · “Devin daily PR/wiki audit” · “caught up on docs after
today’s merges”

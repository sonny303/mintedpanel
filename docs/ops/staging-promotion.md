# Staging branch and promotion flow

How code moves from feature work through the `staging` integration branch to
`main` (production). Companion infrastructure plan for hosted environments:
the retired `docs/staging-environment-plan.md` on branch
`claude/minted-panel-staging-env-wlvy0e` (Supabase + Vercel spine — separate
from this git-branch workflow).

---

## Branches

| Branch      | Role                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `main`      | Production. Vercel production deploy + hosted Supabase (`openpanel`). |
| `staging`   | Integration / UAT. Staging Vercel project tracks this branch.         |
| `feature/*` | Short-lived work. Open PRs against `staging`, not `main`.             |

The old `redesign` long-lived branch was **retired 2026-07-21** — do not
recreate it. `staging` is the new integration spine.

---

## Promotion flow

```
feature/*  ──PR──►  staging  ──PR──►  main
   │                    │                 │
   │                    │                 └── production deploy
   │                    └── staging deploy (UAT)
   └── CI on PR (same gates as main)
```

### 1. Feature → staging

1. Branch off `staging` (or rebase onto it before opening the PR).
2. Open a PR targeting **`staging`**, not `main`.
3. CI must be green (`build`, `Migration dry-run`, `Playwright smoke`).
4. Reviewer/PM merges — **never self-merge**.

### 2. Staging soak (UAT)

1. Merge to `staging` triggers the staging Vercel deploy.
2. Apply any new Supabase migrations to the **staging** project first (manual
   today — see [`repo-workflow.md`](./repo-workflow.md) § Human-only ops).
3. PM runs UAT on the staging URL; extension staging build points here.

### 3. Staging → main (production promotion)

1. When UAT passes, open a PR **`staging` → `main`**.
2. Same CI gates apply.
3. PM merges after review — this is the production release.
4. Apply migrations to hosted production Supabase after merge (operator step).

### Fast fixes

Hotfixes that cannot wait for a full staging soak may branch off `main` and
PR directly to `main` with explicit PM approval. Do not make that the default.

---

## Bootstrapping `staging`

The `staging` branch is created **once** from the current `main` tip. The
workflow is idempotent — it checks whether `staging` already exists before
creating anything.

### Automated (preferred)

1. Merge the `ensure-staging-branch` workflow to `main`.
2. In GitHub → **Actions** → **Ensure staging branch** → **Run workflow**.
3. Confirm `staging` appears under branches and protection matches `main`.

### Local / script

```bash
export GITHUB_TOKEN=<token with repo admin>
export GITHUB_REPOSITORY=sonny303/mintedpanel
node scripts/ensure-staging-branch.mjs
```

Re-sync protection after `main` rule changes:

```bash
node scripts/ensure-staging-branch.mjs --mirror-protection
```

---

## Branch protection

`staging` mirrors `main`:

- Require a pull request before merging
- Require status checks to pass (`build`, `Migration dry-run`, `Playwright smoke`)
- No direct pushes (writers merge via PR)

Re-run the ensure workflow with **mirror protection only** after any `main`
protection change.

---

## CI surfaces

| Workflow                                      | Runs on                           |
| --------------------------------------------- | --------------------------------- |
| `.github/workflows/ci.yml`                    | PRs; push to `main` and `staging` |
| `.github/workflows/verify-org-isolation.yml`  | Production deploy + manual        |
| `.github/workflows/ensure-staging-branch.yml` | Manual bootstrap only             |

---

## Quick links

| Doc                                                                | Role                           |
| ------------------------------------------------------------------ | ------------------------------ |
| [`repo-workflow.md`](./repo-workflow.md)                           | Write/merge rules (both lanes) |
| [`3m-uat-readiness-checklist.md`](./3m-uat-readiness-checklist.md) | Hosted UAT sign-off            |
| [`AGENTS.md`](../../AGENTS.md)                                     | Binding coding rules           |

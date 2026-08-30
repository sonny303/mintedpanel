# Branching and promotion — Minted Panel

Three-tier deployment model for `sonny303/mintedpanel`:

| Branch       | Deploy target          | Role                   |
| ------------ | ---------------------- | ---------------------- |
| `main`       | Vercel production      | Production             |
| `staging`    | Vercel staging project | Integration / UAT      |
| feature `/*` | Vercel preview per PR  | Development and review |

`vercel.json` in this repo is `{}` — branch-to-environment mapping lives in
the Vercel dashboard (Settings → Git → Production Branch). Confirm the staging
Vercel project's production branch is `staging`, not `main`.

Do **not** revive the retired `redesign` branch as a merge target (retired
2026-07-21, #232).

---

## Promotion flow

```
feature/*  ──PR──►  staging  ──PR──►  main
   │                    │                 │
   │                    │                 └── production (mintedpanel.vercel.app)
   │                    └── staging deploy (UAT)
   └── Vercel preview deploy on PR
```

### 1. Feature → staging

1. Branch off `staging` (or rebase onto `origin/staging` before opening the PR).
2. Open a PR targeting **`staging`**, not `main`.
3. CI must pass: `build`, `Migration dry-run`, `Playwright smoke`.
4. Reviewer/PM merges — **never self-merge**.
5. Vercel preview deploy on the PR is for developer review; the staging
   environment deploy fires on merge to `staging`.

### 2. Staging validation (UAT)

1. Verify on the staging URL after merge.
2. Apply new Supabase migrations to the **staging** Supabase project first
   (manual today — see [`docs/ops/repo-workflow.md`](./ops/repo-workflow.md)).
3. PM signs off before production promotion.

### 3. Staging → main

1. Open a PR **`staging` → `main`** titled e.g. `promote: staging → main (YYYY-MM-DD)`.
2. Same CI gates apply.
3. PM merges after review — this is the production release.
4. Apply migrations to hosted production Supabase after merge (operator step).

### Rules

- **No direct commits** to `main` or `staging` — PR only.
- Hotfixes follow the same path (feature → staging → main). Do not short-circuit
  staging without explicit PM approval.

---

## Branch protection

`staging` must mirror `main`:

- Require at least 1 PR review before merge
- Require status checks: `build`, `Migration dry-run`, `Playwright smoke`
- No direct pushes

### Bootstrap (admin only)

Verified 2026-08-30: `staging` exists at the same SHA as `main` but
`protected: false`. Neither `main` nor `staging` had rulesets configured.
The cloud-agent `gh` token cannot read or write branch protection (`403`).

**Option A — automated (after merging `ensure-staging-branch` workflow):**

Actions → **Ensure staging branch** → Run workflow. Re-run with **mirror
protection only** whenever `main` protection changes.

**Option B — script (repo admin PAT):**

```bash
export GITHUB_TOKEN=<admin PAT>
export GITHUB_REPOSITORY=sonny303/mintedpanel
node scripts/ensure-staging-branch.mjs
```

**Option C — GitHub UI:** Settings → Branches → Add rule for `staging` with
the same settings as `main`.

**Option D — `gh` one-liner (admin PAT):**

```bash
gh api -X PUT repos/sonny303/mintedpanel/branches/staging/protection \
  -f required_pull_request_reviews[dismiss_stale_reviews]=false \
  -f required_pull_request_reviews[require_code_owner_reviews]=false \
  -f required_pull_request_reviews[required_approving_review_count]=1 \
  -f enforce_admins=false \
  -f restrictions=null \
  -f required_status_checks[strict]=true \
  -f 'required_status_checks[contexts][]=build' \
  -f 'required_status_checks[contexts][]=Migration dry-run' \
  -f 'required_status_checks[contexts][]=Playwright smoke'
```

When `main` protection is enabled later, mirror the same settings onto
`staging` immediately.

---

## Creating `staging` (if missing)

The `scripts/ensure-staging-branch.mjs` script is idempotent:

1. Checks whether `staging` exists — skips create if it does.
2. Creates from current `main` tip if missing.
3. Mirrors `main` branch protection onto `staging`.

As of 2026-08-30, `origin/staging` already exists and matches `main`
(`dffc60a`). No branch creation is needed.

---

## Related docs

| Doc                                                   | Role                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| [`docs/ops/repo-workflow.md`](./ops/repo-workflow.md) | Lane rules, merge gates, human-only ops              |
| [`AGENTS.md`](../AGENTS.md)                           | Binding coding rules                                 |
| Extension `CLAUDE.md`                                 | Same promotion shape when extension `staging` exists |

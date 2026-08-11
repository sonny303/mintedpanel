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

You are **Devin**, the reviewer/wiki owner for Minted Panel. Run this skill end
to end when asked to audit the last 24 hours of PR activity.

Repos in scope:

| Repo | GitHub | Wiki / product docs |
| ---- | ------ | ------------------- |
| Panel (primary) | `sonny303/mintedpanel` | `docs/wiki/*.md` (source of truth) + `npm run wiki:build` |
| Extension | `sonny303/minted-extension` | No `docs/wiki/`; note Workbench behavior in panel wiki when Train/Work/fill/capture/touches change |

Base branch for both: **`main`**. Never self-merge. Never invent green for hosted ops.

Progressive disclosure:

| File | When |
| ---- | ---- |
| [references/wiki-page-map.md](references/wiki-page-map.md) | Always — map code surfaces → wiki pages |
| [references/report-template.md](references/report-template.md) | Always — paste this shape into the final reply |
| Panel `docs/wiki/README.md` | Wiki ownership + update rules |
| Panel `docs/ops/repo-workflow.md` | Merge gates, lanes, human-only ops |

---

## Goal

1. List every PR **created** in the last 24 hours on both repos.
2. Confirm each PR's **status** (open / draft / merged / closed).
3. Confirm each is **fully resolved** (review threads + CI + merge outcome).
4. For every **merged** PR, confirm **deep wiki** reflects what the product now
   does — and open a follow-up doc PR (or push wiki commits on an allowed branch)
   when it does not.

"Fully resolved" means: intended outcome reached (merged or intentionally closed),
CI green at merge (or failures explained), **no unresolved review threads**, and
wiki/product docs match shipped behavior. An open draft awaiting PM is **not**
fully resolved — report it as blocked/waiting.

---

## Procedure

### 1. Time window

```bash
SINCE=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)
echo "Window start (UTC): $SINCE"
```

Use GitHub's `created:` filter (creation time), not `updated:`. Also scan PRs
**merged** in the window even if created earlier — they still need wiki sync.

### 2. Enumerate PRs (both repos)

```bash
for REPO in sonny303/mintedpanel sonny303/minted-extension; do
  echo "=== $REPO created ==="
  gh pr list --repo "$REPO" --state all --limit 50 \
    --json number,title,url,state,isDraft,createdAt,mergedAt,closedAt,author,headRefName,baseRefName \
    --jq --arg since "$SINCE" \
    '[.[] | select(.createdAt >= $since)]'

  echo "=== $REPO merged in window (may predate create) ==="
  gh pr list --repo "$REPO" --state merged --limit 50 \
    --json number,title,url,mergedAt,createdAt,headRefName \
    --jq --arg since "$SINCE" \
    '[.[] | select(.mergedAt != null and .mergedAt >= $since)]'
done
```

Deduplicate by `number` per repo. Sort by `createdAt` ascending in the report.

### 3. Per-PR status deep-dive

For each PR:

```bash
gh pr view <n> --repo <repo> --json \
  state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,\
  comments,url,title,body,files,commits,mergedAt,closedAt,baseRefName,headRefName

# Review threads (must be resolved for "fully resolved")
gh api repos/<owner>/<repo>/pulls/<n>/comments --jq \
  '[.[] | {id, path, line, in_reply_to_id, user: .user.login, body: .body[0:120]}]'

gh api graphql -f query='
  query($owner:String!, $repo:String!, $number:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$number) {
        reviewThreads(first:100) {
          nodes { isResolved isOutdated path comments(first:1){nodes{body author{login}}} }
        }
      }
    }
  }' -f owner=sonny303 -f repo=<mintedpanel|minted-extension> -F number=<n>
```

Classify each PR:

| Status label | Criteria |
| ------------ | -------- |
| `merged-clean` | Merged to `main`; CI green at merge; all review threads resolved |
| `merged-wiki-gap` | Merged cleanly but wiki/product docs missing or stale for the change |
| `open-blocking` | Open with failing CI, unresolved threads, or merge conflicts |
| `open-waiting` | Open/draft, healthy, waiting on PM/human merge (never self-merge) |
| `closed-intentional` | Closed without merge with an explicit reason in comments/body |
| `closed-unclear` | Closed without merge and no clear disposition |

Pin failures with the exact check name / thread path. Do not soft-pass.

### 4. Diff → wiki impact

For each **merged** PR (and any open PR whose docs should land with the merge):

```bash
gh pr diff <n> --repo <repo> --name-only
gh pr view <n> --repo <repo> --json body,title,files
```

Map touched paths to wiki pages using
[references/wiki-page-map.md](references/wiki-page-map.md).

Ask for each impacted page:

1. Does the page still describe **shipped** behavior on `main`?
2. Is the `_Updated for:` line current (epic/PR id + date)?
3. Would a coordinator reading only the wiki misunderstand the product?

If yes to (3) or no to (1)/(2) → **wiki gap**.

### 5. Close wiki gaps (same session when possible)

Wiki rules (`docs/wiki/README.md`):

- Edit markdown under `docs/wiki/` — that is the source of truth.
- Describe shipped behavior only. Mark not-yet-merged work _(lands with …)_.
- Bump `_Updated for:` on every page you change.
- After markdown edits: `npm run wiki:build` so `docs/wiki/site/` and
  `public/wiki/` stay in sync.
- New page → register in `scripts/build-wiki-site.mjs` `PAGE_ORDER` (build fails
  if missing).
- Prefer a dedicated follow-up PR titled like
  `docs(wiki): sync after <PR list> (24h audit)` targeting `main`.
- Extension-only behavior that changes Train/Work/fill/capture/touches still
  updates the **panel** wiki (Cases / Payer Setup / data-definitions as mapped).

Do **not** rewrite epic files or `CLARIFICATIONS_NEEDED.md` in this skill unless
the user explicitly asks. Do not apply hosted migrations.

### 6. Emit the report

Fill [references/report-template.md](references/report-template.md) completely.
End with a single verdict line:

- `ALL CLEAR` — every 24h PR is `merged-clean` or `closed-intentional`, and wiki
  matches shipped product
- `ACTION REQUIRED` — any `open-blocking`, `merged-wiki-gap`, or `closed-unclear`

---

## Hard rules

- Never self-merge; never approve your own bypass of unresolved threads.
- Never claim wiki is current without opening the mapped pages and the PR diff.
- Never document planned behavior as live.
- Cross-repo `/api` contract changes: panel wiki + note extension consumers.
- Human-only ops (hosted migrations, vault key, portal seed, UAT sign-off) stay
  listed as ops residual — not "docs done."
- If `gh` auth fails, stop and report auth gap; do not invent PR states.
---

## Trigger phrases

- "review PRs from the last 24 hours"
- "confirm PRs merged and resolved"
- "sync the deep wiki"
- "Devin daily PR/wiki audit"
- "are we fully caught up on docs after today's merges"

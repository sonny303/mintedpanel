# gh recipes — copy-paste for the 24h audit

Run from any checkout with `gh` auth. Replace nothing unless noted.

## Inventory (both repos, created + merged)

```bash
SINCE=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "SINCE=$SINCE NOW=$NOW"

for REPO in sonny303/mintedpanel sonny303/minted-extension; do
  echo "======== $REPO ========"
  gh pr list --repo "$REPO" --state all --limit 100 \
    --json number,title,url,state,isDraft,createdAt,mergedAt,closedAt,author,headRefName,baseRefName,files \
    --jq --arg since "$SINCE" '
      def slim: {number,title,url,state,isDraft,createdAt,mergedAt,closedAt,
        author: .author.login, head: .headRefName, base: .baseRefName,
        files: [.files[].path][:40]};
      {
        created: [.[] | select(.createdAt >= $since) | slim],
        merged_in_window: [.[] | select(.mergedAt != null and .mergedAt >= $since) | slim]
      }'
done
```

## One-PR status + checks

```bash
REPO=sonny303/mintedpanel   # or minted-extension
N=299
gh pr view "$N" --repo "$REPO" --json \
  state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,\
  url,title,body,files,mergedAt,closedAt,baseRefName,headRefName,author
```

Failing checks only:

```bash
gh pr view "$N" --repo "$REPO" --json statusCheckRollup \
  --jq '[.statusCheckRollup[]
    | select((.conclusion // .state) as $c
      | ($c != null) and ($c | test("SUCCESS|NEUTRAL|skip|SKIP"; "i") | not))
    | {name: (.name // .context), conclusion, state, detailsUrl}]'
```

## Unresolved review threads (GraphQL)

```bash
OWNER=sonny303; REPO=mintedpanel; N=299   # REPO=minted-extension as needed
gh api graphql -f query='
  query($owner:String!, $repo:String!, $number:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$number) {
        reviewThreads(first:100) {
          nodes {
            isResolved isOutdated path
            comments(first:3) {
              nodes { author { login } body }
            }
          }
        }
      }
    }
  }' -f owner="$OWNER" -f repo="$REPO" -F number="$N" \
  --jq '.data.repository.pullRequest.reviewThreads.nodes
    | map(select(.isResolved == false)
      | {path, outdated: .isOutdated,
         preview: .comments.nodes[0].body[0:160],
         by: .comments.nodes[0].author.login})'
```

Empty array ⇒ threads OK for resolution gate.

## Diff names only (wiki triage)

```bash
gh pr diff "$N" --repo "$REPO" --name-only
```

## Wiki rebuild (panel checkout on a docs branch)

```bash
cd /path/to/mintedpanel
npm run wiki:build
git status --short docs/wiki public/wiki
```

## Open follow-up docs PR (after edits)

```bash
git checkout -b cursor/wiki-sync-24h-dc2b   # or lane-appropriate name
git add docs/wiki public/wiki
git commit -m "docs(wiki): sync after 24h PR audit"
git push -u origin HEAD
gh pr create --base main --title "docs(wiki): sync after 24h PR audit" --body "..."
```

Never self-merge.

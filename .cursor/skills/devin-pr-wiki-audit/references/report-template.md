# 24h PR + wiki audit report

Copy into the final reply. Use `none` instead of omitting sections.

```markdown
# 24h PR + wiki audit

- **Window (UTC):** <SINCE> → <NOW>
- **Repos:** sonny303/mintedpanel · sonny303/minted-extension
- **Auditor:** Devin (devin-pr-wiki-audit)
- **Verdict:** ALL CLEAR | ACTION REQUIRED

## PR inventory

| Repo | PR | Title | Created | State | Classification | Notes |
| ---- | -- | ----- | ------- | ----- | -------------- | ----- |
| panel | #N | … | ISO | merged/open/… | merged-clean / … | CI / threads / wiki N/A |

## Resolution checklist

PRs that are not `merged-clean` or `closed-intentional` (include `open-waiting`):

- **panel#N** — reason → owner / next step
- **extension#N** — …
- or `none`

## Merged changes → product understanding

One short coordinator-language paragraph per **merged** PR (what someone does
differently in the app/extension). `none` if no merges.

## Wiki sync

| Page | Needed? | Status | Evidence |
| ---- | ------- | ------ | -------- |
| cases.md | Y/N | current / updated / gap / n/a | PR #… or “no product paths” |
| payer-setup.md | Y/N | … | … |
| groups.md | Y/N | … | … |
| providers.md | Y/N | … | … |
| org-detail.md | Y/N | … | … |
| reporting-center.md | Y/N | … | … |
| data-definitions.md | Y/N | … | … |
| where-did-it-go.md | Y/N | … | … |
| `npm run wiki:build` | Y/N | done / n/a / gap | … |

## Ops residual (not docs)

Hosted migration / vault / portal seed / UAT — or `none`.

## Follow-ups opened this run

- Doc PR URL(s), or `none`
```

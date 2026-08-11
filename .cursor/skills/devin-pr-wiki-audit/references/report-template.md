# 24h PR + wiki audit report

Copy this template into the final reply. Fill every section; use `none` rather
than omitting a table.

```markdown
# 24h PR + wiki audit

- **Window (UTC):** <SINCE> → <NOW>
- **Repos:** sonny303/mintedpanel · sonny303/minted-extension
- **Auditor:** Devin (devin-pr-wiki-audit)
- **Verdict:** ALL CLEAR | ACTION REQUIRED

## PR inventory

| Repo | PR | Title | Created | State | Classification | Notes |
| ---- | -- | ----- | ------- | ----- | -------------- | ----- |
| panel | #N | … | ISO | merged/open/… | merged-clean / … | CI / threads |

## Resolution checklist

For each PR that is not `merged-clean` or `closed-intentional`, one bullet:

- **panel#N** — blocking reason → owner / next step
- **extension#N** — …

## Merged changes → product understanding

One short paragraph per merged PR: what the product does differently now
(coordinator language, not file lists).

## Wiki sync

| Page | Needed? | Status | PR / commit |
| ---- | ------- | ------ | ----------- |
| cases.md | Y/N | current / updated / gap | … |
| payer-setup.md | Y/N | … | … |
| groups.md | Y/N | … | … |
| providers.md | Y/N | … | … |
| org-detail.md | Y/N | … | … |
| reporting-center.md | Y/N | … | … |
| data-definitions.md | Y/N | … | … |
| where-did-it-go.md | Y/N | … | … |
| wiki site rebuild (`npm run wiki:build`) | Y/N | done / n/a / gap | … |

## Ops residual (not docs)

List human-only follow-ups surfaced by the PRs (hosted migration apply, vault
key, portal seed, UAT). `none` if empty.

## Follow-ups opened this run

- Doc PR URL(s), or `none`
```

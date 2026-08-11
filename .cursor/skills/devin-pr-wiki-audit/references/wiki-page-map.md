# Wiki page map — code surfaces → deep wiki

Use this when classifying PR diffs. Prefer the **most specific** page; update
`data-definitions.md` whenever a vocabulary / status / derived pill changes.
Update `where-did-it-go.md` when a route or surface is retired or redirected.

Panel wiki lives at `docs/wiki/`. Extension has no wiki — map Workbench changes
into these panel pages.

| Touch pattern (path / topic) | Wiki page(s) |
| ---------------------------- | ------------ |
| `/cases`, case status, NBA queue, touches, status history, case detail | [cases.md](../../../docs/wiki/cases.md) |
| `caseStatus`, `set_case_status`, eight statuses, denial reasons | [cases.md](../../../docs/wiki/cases.md) + [data-definitions.md](../../../docs/wiki/data-definitions.md) |
| Payer Setup, `/admin/payer-admin`, catalog, SOPs, portals, field registry, Train | [payer-setup.md](../../../docs/wiki/payer-setup.md) |
| Groups hub, facilities, payer network board, attach, enrollment facts | [groups.md](../../../docs/wiki/groups.md) |
| Generation preview/confirm, run history, exclusions, one-door create | [groups.md](../../../docs/wiki/groups.md) + [data-definitions.md](../../../docs/wiki/data-definitions.md) |
| Providers roster/record, licenses, SSN vault UI, readiness, enrollments | [providers.md](../../../docs/wiki/providers.md) |
| Org Detail, People/parties, members, onboarding entry | [org-detail.md](../../../docs/wiki/org-detail.md) |
| Reporting Center, portfolio, denials, launches, audit, leads | [reporting-center.md](../../../docs/wiki/reporting-center.md) |
| Redirects, retired routes, IA moves | [where-did-it-go.md](../../../docs/wiki/where-did-it-go.md) |
| New entity vocabulary, rollups, gap pills, dispositions, ledgers | [data-definitions.md](../../../docs/wiki/data-definitions.md) |

## Extension → wiki

| Extension change | Panel wiki impact |
| ---------------- | ----------------- |
| Fill / capture / Train vs Work mode | payer-setup.md (forms), cases.md (submission close-out) |
| Handoff `SET_ACTIVE_CASE`, case search, NBA | cases.md |
| Touches / `bump_status` / portal submission logging | cases.md + data-definitions.md |
| Field-map propose / shared tier | payer-setup.md |
| Portal recognition / host permissions | payer-setup.md (register/train), where-did-it-go if UX moved |

## Likely **no** wiki change

- Pure test / lint / CI workflow edits with no product behavior change
- Comment-only or typo fixes in non-user-facing code
- Internal agent skills under `.cursor/skills/` (this folder) — optional one-line
  in ops docs only if the PM asks

When unsure: open the walkthrough page a coordinator would use for that job and
ask whether the PR would surprise them. If yes → update.

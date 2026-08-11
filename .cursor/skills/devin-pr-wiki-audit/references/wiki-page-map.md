# Wiki page map — path globs → deep wiki

Prefer the **most specific** page. Always consider `data-definitions.md` when
statuses, pills, dispositions, or entity names change. Always consider
`where-did-it-go.md` when routes redirect or surfaces retire.

Panel: `docs/wiki/`. Extension: no wiki — map into panel pages.

## Fast classify (panel path prefixes)

| Path glob / topic                                                                                                                                                                                               | Wiki page(s)                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/routes/cases*` · `src/components/cases/**` · `src/lib/caseStatus*` · `src/lib/casesView*` · `src/lib/nextBestActions*` · touches / status history                                                          | **cases.md**                                                         |
| `src/routes/admin.payer-admin*` · `src/components/payer-admin/**` · `src/components/templates/**` · `src/lib/fieldRegistry*` · `src/lib/payerSetup*` · `src/lib/payerReadiness*` · portals / field maps / train | **payer-setup.md**                                                   |
| `src/routes/groups*` · `src/components/groups/**` · payer network board · `enrollmentFacts*` · `generation*` · `src/lib/generation*` · `src/lib/caseRollups*`                                                   | **groups.md** (+ data-definitions if dispositions/status vocabulary) |
| `src/routes/providers*` · `src/components/providers/**` · licenses · SSN vault UI · readiness · enrollments panel                                                                                               | **providers.md**                                                     |
| `src/routes/org-detail*` · `src/components/org/**` · `parties*` · People / Access / members                                                                                                                     | **org-detail.md**                                                    |
| `src/routes/reporting*` · `src/components/reporting/**` · `src/lib/reports*` · denials / launches / audit / leads                                                                                               | **reporting-center.md**                                              |
| Redirect tables · `legacy-routes` · deleted surfaces · sidebar IA moves                                                                                                                                         | **where-did-it-go.md**                                               |
| Eight statuses · fulfillment pills · gap pills · generation dispositions · enrollment facts · touch kinds                                                                                                       | **data-definitions.md**                                              |
| `docs/wiki/**` already in PR                                                                                                                                                                                    | Confirm build ran; usually no extra wiki PR                          |

## Extension path prefixes → panel wiki

| Path / topic                                               | Wiki                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/sidepanel/**` · Train/Work mode · capture             | payer-setup.md (forms); cases.md if Work UX                         |
| `src/background/fill*` · `src/content/**` · fill engine    | payer-setup.md + cases.md (fill → submit)                           |
| `src/background/activeCase*` · handoff · case search · NBA | cases.md                                                            |
| touches / submission / `bump_status` messaging             | cases.md + data-definitions.md                                      |
| shared field maps / portals client                         | payer-setup.md                                                      |
| `src/shared/apiTypes.ts` wire shapes                       | wiki only if UX/contract user-visible; else note in report, no wiki |

## Panel `/api` (extension-facing) — wiki when user-visible

| Area                                               | Wiki if…                                       |
| -------------------------------------------------- | ---------------------------------------------- |
| profile / field-maps / portals / shared-field-maps | Train/fill story changes → payer-setup         |
| cases / touches / context / next-best-action       | Casework story changes → cases (+ definitions) |
| view-prefs / documents / ssn-release               | providers or cases only if UI story changes    |

## Skip wiki (mark Needed? = N)

- `.cursor/skills/**`, agent prompts, internal ops markdown (unless PM asks)
- Pure `*.test.ts` / e2e-only with no product copy/behavior change
- Lint/format/CI workflow-only
- Comment-only / typo in non-user-facing code
- Types regen with no behavior change

## Gap decision heuristic

```
product-facing path hit?
  no  → Needed? N
  yes → open mapped wiki section
          coordinator would be wrong/surprised? → gap (edit)
          page already describes new behavior + Updated for current? → current
```

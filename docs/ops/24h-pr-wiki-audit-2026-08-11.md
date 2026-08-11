# 24h PR + wiki audit

- **Window (UTC):** 2026-08-10T03:50 → 2026-08-11T04:30
- **Repos:** sonny303/mintedpanel · sonny303/minted-extension
- **Auditor:** Cloud agent completing the Devin 24h PR/wiki audit skill (#299)
- **Verdict:** ACTION REQUIRED — open PRs are **CI-green and ready to merge** in the order below (human merge; never self-merge). Wiki synced for shipped + landing notes.

## Merge order (do this sequence)

### Panel (`sonny303/mintedpanel`)

| Step | PR                                                       | Title                                               | Why this slot                                                  |
| ---- | -------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| 1    | [#299](https://github.com/sonny303/mintedpanel/pull/299) | Devin 24h PR/wiki audit skill                       | Docs-only; unblocks future audits                              |
| 2    | [#290](https://github.com/sonny303/mintedpanel/pull/290) | BITE-CAP-02 sort_order refresh on shared re-propose | Migration; pairs with extension capture order                  |
| 3    | [#289](https://github.com/sonny303/mintedpanel/pull/289) | BITE-CAP-04 stale fields fill-time copy             | Independent Form Setup UX                                      |
| 4    | [#282](https://github.com/sonny303/mintedpanel/pull/282) | LISTPORTALS browser `listPortals` D6.4              | Small filter; before OPA skill/debt churn                      |
| 5    | [#288](https://github.com/sonny303/mintedpanel/pull/288) | Harden Add Provider                                 | After taxonomy/start-date already on main                      |
| 6    | [#297](https://github.com/sonny303/mintedpanel/pull/297) | BITE-SOP-TT-04 tip (01–03 included)                 | Supersedes closed #293/#295/#296                               |
| 7    | [#285](https://github.com/sonny303/mintedpanel/pull/285) | OPA-RETIRE                                          | Largest product + migration; **last**. Hosted apply = operator |

### Extension (`sonny303/minted-extension`)

| Step | PR                                                          | Title                            | Why this slot                                    |
| ---- | ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| A    | [#43](https://github.com/sonny303/minted-extension/pull/43) | BITE-CAP-03 skip hidden controls | Base of capture stack → `main`                   |
| B    | [#44](https://github.com/sonny303/minted-extension/pull/44) | BITE-CAP-02 field order          | Bases on #43 — merge only after A                |
| C    | [#46](https://github.com/sonny303/minted-extension/pull/46) | BITE-CAP-05 page identity        | Independent of A/B; after CAP-01 already on main |
| D    | [#40](https://github.com/sonny303/minted-extension/pull/40) | TRAIN-DUAL C1 + URL bind         | After capture stack preferred                    |

**Cross-repo pairing:** land panel #290 before or with extension B (#44). Train (#40) can wait until capture A–C are in.

## PR inventory (window)

| Repo  | PR             | Title                     | State      | Classification     | Notes                  |
| ----- | -------------- | ------------------------- | ---------- | ------------------ | ---------------------- |
| panel | #300           | prettier unblock main     | merged     | merged-clean       | Format gate            |
| panel | #298           | format providerTaxonomy   | merged     | merged-clean       | CI unblock             |
| panel | #294           | SOP setup skill           | merged     | merged-clean       | no wiki                |
| panel | #292           | SOP TT spike docs         | merged     | merged-clean       | ops spike              |
| panel | #291           | fuzzy token picker        | merged     | merged-clean       | Form Setup             |
| panel | #287           | facility start_date toast | merged     | merged-clean       | providers wiki synced  |
| panel | #286           | taxonomy dropdown         | merged     | merged-clean       | providers wiki synced  |
| panel | #284           | GEN-SILENT                | merged     | merged-clean       | wiki in PR             |
| panel | #283           | course-correct docs       | merged     | merged-clean       | no wiki                |
| panel | #281           | TRAIN-DUAL spike          | merged     | merged-clean       | ops                    |
| panel | #299           | Devin audit skill         | open ready | open-waiting       | CI green               |
| panel | #297           | SOP-TT-04 tip             | open ready | open-waiting       | CI green; tip of stack |
| panel | #293/#295/#296 | SOP-TT 01–03              | closed     | closed-intentional | Superseded by #297     |
| panel | #290           | CAP-02 sort refresh       | open ready | open-waiting       | CI green               |
| panel | #289           | CAP-04 stale copy         | open ready | open-waiting       | CI green               |
| panel | #288           | Add Provider harden       | open ready | open-waiting       | CI green               |
| panel | #285           | OPA-RETIRE                | open ready | open-waiting       | CI green; hosted mig   |
| panel | #282           | LISTPORTALS               | open ready | open-waiting       | CI green               |
| ext   | #45            | 24h audit doc sync        | merged     | merged-clean       | CLAUDE + skill twin    |
| ext   | #42            | BITE-CAP-01               | merged     | merged-clean       | capture reuse          |
| ext   | #41            | 3m-audit skill twin       | merged     | merged-clean       | no wiki                |
| ext   | #43            | CAP-03                    | open ready | open-waiting       | CI green; base main    |
| ext   | #44            | CAP-02 order              | open ready | open-waiting       | stack on #43           |
| ext   | #46            | CAP-05 identity           | open ready | open-waiting       | CI green               |
| ext   | #40            | TRAIN-DUAL                | open ready | open-waiting       | CI green               |

## Resolution checklist

- **All listed open PRs** — ready for human merge in the order above (CI build + Playwright/ci green as of audit close).
- **OPA #285 / LISTPORTALS #282 / CAP #290** — code merge ≠ hosted migration live; operator apply separately.
- **#275 catalog DELETE** — still needs second PM sign-off (ops residual).

## Merged changes → product understanding

- Generation now **explains** why providers were skipped (`no_facility` /
  `pending_verification`) instead of silently dropping them.
- Add Provider uses a **taxonomy dropdown** (PT + dietitian) and requires a
  **facility start date** with a readable error.
- Form Setup token picker is **fuzzy-searchable**.
- Extension re-capture **reuses** the page step (CAP-01); follow-on capture
  PRs refine visibility, order, and true multi-page identity.

## Wiki sync

| Page                 | Needed? | Status  | Evidence                                          |
| -------------------- | ------- | ------- | ------------------------------------------------- |
| groups.md            | Y       | current | GEN-SILENT in #284                                |
| data-definitions.md  | Y       | current | GEN-SILENT in #284                                |
| providers.md         | Y       | updated | taxonomy / tabs / #288 landing                    |
| payer-setup.md       | Y       | updated | Form Setup + landing CAP/OPA/SOP-TT/Train         |
| cases.md             | N       | n/a     | no window product gap beyond GEN-SILENT elsewhere |
| org-detail.md        | N       | n/a     |                                                   |
| reporting-center.md  | N       | n/a     |                                                   |
| where-did-it-go.md   | N       | n/a     |                                                   |
| `npm run wiki:build` | Y       | this PR |                                                   |

## Ops residual (not docs)

- Hosted apply: OPA-RETIRE migration (#285), CAP-02 propose refresh (#290), #275 purge second sign-off, vault checklist.
- Never claim production-live from repo-green alone.

## Follow-ups opened this run

- This docs PR (`docs(wiki+ops): 24h audit clear — merge order + wiki sync`).
- Panel #299 carries the reusable Devin skill.

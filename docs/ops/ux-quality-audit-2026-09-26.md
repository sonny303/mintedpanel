# UX quality audit — source baseline and ranked repair queue

Baseline: `origin/main` at `2ea77b7` (2026-09-26). This is a source and existing-test review plus read-only inspection of the current `staging.mintedpanel.com` alias with an admin session. The alias's deployed source SHA was not available from the browser. No data was changed or copied into the report.

## Requirements

- On a major page, the user can identify its purpose, next action, and the outcome of that action.
- A failed read must never be presented as an empty record set or a missing record.
- A control must not silently do nothing when its action is unavailable.
- Preserve existing routes, data writes, permissions, design tokens, and domain behavior. Reuse current components; no redesign.
- This `feature/ux-quality-audit-20260926` branch is the combined review index. Each repair gets one small draft PR from the same `main` baseline, linked in the final summary. Repository rules require every PR to target `main`; no PR targets an integration branch. Preview sign-off and merge remain with the owner.

## Workflow coverage

| Journey                                   | Entry and completion checked in source                         | Finding status | Runtime status                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider roster → create → record         | Roster actions, create result/toasts, record read              | UX-03 to UX-05 | Roster loaded in admin staging; UX-05 reproduced with a no-match filter. Create and record not exercised.                                   |
| Groups → hub → facilities                 | Single-group redirect, empty state, breadcrumb, facility list  | UX-01, UX-02   | Admin staging loaded the single-group hub and facilities page; failed-read paths not exercised.                                             |
| Payer Setup → payer detail                | Catalog/readiness loading and error paths                      | No new finding | Admin staging loaded the payer list and one payer detail with a clear Next step action; mutation paths not exercised.                       |
| Cases → detail → task                     | List read failure, detail retry, task retry, mutation feedback | No new finding | Empty cases list loaded in admin staging; detail and task not exercised.                                                                    |
| Reporting Center → billing readiness      | Report entry, source-read failure and retry                    | No new finding | Admin staging passed entry, lookup orientation, Change Feed empty state, and return to Reporting Center. Forced read failure not exercised. |
| Reporting Center → Roster Engine          | Template-list entry and map/export affordances                 | No new finding | Admin staging loaded the template list and showed the draft-schema warning and Map fields actions. Mapping/export not exercised.            |
| Reporting Center → Group Contracts Matrix | Report entry and read-failure recovery                         | UX-06          | Admin staging failed to load the matrix; one Retry returned the same failure.                                                               |
| Facility deactivate                       | Confirmation and mutation feedback inspected                   | No new finding | Staging pending                                                                                                                             |
| Provider create validation                | Required name fields and mutation failure feedback inspected   | No new finding | Staging pending                                                                                                                             |

“No new finding” means this source pass found no issue against the stated heuristics; it is not a runtime pass.

## Ranked findings

Priority ranks user impact; lane ranks change risk. `S` means a small route-level change; `M` means several read dependencies. The highest-impact observed staging blocker is UX-06; UX-01 through UX-05 retain discovery IDs for PR traceability.

| ID    | Rank                            | Evidence                                                                                                                                                                                                                                                       | User consequence                                                                                                   | Size / lane                            | Acceptance criterion                                                                                                                                   |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UX-01 | P1 · high confidence            | `groups.index.tsx` derives `[]` after `useProviderGroups` fails and derives a false `0 facilities` when `useFacilities` fails; `groups.$groupId.tsx` treats a failed group read as “Group not found.”                                                          | Admin is told the organization has no group, that a valid group does not exist, or that a group has no facilities. | S / agent draft PR                     | Both pages distinguish failed group load from true empty/missing state and offer Retry; the list never presents an unavailable facility count as zero. |
| UX-02 | P1 · high confidence            | `GroupFacilitiesContent.tsx` derives empty facilities and zero provider counts from failed queries.                                                                                                                                                            | A group can appear to have no locations or providers, suppressing the Generate cases entry.                        | M / agent draft PR after UX-01         | Failed facility/assignment reads are explicit; no derived zero state is shown until required reads succeed.                                            |
| UX-03 | P1 · high confidence            | `providers.$id.index.tsx` renders “Provider not found” whenever the provider query has no data, including `isError`.                                                                                                                                           | A transient read failure is presented as a deleted or inaccessible provider.                                       | S / agent draft PR                     | Read failure has a distinct message and Retry; actual missing record keeps the current not-found outcome.                                              |
| UX-04 | P1 · high confidence            | `providers.index.tsx` checks only the provider read for error; group, facility assignment, license, and case reads fall back to empty arrays.                                                                                                                  | The roster can display false zero counts, missing groups/licenses, or misleading gaps.                             | M / human product review               | Agree which derived columns fail closed together before changing the page.                                                                             |
| UX-05 | P2 · high confidence            | `providers.index.tsx` shows Export roster with zero matching rows; `handleExportRoster` returns without feedback. Admin staging reproduced: a no-match search left Export enabled and clicking it showed no change.                                            | The primary export control can appear broken after filtering.                                                      | S / agent draft PR                     | Export is visibly unavailable with zero matches and works for one or more matches.                                                                     |
| UX-06 | P1 · high confidence in symptom | Admin staging `/reporting/contracts-matrix` displayed “Failed to load group contracts matrix”; Retry repeated the failure. The source correctly exposes an error state when the group, payer, or contract read fails, but the failing source was not isolated. | Admin cannot use this report in the observed staging session.                                                      | Hosted/source diagnosis / human review | Identify the failing read and deployed source/schema/ACL state; restore the report, then verify with a synthetic admin without changing customer data. |

## Review queue: smallest repair to human review

| Order | Finding | Review unit                                                       | Decision                                                                             |
| ----- | ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1     | UX-05   | [Draft PR #434](https://github.com/sonny303/mintedpanel/pull/434) | Small export availability fix.                                                       |
| 2     | UX-03   | [Draft PR #435](https://github.com/sonny303/mintedpanel/pull/435) | Provider read failure recovery.                                                      |
| 3     | UX-01   | [Draft PR #433](https://github.com/sonny303/mintedpanel/pull/433) | Group read failure recovery.                                                         |
| 4     | UX-02   | [Draft PR #436](https://github.com/sonny303/mintedpanel/pull/436) | Facility and assignment read recovery; review after UX-01.                           |
| 5     | UX-04   | Human product review                                              | Choose partial roster with explicit unavailable values or a full-page failure state. |
| 6     | UX-06   | Hosted diagnosis / human review                                   | Isolate the failed staging read before any repair or release decision.               |

Every repair PR targets `main` from the same baseline. Independent Astra review checks each exact diff and test evidence. Preview sign-off and merge remain with the owner.

## Staging qualification still needed

- Identify the served source SHA of the current Vercel staging alias; the browser did not expose it.
- Verify billing-readiness error feedback with a safe synthetic failure scenario; normal admin entry and return passed.
- Diagnose the persistent Group Contracts Matrix read failure against the current hosted target before proposing a repair or release step.
- Owner preview/UAT sign-off for changed journeys after the draft PRs are ready.

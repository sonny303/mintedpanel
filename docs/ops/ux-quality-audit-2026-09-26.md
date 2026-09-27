# UX quality audit — source baseline and ranked repair queue

Baseline: `origin/main` at `2ea77b7` (2026-09-26). This is a source and existing-test review. The public staging alias responded, but authenticated admin reporting remains unverified until a synthetic admin signs in. No production or customer data was used.

## Requirements

- On a major page, the user can identify its purpose, next action, and the outcome of that action.
- A failed read must never be presented as an empty record set or a missing record.
- A control must not silently do nothing when its action is unavailable.
- Preserve existing routes, data writes, permissions, design tokens, and domain behavior. Reuse current components; no redesign.
- This `feature/ux-quality-audit-20260926` branch is the combined review index. Each repair gets one small draft PR from the same `main` baseline, linked in the final summary. Repository rules require every PR to target `main`; no PR targets an integration branch. Preview sign-off and merge remain with the owner.

## Workflow coverage

| Journey | Entry and completion checked in source | Finding status | Runtime status |
| --- | --- | --- | --- |
| Provider roster → create → record | Roster actions, create result/toasts, record read | UX-03 to UX-05 | Synthetic browser tests exist; staging pending |
| Groups → hub → facilities | Single-group redirect, empty state, breadcrumb, facility list | UX-01, UX-02 | Synthetic browser tests exist; staging pending |
| Payer Setup → payer detail | Catalog/readiness loading and error paths | No new finding | Staging pending |
| Cases → detail → task | List read failure, detail retry, task retry, mutation feedback | No new finding | Staging pending |
| Reporting Center → billing readiness | Report entry, source-read failure and retry | No new finding | Admin staging pending |
| Facility deactivate | Confirmation and mutation feedback inspected | No new finding | Staging pending |
| Provider create validation | Required name fields and mutation failure feedback inspected | No new finding | Staging pending |

“No new finding” means this source pass found no issue against the stated heuristics; it is not a runtime pass.

## Ranked findings

Priority ranks user impact; lane ranks change risk. `S` means a small route-level change; `M` means several read dependencies.

| ID | Rank | Evidence | User consequence | Size / lane | Acceptance criterion |
| --- | --- | --- | --- | --- | --- |
| UX-01 | P1 · high confidence | `groups.index.tsx` derives `[]` after `useProviderGroups` fails and derives a false `0 facilities` when `useFacilities` fails; `groups.$groupId.tsx` treats a failed group read as “Group not found.” | Admin is told the organization has no group, that a valid group does not exist, or that a group has no facilities. | S / agent draft PR | Both pages distinguish failed group load from true empty/missing state and offer Retry; the list never presents an unavailable facility count as zero. |
| UX-02 | P1 · high confidence | `GroupFacilitiesContent.tsx` derives empty facilities and zero provider counts from failed queries. | A group can appear to have no locations or providers, suppressing the Generate cases entry. | M / agent draft PR after UX-01 | Failed facility/assignment reads are explicit; no derived zero state is shown until required reads succeed. |
| UX-03 | P1 · high confidence | `providers.$id.index.tsx` renders “Provider not found” whenever the provider query has no data, including `isError`. | A transient read failure is presented as a deleted or inaccessible provider. | S / agent draft PR | Read failure has a distinct message and Retry; actual missing record keeps the current not-found outcome. |
| UX-04 | P1 · high confidence | `providers.index.tsx` checks only the provider read for error; group, facility assignment, license, and case reads fall back to empty arrays. | The roster can display false zero counts, missing groups/licenses, or misleading gaps. | M / human product review | Agree which derived columns fail closed together before changing the page. |
| UX-05 | P2 · high confidence | `providers.index.tsx` shows Export roster with zero matching rows; `handleExportRoster` returns without feedback. | The primary export control can appear broken after filtering. | S / agent draft PR | Export is visibly unavailable with zero matches and works for one or more matches. |

## Repair order and handoff

1. UX-01, UX-03, UX-05 are independent low-risk slices. Each targets `main`; they do not share a write surface.
2. UX-02 follows UX-01 to keep the group failure-state design coherent.
3. UX-04 needs a product decision about whether a partial roster should remain visible with explicit column-level unavailable states, or the entire roster should fail closed.
4. Independent Astra review checks each exact diff and test evidence. Sol repairs on the same branch. Do not merge or deploy from this queue.

## Staging qualification still needed

- Identify the current Vercel staging deployment and served source SHA, then sign in with a synthetic admin account.
- Verify Reporting Center orientation, report entry, billing-readiness load/error feedback, and return path.
- Owner preview/UAT sign-off for changed journeys after the draft PRs are ready.

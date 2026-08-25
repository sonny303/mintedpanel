# Cases Matrix — Build Handoff

**For:** Devin
**Branch off:** `main` · **PR targets:** `main` · never self-merge
**Status:** requirements locked 2026-08-25. Every open question in the original
spec has been decided — they are recorded in §1 so you do not have to re-derive
them.

Read `AGENTS.md` first (binding rules), then `CLAUDE.md` § Layering. This
document supersedes the requirements doc wherever they disagree; §2 lists the
places they disagree and why.

---

## 0. What you are building, in one paragraph

A fourth view on the existing `/cases` route, reached at `?pivot=matrix`,
alongside the current Flat / By provider / By payer views. It renders a
provider × payer grid, sectioned by group + state, where each cell is either a
real case (status chip, clicks through to the case), a gap (no case yet — links
out to `/generation`), or an excluded combination (dash, inert). It is
**read-only**: nothing is written from this screen — no editing, no touch
logging, and no case creation (a gap cell navigates to the existing generation
door rather than creating anything itself).

**Do not replace the existing `/cases` list.** `/`, `/home`, `/work`,
`/welcome` and `/admin/statuses` all redirect into `/cases`, and the route
carries the deadline-ranked default sort, the `?runId=` / `?ids=` / `?chip=`
contracts other flows navigate into, and `ManualCaseModal` — one of only five
files allowed to create a case, pinned by `src/lib/oneDoor.test.ts`. Adding a
pivot touches none of that.

---

## 1. Locked decisions

These were open questions in the requirements doc. They are now answered. Build
to these, not to the doc's recommendations.

| #   | Decision                | Value                                                                                                             |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1  | Provider eligibility    | `status !== 'terminated' && !referenceOnly && !isTestProvider(p) && verificationState !== 'pending_verification'` |
| D2  | Section identity        | One section = **one group + one state**                                                                           |
| D3  | `Group by` control      | Options `State` (default) and `Group` — picks section **nesting**, not section identity                           |
| D4  | Row set                 | Providers with **≥1 case** in that (group, state). Not candidates.                                                |
| D5  | Column set              | Payers with an **active `payer_network_targets` row** for that (group, state)                                     |
| D6  | Cell kinds              | `case` · `gap` · `excluded` — **exactly three**                                                                   |
| D7  | Enrollment facts        | **Not read.** This is an active-cases matrix, not an enrollment matrix.                                           |
| D8  | Filters                 | Search · State · Status · Payer · Group by. **No Group filter** — sections already name the group.                |
| D9  | Popover Coordinator row | **Dropped from v1** (`assigned_to` is NULL on every case in every org today)                                      |
| D10 | Overdue definition      | Match the app: **due today counts as overdue**                                                                    |
| D11 | Surface                 | Fourth pivot on `/cases` (`?pivot=matrix`), not a replacement                                                     |
| D12 | Orphaned `MatrixTab`    | **Leave it alone.** Deleting `src/components/reports/MatrixTab.tsx` is a separate cleanup PR.                     |
| D13 | Gap cell action         | Deep-links to `/generation` pre-scoped. **No case is created from the Matrix.** See §4.7.                         |

### Why D2 matters most

A case is keyed `UNIQUE NULLS NOT DISTINCT (provider_id, group_id, payer_id, state)`.
A section pinning group + state, rows pinning provider, and columns pinning payer
together determine **all four parts of that key**. That is what makes "one cell =
one case" true by construction rather than by hope.

This is not theoretical. **Kansas Fitness Physio has 8 of its 10 providers in two
groups that target the identical 5 payers in KS** (the second group is a rename
artifact: "…formerly known as Mowery Rehab Consultants, P.A."). Kansas renders as
**two sections**, one per group. If you collapse group out of the section
identity, those two groups' cases land in the same cell.

### What `Group by` actually does

It reorders and re-nests sections. It never changes which sections exist.

```
Group by: State  (default — matches the mock)

  WISCONSIN · WI
  └ BEST Physical Therapy P.A.    9 providers · 44 open
     [ provider × payer grid ]

  ALASKA · AK
  └ BEST Physical Therapy P.A.    5 providers · 19 open
     [ provider × payer grid ]

Group by: Group

  BEST PHYSICAL THERAPY P.A.
  └ WI    9 providers · 44 open
     [ provider × payer grid ]
  └ AK    5 providers · 19 open
     [ provider × payer grid ]
```

---

## 2. Corrections to the requirements doc

The requirements doc states four things about the current system that are wrong.
Build to this column, not to the doc.

| Doc says                                                      | Reality                                                                                                                               | Build    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| §3.1 "use strict `status === 'active'`"                       | 18 of 20 providers on hosted are `onboarding`; they hold 31 of 32 cases. Strict `active` renders an **empty Matrix** for 2 of 3 orgs. | D1       |
| §5.1 overdue is "`dueDate < today`; due today is not overdue" | `src/lib/actionState.ts:50` uses `differenceInCalendarDays(now, due) >= 0` — **due today counts**.                                    | D10      |
| §7 "no HoverCard — use Popover" for everything                | `src/components/ui/tooltip.tsx` exists. Use **Tooltip** for gap/excluded; Popover only for the rich case card.                        | §5 below |
| §13 Q3 "parity with Today's queue filters"                    | There is no such surface. `/work` and `/home` redirect into `/cases`; neither has filters.                                            | D8       |

Two more deviations you should know are deliberate:

- **§3.4's `enrolled` case is not implemented** (D7). A combination covered by a
  live `enrollment_facts` row with no case will render as an ordinary gap. This
  was raised and accepted — the Matrix is scoped to cases.
- **§7.3's Coordinator row is omitted** (D9).

---

## 3. Data — read this before writing the hook

### 3.1 Everything you need is already in cache

`/cases` already calls `useNextBestActions()`
(`src/routes/cases.index.tsx:119`), which composes fourteen org-scoped queries.
Cross-referenced against the Matrix's needs:

| Need                    | Hook                            | Already on the route?       |
| ----------------------- | ------------------------------- | --------------------------- |
| Cases                   | `useCases()`                    | ✅                          |
| Payers                  | `usePayers()`                   | ✅                          |
| Providers               | `useProviders()`                | ✅                          |
| Payer network targets   | `usePayerNetworkTargets()`      | ✅ via `useNextBestActions` |
| Provider groups         | `useProviderGroups()`           | ✅ via `useNextBestActions` |
| Tasks (red dot)         | `useQueueTaskRows()`            | ✅ via `useNextBestActions` |
| Follow-ups + last touch | `useFollowUpsDue()`             | ✅ via `useNextBestActions` |
| Next-action text        | `useNextBestActions()`          | ✅                          |
| **Exclusions**          | `useCaseGenerationExclusions()` | ❌ **one new query**        |

**Marginal data cost of this feature is one query.** Do not add more.

### 3.2 Do NOT call `useGenerationPreview()` or `buildGenerationPreview()`

This is the single most important engineering note in the document.

`buildGenerationPreview` exists to answer _"which provider × payer × state
combinations are candidates for case creation?"_ — which requires group
membership, facility assignments, state footprint and licenses. **D4 makes that
question irrelevant**: your rows are providers who already have a case.

Your gap/excluded derivation is a Map lookup:

```ts
// for a section pinned to (groupId, state), and one (providerId, payerId) cell:
const caseRow =
  caseByKey.get(`${providerId}|${groupId}|${payerId}|${state}`) ??
  caseByLegacyKey.get(`${providerId}|${payerId}|${state}`); // group_id NULL rows
if (caseRow) return { kind: "case", case: caseRow };

const excl = activeExclusionByKey.get(`${providerId}|${groupId}|${payerId}|${state}`);
if (excl) return { kind: "excluded", reason: excl.reason, note: excl.note };

return { kind: "gap" };
```

Calling `useGenerationPreview()` would pull 16 queries, run readiness evaluation
and SOP template resolution you do not need, and reintroduce five data sources
(`facilities`, `provider_facility_assignments`, `provider_group_assignments`,
`state_licenses`, readiness facts) that D4 eliminated.

**Legacy-NULL caveat:** cases created before the 4-part key carry
`group_id = NULL`. Those cover all groups at their (provider, payer, state) —
hence the second lookup above. All 32 cases on hosted carry a non-null
`group_id`, but the fallback is cheap and the mock harness may seed legacy rows.

### 3.3 Query key

Ride the `["cases", orgId]` prefix so `useSetCaseStatus`'s existing invalidation
(`src/hooks/useCases.ts:147`) refetches the Matrix for free. This is what makes
the drop-off rule feel live with zero extra wiring:

```ts
// src/hooks/queryKeys.ts — follow the caseDenialEntries precedent at line 28
casesMatrix: (orgId: string) => ["cases", orgId, "matrix"] as const,
```

---

## 4. The derivation (pure lib)

Put all of this in `src/lib/casesMatrix.ts` with `casesMatrix.test.ts` beside it.
**No clock reads inside** — pass `today` in, as every other pure lib does.

### 4.1 Provider eligibility (D1)

```ts
p.status !== "terminated" &&
  !p.referenceOnly &&
  !isTestProvider(p) &&
  p.verificationState !== "pending_verification";
```

Import `isTestProvider` from `src/lib/testProvider.ts`. Do not re-check the flag
inline — that module exists specifically so the exclusion cannot drift between
surfaces. Lionstone has a test provider today; it must not appear.

**Why `pending_verification` is excluded — this is the organising idea of the
whole screen.** The Matrix answers one question: _what work is the credentialing
team responsible for right now?_ A pending-verification provider is work the team
is **waiting on someone else** for — the responsibility sits with the provider,
not the coordinator. Mixing the two makes the board unactionable, because a
coordinator can't tell which rows they can actually move today.

Providers we are waiting on are a **separate report**, not part of this feature.
Do not add a toggle for them here.

This predicate now matches `/generation`'s roster filter
(`src/hooks/useGenerationPreview.ts:247`) and the E1.8 readiness fence exactly.
That consistency is deliberate — three surfaces, one definition of "a provider
the team can act on."

No org on hosted has a pending-verification provider today, so this changes
nothing visible now. It is the rule that keeps the board honest as imports grow.

### 4.2 The drop-off rule (§3.3)

A provider is removed from the **entire Matrix** — every section — when _all_ of
their cases are `approved`.

Three things to get right:

1. Evaluate against the provider's **full unfiltered case set across all states
   and groups**, not the cases visible under the current filters. A provider
   all-approved in WI but still open in AK stays.
2. An `approved` case with no `confirmedEffectiveDate` still counts as approved.
   Awaiting-effective-date is a KPI, not a reason to stay.
3. A provider with **zero** cases never appears anyway (D4) — "all approved"
   requires at least one approved case.

Derived live on every read. No stored flag, no archive step.

### 4.3 Section, row and column construction

```
sections  = distinct (groupId, state) pairs across eligible providers' cases
rows      = eligible providers with ≥1 case in that (groupId, state)          [D4]
columns   = payers with an active payer_network_targets row for
            (groupId, state)                                                  [D5]
```

**Column edge case that will bite you:** a case can exist for a payer that has
**no active target** — the target was archived after the case was created, or the
case came from `ManualCaseModal`. Those cases must not vanish. Columns are
therefore `activeTargetPayers ∪ payersWithACaseInThisSection`, sorted by payer
name.

Section header shows: state name + code (or group name, per `Group by`), provider
count, and open-case count. **Derive the open count from the same predicate the
KPI cards use** (`matchesKpi` / `CASE_STATUS_BUCKETS` in `src/lib/casesView.ts`)
or the header and the cards will disagree on the same screen.

### 4.4 Cell kinds (D6)

| Kind       | When                                        | Renders                                | Interactive                         |
| ---------- | ------------------------------------------- | -------------------------------------- | ----------------------------------- |
| `case`     | A case exists at the 4-part key             | `<CaseStatusPill>` + urgency dots      | **Yes** — navigates to `/cases/$id` |
| `gap`      | Active target column, no case, no exclusion | "Not Started" chip, **visually muted** | No                                  |
| `excluded` | Active `case_generation_exclusions` row     | `—`, muted                             | No                                  |

Terminal cases (`approved` / `denied` / `not_pursuing`) **do** render in their own
cell when the provider is kept in the Matrix by another open case. The drop-off
rule is provider-level, never cell-level.

### 4.5 Gap cells must be distinguishable — deviation from §3.4

§3.4 says a gap should be "styled identically to a real Not Started case." **Do
not do that literally.** In BEST PT's NC section, 17 of 28 chips would be gaps —
the only chips on the screen that do nothing when clicked, with no way to predict
which. Same appearance, different behavior.

Build: same "Not Started" label and tone, but **muted** (reduced opacity or a
dashed border — your call within the token set), and `cursor: default` on the
chip itself. It still reads as "not started"; its inertness becomes predictable.

The gap cell is not a navigation target the way a case cell is — the whole cell
does **not** click through. Its only action is the "Generate case →" link inside
its tooltip (§4.7), which is the one focusable thing in the cell.

Excluded cells are fully inert and **not focusable at all** — they do nothing on
click, and §8 says they must not signal interactivity. Non-focusable is that same
rule applied to the keyboard.

### 4.7 Gap cells link to `/generation` — they do not create cases (D13)

A gap means "this group works with this payer in this state, and nobody has
started this provider yet." That is real, actionable work, and a dead-end cell
wastes it. But **the Matrix must not create the case itself.**

**Why not.** `ManualCaseModal` — the only other case-creation door — runs just two
of the four passes `/generation` runs:

| Pass                                      | `/generation` | `ManualCaseModal` |
| ----------------------------------------- | ------------- | ----------------- |
| `resolveTemplate`                         | ✅            | ✅                |
| `stampTasks` (template id + version)      | ✅            | ✅                |
| `stampExecutionTypes`                     | ✅            | ❌                |
| `hydratePayerFormTasks` (payer PDF forms) | ✅            | ❌                |
| `sop_resolution_tier` provenance          | ✅            | ❌                |
| `case_generation_run_rows` ledger         | ✅            | ❌                |

`CLAUDE.md` states it directly: payer PDF forms are _"Attached at `/generation`
only."_ A case created through the manual path from a gap cell would silently
ship without its payer forms and without execution types. That is a worse outcome
than the dead end.

**What to build instead.** `/generation` already accepts scope params
(`src/routes/generation.tsx:27`): `?provider=`, `?payer=`, `?group=`, `?facility=`.
The gap cell's tooltip carries one link:

```tsx
<Link to="/generation" search={{ provider: providerId, payer: payerId, group: groupId }}>
  Generate case →
</Link>
```

The coordinator lands on the real door with that candidate pre-filtered and
confirms there. Full four-pass hydration, full run-row ledger, one `<Link>` of new
code.

**This does not trip `oneDoor.test.ts`.** That suite greps for `createCase(`,
`create_case_with_tasks` and `useCreateCase(`. A `<Link>` matches none of them. Do
not import `useCreateCase` into any Matrix file — the Matrix is not on the
allowlist and must not be added to it.

**Known limitation, acceptable:** generation's scope has no `state` param, so the
link lands scoped to provider × payer across every state that group targets —
typically one to three rows. Adding `state` would mean touching `GenerationSearch`
and `GridScope` in `src/lib/generationGrid.ts`. **Out of scope for this PR**; note
it as a follow-up if coordinators ask.

**Useful side effect:** a gap cell is not necessarily a generation _candidate_ —
candidacy also requires a facility assignment under that group and a state
footprint (clinic or license). When the provider fails candidacy, `/generation`
shows them in its skip list with the reason ("No facility assignment under this
group"). The coordinator gets an explanation instead of a silent no-op, which an
inline modal could not have given them.

### 4.6 Urgency indicators (§5.1)

Two independent dots, both can show at once, **only on `case` cells**.

**Red — overdue task.** Reduce over the case's tasks from `useQueueTaskRows()`:

```ts
task.status !== "completed" &&
  task.dueDate != null &&
  differenceInCalendarDays(today, parseISO(task.dueDate)) >= 0;
```

`>= 0` — due today counts (D10). `blocked` is an open status here; only
`"completed"` closes a task. Note `listQueueTaskRows` already filters out removed
payer-form tasks, so you inherit that correctly.

**Orange — no touch in ≥14 days.** From `useFollowUpsDue()`, which returns the
latest touchpoint date per case (`entry_type = 'touchpoint'` only — notes, system
events and task updates never count). Never touched → fall back to
`daysOpen >= 14` from `createdAt`. Threshold: import `STALLED_AFTER_DAYS` from
`src/lib/actionState.ts`, do not hardcode 14.

**Approved cells never show either dot**, regardless of history.

**Suppressed on dimmed cells** (see §6).

**Known signal-quality problem — flag it in the PR, do not silently "fix" it.**
Only 3 touchpoints exist across all 32 cases, so the never-touched fallback
governs ~91% of cells, and every case on hosted is 0–12 days old. Nearly every
cell will light orange simultaneously in about two weeks. If you can do it inside
the existing token set, give never-touched a distinct treatment from went-quiet.
If that needs a design call, ship as specified and raise it.

---

## 5. UI

```
src/lib/casesMatrix.ts                       # pure derivation + casesMatrix.test.ts
src/hooks/useCasesMatrix.ts                  # composes cached queries + exclusions
src/components/cases/CasesMatrix.tsx         # semantic <table>, sticky header/column
src/components/cases/MatrixCellPopover.tsx   # the rich case card
```

Wire into `src/routes/cases.index.tsx` as a fourth `TabsTrigger` and a fourth
branch of the existing view switch. `CasesView` becomes
`"flat" | "provider" | "payer" | "matrix"`; extend the `?pivot=` validator.

### Reuse — do not rebuild any of these

`CaseStatusPill` (already 4px/squared, as §5 requires) · `StatusPill` ·
`Popover` · `Tooltip` · `Skeleton` · `EmptyState` · `Select` · `Input` ·
`resolveActiveFollowUp` (`src/lib/followUps.ts`) · `STALLED_AFTER_DAYS` ·
`isTestProvider` · `EXCLUSION_REASON_LABELS` (`src/lib/generationPreview.ts:35`) ·
`fmtDate` · the four KPI cards and the State/Status filters already on the route.

**Never hand-roll a status pill.** `statusToneClasses` is the shared tone map.

### Markup (§10 is a hard requirement)

Semantic `<table>` — `<th scope="col">` for payers, `<th scope="row">` for
providers. Not a div grid. Screen readers need the 2D header relationship.

Sticky provider column and payer header row. Working prior art with the correct
z-index layering is in `src/components/reports/MatrixTab.tsx:137-162` — **copy the
sticky pattern, not the component** (it renders the deprecated
`credentialing_status_id` path). Do not import from it; do not modify it (D12).

Case cells: full cell is the click target, min 32px height, keyboard-activatable
via Enter/Space, visible focus ring.

### Hover / focus behavior (§7)

| Cell       | Surface                                                   | Content                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `case`     | **Popover** on hover (short delay) **and keyboard focus** | Case number (mono) + status pill · provider · payer · state · days open · last touch ("3d since last touch" / "Never touched" / "Touched today") · follow-up date with overdue flag · next action · "Open case →" |
| `gap`      | **Tooltip**                                               | Payer name + "Not started" + a **"Generate case →" link** to `/generation` pre-scoped (§4.7). The link is focusable; the cell around it is not.                                                                   |
| `excluded` | **Tooltip**                                               | Exclusion reason, e.g. "Panel closed — excluded at generation"                                                                                                                                                    |

Popover: dismiss on mouse-out / blur / Escape; never traps focus; one open at a
time. Must not be hover-only — §10 requires keyboard parity.

**Next action** comes from `QueueEntry.action` / `.reason`
(`src/lib/nextBestActions.ts`), already computed on this route. The queue emits
one entry per **open** case, so a terminal cell kept visible by a sibling case has
no next action — render the row omitted, not an empty label.

**Follow-up date** comes from `useFollowUpsDue()`, which runs the carry-forward
reducer. Do not take the latest touch's date directly — a date-less touch carries
the prior follow-up forward, and only `clears_follow_up` ends it.

---

## 6. Filters (D8)

Control row: **Search · State · Status · Payer · Group by**. No Group filter.

- **Search** — provider OR payer name, case-insensitive substring, client-side.
- **State** — single select, "All states", narrows which sections render.
- **Payer** — single select, "All payers", narrows which **columns** render.
- **Status** — single select over the 8 canonical statuses. Non-matching case
  cells are **dimmed, not hidden**; a row with zero matching cells is hidden from
  its section.
- **Group by** — `State` (default) | `Group`. Nesting only (D3).
- **KPI cards** — the four existing cards stay as mutually-exclusive quick
  filters, combinable with everything above.
- **Reset filters** — one visible action whenever anything is non-default.

**Share the predicate, do not fork it.** `filterRows` in `src/lib/casesView.ts`
already implements KPI + state + status + search over a case row. Extract the
per-case predicate and use it from both the Flat list and the Matrix. If you write
a second copy, the two views will drift and start disagreeing about the same case.

Dimmed cells suppress their urgency dots.

---

## 7. States (§9)

| State                                | Render                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| Loading                              | Skeleton rows/columns in grid shape — not a full-page spinner       |
| Empty (no eligible providers at all) | "No active providers with open cases"                               |
| Filtered-empty                       | "Nothing matches these filters" + Reset action                      |
| Section empty under filters          | Hide the section. Never an empty table shell.                       |
| Error                                | Route-local inline panel + Retry that refetches only failed queries |

Empty and filtered-empty must be **distinguishable** — they are different
problems with different fixes.

**Error state:** no shared `ErrorState` component exists in the codebase. Follow
the route-local pattern; the selective-refetch version at
`src/components/reports/MatrixTab.tsx:80-99` is the shape to copy. Do not
introduce a shared component as part of this PR — log it in `DESIGN-DEBT.md`
instead.

---

## 8. Non-goals — do not build these

- No inline editing, task completion, or touch logging from the Matrix.
- **No case creation from the Matrix.** A gap cell links out to `/generation`
  (§4.7); it never calls `createCase` / `useCreateCase` /
  `create_case_with_tasks`. Doing so would trip `src/lib/oneDoor.test.ts` and
  would ship cases missing their payer forms and execution types.
- **No "waiting on the provider" rows.** Pending-verification providers are a
  separate report (D1). Do not add a toggle for them here.
- No per-user/assignee scoping — the Matrix is org-wide.
- No bulk actions, no multi-select.
- No provider- or payer-level totals beyond the section header counts.
- No new service function, no new `/api` route, no schema change.

---

## 9. Verification

No service or `/api` change means **no org-isolation gate work** and no extension
wire-contract coordination. Read `docs/VERIFY.md` for the tier table.

Run before pushing:

```
npx tsc --noEmit          # vite build does NOT typecheck
npm run lint
npm run test              # includes oneDoor.test.ts — must stay green
npm run test:e2e -- cases-pivots.spec.ts
```

**Cloud sandboxes block egress to `*.supabase.co`.** Browser verification goes
through the Playwright mock harness — see the `e2e-harness` skill.

### Unit tests (`casesMatrix.test.ts`) — cover at minimum

1. Provider with ≥1 open case appears in every (group, state) section where they
   hold a case, open or terminal.
2. Provider whose last open case flips to `approved` disappears from **every**
   section — including sections where they had `denied` / `not_pursuing` cells.
3. Provider all-approved in one state but open in another **stays**.
4. `terminated`, `referenceOnly`, `isTestProvider` and `pending_verification`
   rows never appear — even when they hold an open case.
5. Two groups with identical targets in one state produce **two sections**, and
   no cell holds two cases (the Kansas shape).
6. A payer with a case but no active target still gets a column.
7. Legacy `group_id = NULL` case matches on the 3-part key.
8. Red dot fires for a task due **today** (D10) and for a `blocked` overdue task.
9. Approved cell shows no dots even with an overdue task and no touches.
10. Dimmed cell suppresses dots.
11. A gap cell's generate link carries the section's `groupId` and `state`'s
    provider/payer — not a neighbouring section's.

Also assert in `oneDoor.test.ts` terms: no file under `src/components/cases/`
added by this feature imports `useCreateCase`. The existing suite already greps
for it; keep it green rather than adding an allowlist entry.

### E2E

Extend `e2e/cases-pivots.spec.ts` rather than adding a new spec file — the pivot
switch is the thing under test and it already has a harness.

**The drop-off rule cannot be verified against hosted data**: exactly one approved
case exists system-wide and no provider is all-approved. Seed fixtures in the mock
harness for tests 2 and 3.

---

## 10. Reference data (hosted, 2026-08-25)

Useful for sanity-checking your derivation. Do not hardcode any of it.

| Org                        | Providers (active/onboarding/terminated) | Cases | Sections the Matrix should render       |
| -------------------------- | ---------------------------------------- | ----- | --------------------------------------- |
| BEST Physical Therapy LLC  | 0 / 7 / 0                                | 17    | 2 — (BEST, CA) and (BEST, NC)           |
| Kansas Fitness Physio      | 1 / 9 / 1                                | 11    | 2 — one per group, both KS              |
| Lionstone Physical Therapy | 0 / 2 / 0 (+1 test provider)             | 4     | 2 — (Lionstone, AK) and (Lionstone, WI) |

Expected cell counts: BEST NC ≈ 7 payers × 4 providers = 28 cells, 11 real cases,
17 gaps. BEST CA ≈ 6 × 1 = 6 cells. **~34 cells total for the largest org** — no
virtualization or pagination needed.

Other numbers worth knowing: 44 tasks, all with due dates, **22 already overdue**.
**3 touchpoints across all 32 cases.** `assigned_to` NULL on all 32 (hence D9).
1 approved case system-wide. Cases are 0–12 days old.

---

## 11. Before you open the PR

`CLAUDE.md` has a "Keep this file honest" rule. This change adds a view, a hook
and a pure lib, so update:

- `CLAUDE.md` — the `/cases` description (three views → four) and a line in the
  derived-logic section for `casesMatrix.ts`.
- `DESIGN-DEBT.md` — the error-state duplication noted in §7.

No `SCHEMA.md` change (no DDL). No `types.ts` regen.

Keep the PR to this feature. `src/components/reports/MatrixTab.tsx` is dead code
that overlaps this work — **leave it for a separate cleanup PR** (D12).

# Cases Matrix — Feasibility Spike Findings

Reviewed against the codebase and hosted data (`fkvuhfsqcmujywzgczmc`) on
2026-08-25, answering the requirements doc's Q1–Q7 plus the acceptance criteria.

**Verdict: buildable, and cheaper than the spec assumes.** No new tables, no new
RPC, no `/api` route, no server-side aggregate. The two hard derivations the spec
worries about (Gap vs Excluded, and the urgency inputs) already exist as pure,
tested libraries whose inputs are already loaded on `/cases` today.

Three things block a clean implementation, and four statements in the spec are
factually wrong about the current system. Both lists are below — none of them are
"go rewrite it", but Q1 and Q6 in particular would ship a broken screen if
implemented as written.

---

## Summary of answers

| Q | Answer | Confidence |
|---|---|---|
| Q1 Active provider | **`status !== 'terminated'`**, plus three exclusions the spec omits. Strict `'active'` ships an empty screen. | Certain — measured |
| Q2 Gap vs Excluded | **Already solved.** `buildGenerationPreview` emits exactly this, batched, no N+1. Three caveats. | High |
| Q3 Payer filter | Skip for v1. The "parity with Today's queue" premise does not exist. | High |
| Q4 Real-time vs eventual | **No decision needed** — real-time already falls out of existing cache invalidation, free. | Certain |
| Q5 Performance | **Not a risk.** 245 cells across all orgs today; the page already loads every input. | Certain — measured |
| Q6 Multi-group | **BLOCKING.** Live today: 8 of 10 Kansas providers are in 2 groups with identical targets. | Certain — measured |
| Q7 Error state | No shared component exists. Use route-local inline + Retry; log to DESIGN-DEBT. | Certain |

---

## Q1 — "Active provider"

**Answer: `status !== 'terminated'`. The spec's recommendation (strict
`status === 'active'`) would render an empty Matrix for two of the three orgs on
hosted.**

`ProviderStatus` is `"onboarding" | "active" | "terminated"`
(`src/types/index.ts:69`). In practice `active` is nearly unused — providers are
created as `onboarding` and never promoted:

| Org | active | onboarding | terminated | cases | Matrix under strict `active` |
|---|---|---|---|---|---|
| BEST Physical Therapy LLC | 0 | 7 | 0 | 17 | **empty** |
| Kansas Fitness Physio | 1 | 9 | 1 | 11 | 1 row (of 4 providers with cases) |
| Lionstone Physical Therapy | 0 | 2 | 0 | 4 | **empty** |

The spec's own reasoning for strict `active` — "`onboarding` providers without a
start date may not yet have real payer work" — is contradicted by the data:
`onboarding` providers hold 31 of the 32 cases in the system.

**The binary in the spec is also the wrong shape.** Every other work-facing
surface filters on more than `status`, and the Matrix needs the same three
exclusions or it will show rows nothing else shows:

- `referenceOnly` — migrated/onboard-existing rows, skipped by the action engine,
  Fix-it and the Home queues.
- `isTestProvider` — the org's designated dry-run form-fill provider. There is a
  shared predicate for exactly this, `excludeTestProviders`
  (`src/lib/testProvider.ts`), and its whole purpose is that the exclusion cannot
  drift between surfaces. **Lionstone has one today** — under the spec as
  written it appears in the Matrix.
- `verificationState === 'pending_verification'` — the bulk-import staging fence;
  excluded from readiness and generation candidacy
  (`src/lib/generationPreview.ts:410`).

Recommended predicate, matching `/generation`'s roster filter
(`src/hooks/useGenerationPreview.ts:247`):

```ts
p.status !== "terminated" && !p.referenceOnly && !isTestProvider(p)
```

`pending_verification` is a separate product call: generation and readiness both
fence it out, but those gate *creating work*, and the Matrix only *shows* work
that already exists. Recommend showing them (a pending-verification provider with
a live case is exactly the anomaly a coordinator should see).

---

## Q2 — Gap vs Excluded computation

**Answer: it already exists, it is already batched, and it is already
unit-tested.** No new query shape is needed.

`buildGenerationPreview` (`src/lib/generationPreview.ts:233`) takes targets,
group assignments, facility assignments, facilities, licenses, providers,
existing cases and exclusions, and emits one row per provider × group × payer ×
state with `disposition: "proposed" | "existing" | "excluded"`. That maps 1:1
onto the spec's Gap / Case / Excluded. It is pure, clock-free, and the whole
input set is read one-query-per-table and joined in memory — the N+1 the spec
fears is already designed out (`src/services/generationPreview.ts` header).

Exclusion reasons for the §7 tooltip come free: `EXCLUSION_REASON_LABELS`
(`already_credentialed` / `panel_closed` / `not_pursuing` / `other`) plus the
per-row `reason` string, already written for exactly this purpose
("Jane works at a Group 1 clinic in NC; Group 1 targets BCBS-NC in NC").

**Three caveats before reuse:**

1. **There is a fourth bucket the spec has no cell kind for: `enrolled`.**
   `bucketGridRows` (`src/lib/generationGrid.ts:29`) overlays live
   `enrollment_facts` and splits `proposed` into `candidate` vs `enrolled` — a
   combination already covered by a live enrollment fact, which is deliberately
   never worked. Under §3.4 as written, an enrolled combination with no case
   renders as a **"Not Started" chip**, i.e. the Matrix tells a coordinator to
   start work that is already finished. Only 1 live fact exists today so it is
   invisible now, but this is a correctness bug waiting for the fact table to
   fill. Needs either a fourth cell kind or an explicit documented fold.

2. **The preview is keyed on group; the Matrix cell is not.** See Q6.

3. **The preview is not a superset of cases.** A `ManualCaseModal` case, or a
   case whose payer target was archived after creation, produces no preview row.
   The Matrix must render the **union** of (cases) and (preview rows), keyed on
   provider × payer × state — not the preview alone, or real cases will vanish.

---

## Q3 — Dedicated payer filter

**Answer: skip it in v1, and drop the parity framing — the filter set it refers
to does not exist.**

The spec asks for "parity with the Today queue's filter set". There is no such
separate surface: `/work` and `/home` both redirect into `/cases`
(`src/routes/work.tsx:16`, `src/routes/home.tsx:10`), and neither renders filter
controls of its own. There is nothing to reach parity with, so this is not a
reason to add a control.

Decide on merit instead: the widest state section today is 7 payer columns (BEST
PT in NC), and search already matches payer name (`rowMatchesSearch`,
`src/lib/casesView.ts:88`). A dedicated payer filter earns its place when columns
exceed ~8; below that it duplicates search. **Recommend deferring it** — nothing
about the Matrix depends on this answer, so it can be added later without rework.

---

## Q4 — Real-time vs eventual consistency for the drop-off rule

**Answer: no decision needed. Real-time already happens, at zero cost.**

`useSetCaseStatus` invalidates the `["cases", orgId]` prefix on success
(`src/hooks/useCases.ts:147`). Any Matrix query keyed under that prefix is
invalidated by the same call, so navigating back from case detail re-renders
against refetched data and the provider drops off — no page refresh, no
refetch-on-focus wiring, no extra work.

The spec's v1 recommendation (eventual consistency acceptable) is satisfied, and
the stronger behavior comes free. The only requirement is that the Matrix's query
key rides the `["cases", orgId]` prefix — which is the house rule anyway
(prefix invalidation, `CLAUDE.md` § Layering).

---

## Q5 — Performance at scale

**Answer: not a risk for v1, and the spec's premise is inverted.**

The spec assumes the Matrix cross-product is "significantly larger than a flat
list at the same org size" and that this may require a server-side aggregate,
pagination or virtualization. Measured, on hosted:

| Org | Target-driven cells | State sections | Actual cases |
|---|---|---|---|
| BEST Physical Therapy LLC | 183 | 8 | 17 |
| Kansas Fitness Physio | 50 | 1 | 11 |
| Lionstone Physical Therapy | 12 | 3 | 4 |
| **All orgs** | **245** | — | **32** |

245 cells is not a performance problem in any rendering strategy.

**More importantly, the data is already loaded.** `/cases` already calls
`useNextBestActions()` (`src/routes/cases.index.tsx:119`), which composes
**fourteen** org-scoped queries: cases, tasks, providers, follow-ups/touches,
facility assignments, facilities, groups, payers, status configs, payer network
targets, group assignments, readiness facts, licenses, contracts
(`src/hooks/useNextBestActions.ts:93`). That is nearly the entire Matrix input
set, already in the TanStack cache on this exact route.

Marginal cost of the Matrix ≈ **two additional queries**
(`case_generation_exclusions`, and `credential_cases` narrow rows if not reusing
the list) — both already cached elsewhere by `useGenerationPreview`.

Recommendation: **do not** call `useGenerationPreview()` wholesale (16 queries,
and it also runs readiness evaluation and SOP template resolution the Matrix does
not need). Compose a narrow `useCasesMatrix` from the caches already present and
call `buildGenerationPreview` directly.

Revisit virtualization at roughly 50 providers × 15 payers × 5 states (~3,750
cells). Nothing on hosted approaches that.

---

## Q6 — Multi-group providers — **BLOCKING**

**This is not a hypothetical to confirm. It is the live configuration of one of
the three orgs, and it breaks a stated invariant.**

Kansas Fitness Physio has **8 of its 10 providers assigned to 2 groups**, and
both groups target the **identical 5 payers in KS**:

| Group | State | Payers |
|---|---|---|
| Kansas Fitness Physio P.A. | KS | Aetna, BCBS, Cigna, Medicare, UHC |
| Kansas Fitness Physio, P.A. (formerly known as Mowery Rehab Consultants, P.A.) | KS | Aetna, BCBS, Cigna, Medicare, UHC |

(The second is evidently a rename/merge artifact, which does not make the problem
go away — it makes it likely to recur.)

Two consequences:

1. **§4's "One cell = one case" is not schema-guaranteed.** The case key is
   `UNIQUE NULLS NOT DISTINCT (provider_id, group_id, payer_id, state)`. Two
   groups mean two legally distinct cases at the same provider × payer × state,
   which is one Matrix cell. No duplicates exist today (verified: zero rows), but
   nothing prevents them — generation's existing-case match is on the full 4-part
   key (`src/lib/generationPreview.ts:302`), so a case under group A does **not**
   suppress the candidate under group B. All 11 Kansas cases carry a non-null
   `group_id`, so this is live exposure, not legacy-NULL safety.

2. **Gap vs Excluded resolves per-group, but the cell is per-(provider, payer,
   state).** The two groups can legitimately disagree — targeted under A,
   excluded under B — and the spec gives no rule for reconciling them.

**Options** (needs a product call before implementation):

- **(a) Scope the Matrix to one group at a time** — make the Group filter
  required (or default to the provider's primary assignment) whenever the org has
  more than one group. Simplest and honest; no invented precedence.
- **(b) Collapse with documented precedence** — primary group wins
  (`provider_group_assignments` has exactly one primary per provider). Keeps a
  single grid, but silently hides the non-primary group's work.
- **(c) Multi-case cell** — render a "2 cases" affordance. The orphaned
  Enrollment Matrix already does this for its multi-state case (see below).

**Recommendation: (a) for v1.** It is the only option that cannot show a
coordinator a wrong cell.

---

## Q7 — Error-state component

**Answer: confirmed, no shared `ErrorState` component exists** (zero hits across
`src/`). Two established route-local patterns:

- `/cases` today: inline bordered div, message only, **no retry**
  (`src/routes/cases.index.tsx:492`).
- The orphaned Enrollment Matrix: bordered div + message + a `Retry` button that
  refetches only the failed queries (`src/components/reports/MatrixTab.tsx:90`).
  This is the better pattern and is directly copyable.

Recommend: route-local inline with the selective-refetch Retry, and a
`DESIGN-DEBT.md` entry noting the duplication. Introducing a shared component is
a separate cleanup, not part of this work.

---

## Corrections — statements in the spec that are wrong about the current system

**1. §5.1 — the overdue definition is not the app's definition.**

The spec states: *"existing app definition: `status !== 'completed' && dueDate <
today`; a `blocked` task past its due date also counts as overdue. Due **today**
is not overdue."*

The actual definition (`src/lib/actionState.ts:50`) is:

```ts
const hasDueOrOverdueTask = input.openTaskDueDates.some(
  (due) => due != null && differenceInCalendarDays(now, parseISO(due)) >= 0,
);
```

`>= 0` — **due today does count**, and the comment above it says so ("any open
task due today / overdue"). The `blocked`-counts-as-open half of the spec's claim
is right (only `"completed"` closes a task, `src/lib/nextBestActions.ts:135`).

Shipping the spec's rule makes the Matrix disagree with the ranked queue and the
work-view chips about the same case on the same day. Pick one; recommend matching
the app and amending the spec.

**2. §7 — Tooltip exists.**

Correct that there is no HoverCard. But `src/components/ui/tooltip.tsx` exists and
is already used for precisely this kind of grid cell in the orphaned Enrollment
Matrix. The spec's own §7 asks for *tooltips* on Gap and Excluded cells — those
should use Tooltip; only the rich case popover needs Popover.

**3. §13 Q3 — there is no "Today queue" filter set.** See Q3 above.

**4. §9 — "Minted Panel's skeleton pattern" is not one pattern.** `Skeleton`
exists (`src/components/ui/skeleton.tsx`), but `/cases` hand-rolls
`animate-pulse` divs (`src/routes/cases.index.tsx:497`). Either is defensible;
the spec should not cite "the existing pattern" as if it were settled.

---

## Gaps — decisions the spec does not make

**A. The payer column set is undefined.** §4 makes payers the columns but never
says *which* payers. For BEST PT in NC the candidates are: 6 (payers with a case
in NC), 7 (active targets in NC), or the entire global catalog. This single
choice drives every Gap cell. **Must be specified before implementation.**

**B. The state-section set is contradictory, and it changes what the screen
is.** AC-1 says a provider appears "in every state section where they hold at
least one case"; §3.4 describes cells "for each payer column in that provider's
state section", implying target-driven coverage. Measured both ways for BEST PT:

- **Case-driven:** 2 sections (CA, NC), ~17 real cases, few gaps — a dense work board.
- **Target-driven:** 8 sections, 183 cells, 17 of them real — **91% of the grid is
  "Not Started" gap chips.**

The mock screenshots show the first. The §3.4 text implies the second. Since a
Gap chip is styled identically to a real Not Started case (§3.4, deliberate), the
target-driven reading produces a screen where a coordinator cannot distinguish
166 hypothetical combinations from 17 real ones. **Recommend case-driven sections
with target-driven columns inside them**, but this needs an explicit decision.

**C. `assigned_to` is NULL on all 32 cases.** The popover's Coordinator row
(§7.3) and the mock's "Dana R." have no data behind them anywhere in the system.
The field is on the list projection (`src/services/cases.ts:64`) and resolves via
a separate coordinators query (`src/routes/cases.$id.tsx:72`), so it *works* —
it will simply render "—" for every case in every org. Either populate assignment
first or drop the row from the popover.

**D. "Next action" (§7.4) has no stored field.** It must come from the derived
`QueueEntry.action` / `.reason` (`src/lib/nextBestActions.ts`), which is
available and is already computed on this page. Note the constraint: the queue
emits **one entry per open case**, so terminal cells that remain visible (an
Approved cell on a provider kept alive by another case) have no next action. Fine
— but the spec should say what renders there.

**E. The orange dot will read as noise, not signal.** Only **3 touchpoints exist
across 32 cases**, so the "never touched → `daysOpen >= 14`" fallback governs
~91% of cells. Cases are currently 0–12 days old, so almost nothing fires today
and nearly everything fires within two weeks. Recommend distinguishing
"never touched" from "went quiet" visually, or the indicator degrades to
decoration. (The red dot is better grounded: 22 of 44 tasks are already past
due.)

**F. The drop-off rule is currently untestable on real data.** There is exactly
**1 approved case** in the entire system, and no provider is all-approved. AC-2
cannot be verified against hosted data — it needs seeded fixtures or the mock
harness (`e2e-harness` skill).

**G. Prior art exists and is dead code.**
`src/components/reports/MatrixTab.tsx` is a working provider × payer Enrollment
Matrix: sticky provider column and payer header row, group + state filters,
dash-for-empty cells, cell → `/cases/$id` links, and a multi-item tooltip. It is
**imported nowhere** — `src/routes/reports.tsx:11` documents that the folder was
deliberately kept for re-homing after `/reports` retired into `/reporting`.

It cannot be adopted as-is: it renders the deprecated `credentialing_status_id`
through `hexToStatusColor` rather than the canonical `case_status` through
`CaseStatusPill`, which the spec correctly requires. But its sticky-table markup
is directly harvestable, and **the product should decide explicitly whether the
new Matrix supersedes it** (recommend: yes, and delete it in the same change
rather than leaving two matrices in the tree).

---

## Scope note — how to keep this change to the Matrix alone

§1 says the Matrix "replaces" the flat `/cases` list. Taken literally, that turns
a Matrix feature into a rebuild of the app's landing surface: `/`, `/home`,
`/work`, `/welcome` and `/admin/statuses` all redirect into `/cases`, and the
route carries more than a list:

- the deadline-ranked ordering that is the Flat view's **default sort**
  (`src/routes/cases.index.tsx:1`);
- three views behind `?pivot=` (Flat / By provider / By payer);
- back-compat contracts other flows navigate into: `?runId=` from the generation
  confirm (`src/components/generation/GenerationGrid.tsx:207`), `?ids=` from bulk
  touch logging, `?chip=` KPI quick-filters;
- `AddTouchDialog` and `ManualCaseModal` — and the manual modal is one of only
  five files allowed to create a case, pinned by `src/lib/oneDoor.test.ts`.

**Recommend shipping the Matrix as a fourth view in the existing segmented
control** (`?pivot=matrix`). That is the additive option: it reuses the KPI cards
and filters already wired on the route, preserves every contract above, leaves
`e2e/cases-pivots.spec.ts` green, and lets the Matrix be evaluated against the
Flat view before anything is retired. It also keeps this piece of work confined
to the Matrix — nothing else on the route has to be touched or re-verified.

---

## Recommended shape

```
src/lib/casesMatrix.ts          # pure: sections, rows, columns, cell kinds,
                                # drop-off rule, dimming — + casesMatrix.test.ts
src/hooks/useCasesMatrix.ts     # composes caches already on the page +
                                # exclusions; calls buildGenerationPreview
src/components/cases/CasesMatrix.tsx      # semantic <table>, sticky header/column
src/components/cases/MatrixCellPopover.tsx
```

- Cell kinds: `case | gap | excluded | enrolled` (see Q2 caveat 1).
- Reuse without modification: `CaseStatusPill`, `StatusPill` (already 4px/squared
  per §5), `buildGenerationPreview`, `EXCLUSION_REASON_LABELS`,
  `resolveActiveFollowUp`, `buildNextBestActions`, `Popover`, `Tooltip`,
  `Skeleton`, `EmptyState`.
- Query key under the `["cases", orgId]` prefix so Q4 stays free.
- No service or `/api` change ⇒ **no org-isolation gate work** and no extension
  wire-contract coordination.

Rough effort, assuming the three blocking decisions are made first: pure lib +
tests ~1 day; hook ~0.5 day; grid + popover + a11y ~1.5 days; e2e against the
mock harness ~1 day. Call it **4 days**, plus whatever the Q6 decision implies.

---

## Blocking decisions needed before implementation

1. **Q6 multi-group** — which of (a)/(b)/(c). Recommend (a).
2. **Gap B — state sections and payer columns**: case-driven or target-driven.
   Recommend case-driven sections, target-driven columns.
3. **Correction 1 — overdue semantics**: match the app (`due today` counts) or
   match the spec. Recommend the app.

Everything else in the requirements doc is implementable as written.

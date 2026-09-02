# S4 — Enrollment matrix scale proof

**Status:** measurement complete enough to disprove the unbounded-grid claim;
scratch-project rerun remains required before build  
**Answer:** **No — 3,000 providers × 20 payers does not remain usable if one
request and one DOM render load all 60,000 cells.** The database is not the
first limit. Payload size breaks first, then browser/derivation work.

The supported shape is a narrow, normalized API DTO, server-side filters,
cursor pagination in 50-provider windows, and row virtualization. A
materialized view or summary table is not justified at this scale by the
measured database time.

## Evidence status and limitation

The spike required writes to scratch Supabase project
`vmznysvietfaddakkegt`. That seed has still not been run, so the regional
end-to-end rerun remains open. The checked-in harness refuses the production
ref `fkvuhfsqcmujywzgczmc`; no production data was written.

**Hosted read-only verification, 2026-09-02.** What could be checked against
hosted without writing has been:

- **The harness models hosted indexes faithfully.** This was the main risk in a
  synthetic benchmark and it holds. Hosted `providers` really does carry only
  `providers_pkey` plus the partial `idx_providers_pending_verification`, and
  `matrix-scale-setup.sql` creates exactly that pair. The case and contract
  index sets match too. The reported 50-provider page timings therefore already
  include the sequential scan and sort that hosted would do, rather than
  flattering the result with an index production does not have.
- **The production refusal guard is real**, not just documented.
- **The four-part case key is confirmed on hosted**:
  `credential_cases_provider_group_payer_state_key` on
  `(provider_id, group_id, payer_id, state) NULLS NOT DISTINCT`.
- **One structural assumption did not survive.** See "The cell grain is not
  one-to-one with cases" below. It is not a scale problem and it reproduces at
  current data size.

### Current production scale, for prioritisation

| Entity                 | Hosted today | S4 model |
| ---------------------- | -----------: | -------: |
| Providers              |       **21** |    3,000 |
| Cases                  |       **42** |   60,000 |
| Payers (global)        |        **9** |       20 |
| Facilities             |       **38** |       40 |
| Active network targets |       **75** |      140 |
| Contracts              |        **0** |      700 |

Largest single org: 11 providers, 17 cases.

The model is roughly 143x current provider count. Nothing in today's dataset
forces paging, virtualization, or a cursor. That does not invalidate the
finding, because the 3,000-provider promise is the question that was asked and
the disproof of the unbounded grid stands. It does change sequencing: the
paging work is insurance against a sales promise, not relief for a live
performance problem. Build the correctness items first.

Measurements below are real, repeatable local PostgreSQL 16.15 numbers on a
4-vCPU Intel Xeon VM with 16 GiB RAM and a local Unix socket. They establish a
database lower bound and conclusively measure raw payload and browser costs.
They do **not** include Supabase/PostgREST, TLS, regional network latency,
concurrency, or hosted-cache variance. Before build, rerun the same harness
against the approved scratch project and retain its `EXPLAIN (ANALYZE,
BUFFERS)` plans.

The S4 brief described the case grain as provider + payer + state. Current code
and migration `20260713150000` establish the four-part key
`(provider_id, group_id, payer_id, state)` with `NULLS NOT DISTINCT`. The
harness uses the current four-part grain. It also models contracts using the
current `contracting_status_id → status_configs` relationship rather than an
invented text status.

## Seed and method

Files:

- `scripts/benchmarks/matrix-scale-setup.sql`
- `scripts/benchmarks/run-matrix-scale-benchmark.mjs`
- `scripts/benchmarks/matrix-derive-benchmark.ts`
- `scripts/benchmarks/run-matrix-derive-benchmark.mjs`
- `scripts/benchmarks/matrix-browser-render-benchmark.mjs`

The SQL setup creates only an isolated `matrix_spike` schema, with current
relevant PK/unique/FK indexes, current org-membership SELECT-policy shapes, a
read-only benchmark role, and explicit group-grant filters. Each scale has 20
global payers, 7 groups, 40 facilities across 5 states, varied provider
lifecycle and eight canonical case statuses, plus 700 group/payer/state
contracts.

| Scale | Providers | Payers | Facilities |  Cases | Contracts |
| ----: | --------: | -----: | ---------: | -----: | --------: |
|   500 |       500 |     20 |         40 | 10,000 |       700 |
| 1,500 |     1,500 |     20 |         40 | 30,000 |       700 |
| 3,000 |     3,000 |     20 |         40 | 60,000 |       700 |

Each SQL measurement had 3 warmups and 30 timed single-client runs. “API
bypass” uses the service-role-equivalent path with `row_security=off`; “RLS”
uses the read-only membership role. Both use the same seven server-resolved
group IDs so the delta isolates current RLS policy cost. Payload is raw UTF-8
JSON generated by `json_agg`, before an HTTP envelope or compression. Values
labeled KiB use 1,024 bytes.

Commands:

```sh
MATRIX_BENCH_TARGET=local \
MATRIX_BENCH_DATABASE_URL=postgresql:///postgres \
MATRIX_BENCH_RUNS=30 \
MATRIX_BENCH_OUTPUT=/tmp/minted-matrix-scale-results.json \
node scripts/benchmarks/run-matrix-scale-benchmark.mjs

MATRIX_DERIVE_RUNS=10 \
node scripts/benchmarks/run-matrix-derive-benchmark.mjs

MATRIX_BROWSER_TRIALS=10 \
node scripts/benchmarks/matrix-browser-render-benchmark.mjs
```

## SQL results

| Providers | Query                |   Rows |  Payload KiB | API p50 ms | API p95 ms | RLS p50 ms | RLS p95 ms |
| --------: | -------------------- | -----: | -----------: | ---------: | ---------: | ---------: | ---------: |
|       500 | Full matrix          | 10,000 |      7,399.8 |     55.744 |     59.765 |     56.650 |     57.701 |
|       500 | State                |  2,000 |      1,478.0 |     14.456 |     14.975 |     17.349 |     18.050 |
|       500 | State + payer + name |      1 |          0.7 |      2.000 |      2.490 |      2.326 |      2.820 |
|       500 | Provider drill-down  |     20 |         14.8 |      1.489 |      1.942 |      1.711 |      2.052 |
|       500 | 50-provider page     |  1,000 |        740.1 |      9.191 |      9.917 |      9.772 |     10.183 |
|     1,500 | Full matrix          | 30,000 |     22,228.3 |    121.313 |    122.302 |    124.390 |    127.839 |
|     1,500 | State                |  6,000 |      4,439.8 |     33.392 |     34.650 |     29.980 |     30.453 |
|     1,500 | State + payer + name |      1 |          0.7 |      2.577 |      3.569 |      2.933 |      3.590 |
|     1,500 | Provider drill-down  |     20 |         14.8 |      1.662 |      2.362 |      1.728 |      2.050 |
|     1,500 | 50-provider page     |  1,000 |        741.0 |      8.396 |      9.053 |     11.098 |     11.788 |
|     3,000 | Full matrix          | 60,000 | **44,456.5** |    230.588 |    233.847 |    237.177 |    242.355 |
|     3,000 | State                | 12,000 |      8,879.6 |     52.291 |     53.499 |     56.084 |     57.314 |
|     3,000 | State + payer + name |      1 |          0.7 |      3.404 |      4.091 |      3.989 |      4.640 |
|     3,000 | Provider drill-down  |     20 |         14.8 |      1.619 |      2.544 |      1.789 |      2.728 |
|     3,000 | 50-provider page     |  1,000 |        741.0 |      9.142 |      9.796 |     10.511 |     10.992 |

The full-query p95 is close to linear: API bypass 59.8 → 122.3 → 233.8 ms
and RLS 57.7 → 127.8 → 242.4 ms. At 3,000 providers, current-policy RLS adds
8.5 ms at p95 (3.6%) to the full read, 3.8 ms to the state read, 0.55 ms to the
one-result search, and 0.18 ms to drill-down. The 500-provider negative full-
read delta is ordinary warm-cache noise, not evidence that RLS speeds a query.

This means S1 should choose enforcement for isolation and maintainability, not
for single-digit millisecond savings. The service-role API still needs explicit
org and group predicates because RLS is absent there.

## Existing derivation cost

`buildCasesMatrix()` currently combines complete client-side caches for cases,
providers, payers, groups, targets, tasks, follow-ups, and exclusions. The
benchmark uses that exact function, one task per case, and follow-up data on
25% of cases.

| Providers |     Cases/tasks | Derived cells |    p50 ms |    p95 ms |
| --------: | --------------: | ------------: | --------: | --------: |
|       500 | 10,000 / 10,000 |        10,000 |      81.7 |      90.4 |
|     1,500 | 30,000 / 30,000 |        30,000 |     239.6 |     250.9 |
|     3,000 | 60,000 / 60,000 |        60,000 | **509.5** | **543.9** |

This excludes React reconciliation and layout. Reusing the current internal
matrix composition for a client portal would also load internal tasks/touches,
which S2 prohibits.

## Browser render proof

The browser harness is deliberately optimistic: each cell contains only a
button and a span. Production `MatrixCellPopover` is heavier. Timing includes
construction, append, forced layout, and two animation frames in headless
Chromium at 1440×900.

| Providers | Strategy      | Rendered cells | Elements |      p50 ms |      p95 ms |
| --------: | ------------- | -------------: | -------: | ----------: | ----------: |
|       500 | All rows      |         10,000 |   31,025 |       150.0 |       218.7 |
|       500 | 50-row window |          1,000 |    3,125 |        33.4 |        34.8 |
|     1,500 | All rows      |         30,000 |   93,025 |       647.3 |       897.8 |
|     1,500 | 50-row window |          1,000 |    3,125 |        33.3 |        38.0 |
|     3,000 | All rows      |         60,000 |  186,025 | **1,050.2** | **1,721.4** |
|     3,000 | 50-row window |          1,000 |    3,125 |        33.3 |        35.1 |

## Where the curve bends and what fails first

1. **Payload fails at the smallest tested scale.** A denormalized 500-provider
   response is already 7.4 MiB. At 3,000 it is 44.5 MiB before envelope,
   network, and JSON parse costs.
2. **Browser work fails next.** The optimistic all-row p95 is 219 ms at 500,
   898 ms at 1,500, and 1.72 s at 3,000. Existing matrix derivation reaches
   251 ms p95 at 1,500 and 544 ms at 3,000.
3. **The database has not bent by 60,000 rows.** Full-query p95 stays under
   250 ms locally; filtered, drill-down, and paged reads are much smaller.

The current internal `/cases` matrix is not a scale solution: it fetches eight
whole-org query families in `useCasesMatrix()` and renders every section row in
`CasesMatrix.tsx`.

## Proposed performance budgets

These are recommendations, not product-approved SLAs:

| Boundary                                             |              Proposed p95 budget |
| ---------------------------------------------------- | -------------------------------: |
| Matrix API database + server work, excluding network |                         ≤ 300 ms |
| Interactive filtered page                            |              ≤ 200 ms end-to-end |
| Provider drill-down API                              |              ≤ 200 ms end-to-end |
| Initial uncompressed payload                         |                          ≤ 1 MiB |
| Main-thread render/update work                       | ≤ 100 ms, with a target of 50 ms |
| Rendered matrix cells                                |                  ≤ 1,000 at once |

The 50-provider proof is inside the database, payload, and render budgets:
approximately 11 ms RLS p95, 741 KiB raw for the deliberately wide
denormalized row shape, and 35 ms optimistic render p95. A normalized DTO that
emits provider and payer labels once should be smaller.

## The cell grain is not one-to-one with cases

**This is a correctness bug in the proposed read shape, not a performance
finding, and it reproduces on hosted today at 21 providers.**

The recommended matrix is rows = provider, columns = payer, scoped to a _set_
of granted groups. The case key is four-part: provider + group + payer + state.
Provider and payer are two of those four. So one `(provider, payer)` cell can
match more than one case whenever the granted set spans several groups or the
provider works in several states.

Verified against hosted with the exact query shape recommended below, for one
real org with three granted groups:

- 8 providers in the page, 8 payer columns, so **64 cells**;
- the query returned **65 rows**.

The extra row is a real provider with two live cases for the same payer:
different group, different state (`CA` and `ID`), and **different statuses**
(`submitted` and `in_progress`). One cell, two truths, no rule for which one
wins.

The internal `/cases` matrix does not have this problem because it never asks
the question. `casesMatrix.ts` derives a section at a time, where a section is
one group **and** one state, so section + row + column is exactly the four-part
key and "one cell = one case" is true by construction. `CLAUDE.md` calls that
pinning out explicitly. The client design drops it, because a client grant is a
_set_ of groups and the executive question spans states.

Silently taking the first row would show an executive a status that is real but
arbitrary, and would flip between page loads as row order changes. Options,
cheapest first:

1. **Section the client matrix the same way the internal one does**, by
   (group, state). Consistent with existing code and provably correct. Costs a
   flatter, longer page.
2. **Make state a required filter** and section by group only. Reduces but does
   not remove collisions: a provider in two granted groups in the same state
   still collides.
3. **Let a cell hold several cases** and define a documented reduction, for
   example worst-status-wins with the count surfaced. Most flexible, most
   product surface, and the reduction rule is a new decision.

Do not resolve this in the UI. A cell that renders one of two cases is a data
contract problem, and it will reach exports and aggregate counts too.

**Product decision required before build.** Add it to the S2 yes/no list.

## Recommended read strategy

Use one client-specific API query with:

1. server-resolved `org_id` and allowed group IDs from S1;
2. server-side state, payer, provider-name, and group filters;
3. keyset/cursor pagination by normalized provider name plus provider ID,
   default and maximum page size 50;
4. a normalized payload containing one provider list, one payer list, and a
   sparse/narrow cell list; no repeated provider/group/facility labels per cell;
5. row virtualization so at most the current provider page is mounted;
6. a separate provider drill-down query for all payer cells for one provider.

Do not add a materialized view or persisted rollup now. The measured database
work is not the bottleneck, and a derived cache would add invalidation and
freshness risk to credentialing status.

### Minimum index strategy

Baseline measurements include the current relevant indexes:

- `credential_cases(org_id)`;
- `credential_cases(provider_id)`;
- separate case payer/group/facility indexes;
- `credential_cases(org_id, case_status)`;
- separate contract group/payer indexes;
- the case and contract unique keys.

No new case index is required to meet the measured 50-provider budget at
60,000 rows. Before enterprise build, add and benchmark one provider-page index
to support stable name cursors without a whole-org sort:

```sql
CREATE INDEX ... ON providers
  (org_id, lower(last_name), lower(first_name), id)
  WHERE status <> 'terminated'
    AND NOT reference_only
    AND NOT is_test_provider
    AND verification_state <> 'pending_verification';
```

That is a recommendation for a future additive migration, not a migration in
this spike. Add a composite case filter index only if the scratch
`EXPLAIN ANALYZE` or realistic concurrent load misses the proposed budget;
the current state/payer/provider queries do not justify one.

**Hosted note.** This is the one index the design actually needs, and it is
worth stating more plainly than "future". Hosted `providers` has no `org_id`
index at all, only the primary key and the partial pending-verification index.
Every org-scoped provider query in the whole application is a sequential scan
today. At 21 rows that is free and invisible. The cursor page above sorts the
whole org's provider set on every request, so this index is what makes the
50-provider window a window rather than a full sort with a `LIMIT` on top.

Separately, hosted carries two pairs of duplicate indexes on
`payer_network_targets`: `idx_payer_network_targets_org_id` and
`payer_network_targets_org_idx` cover the same column, as do
`idx_payer_network_targets_payer_id` and `payer_network_targets_payer_idx`.
Harmless but wasteful on every write. Unrelated to the portal; worth folding
into whatever migration lands the cursor index.

## UX and workflow requirements exposed by scale

- Loading must reserve the grid structure, announce progress, and preserve
  current filters; never blank the full page on page transitions.
- Empty states must distinguish no granted groups, no providers in scope, no
  cases yet, and no filter matches.
- Errors need a retry that retains cursor and filters; partial summary failure
  must not silently render zero.
- Filters and result counts must be URL-addressable so an executive can share
  the same view.
- Keyboard focus must survive virtual-row recycling. Cells need a concise
  accessible name containing provider, payer, and client status; arrow-key or
  documented table navigation is required for a 20-column grid.
- On narrow screens, do not shrink 20 columns into illegibility. Show the
  provider drill-down/list first, with horizontal matrix access as a secondary
  large-screen mode.
- Always show “data current as of” from the response. The executive question is
  a forecast, so stale data must not look exact.
- A summary should answer “15 Raleigh therapists” without making an executive
  scan 300 cells: cohort count, ready-to-bill count, blocked count, and the
  latest expected start date should sit above the paged detail.

## Decisions and blockers

0. **Cell grain (new, blocking):** decide how a `(provider, payer)` cell
   resolves when the granted group set or the state span produces more than one
   case. Reproduced on hosted today. See the section above. This blocks the DTO
   shape, so it outranks everything else here.
1. **Hosted proof:** the schema, index, and key assumptions are now verified
   against hosted read-only. What remains is the timing rerun against
   `vmznysvietfaddakkegt`; local timings cannot establish regional end-to-end
   p95. Lower priority than it looks: at 21 providers there is no live
   performance problem to measure, and the local numbers already disprove the
   unbounded grid.
2. **Raleigh semantics:** use `facilities.city` plus active provider-facility
   assignments, not provider home address. Product must confirm whether “in
   Raleigh” means assigned to any Raleigh facility, the case's selected
   facility, or the provider's primary facility.
3. **Matrix population:** confirm whether columns represent active
   `payer_network_targets`, existing cases, or their union. Current internal
   matrix uses the union so archived targets do not erase cases.
4. **Forecast semantics:** define readiness across credentialing approval,
   contract status, facility effective date, and confirmed payer effective
   date. S2 recommends deriving it, never persisting a flag.
5. **Search behavior:** infix `ILIKE '%term%'` was fast at 3,000 synthetic
   providers, but realistic names and concurrency need scratch validation
   before adding `pg_trgm`.

Subject to those decisions, the 3,000-provider promise is supportable **only
for a paged/virtualized experience**, not for the unbounded grid stated in the
question.

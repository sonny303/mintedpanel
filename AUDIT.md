# OpenPanel Code Audit — July 2026

Full audit of the OpenPanel (Minted) codebase covering correctness bugs, architecture violations, database-vs-UI gaps, cross-page behavioral inconsistencies, duplication/dead code, and data-layer efficiency.

**Method:** every route, service, hook, and feature component was read in full; a scripted comparison matched every column in the generated Supabase types (`src/integrations/supabase/types.ts`, project `fkvuhfsqcmujywzgczmc`) against actual usage in the code and UI layers; anti-pattern greps ran against the rules in `AGENTS.md`.

**Fix workflow:** every actionable finding has a ready-to-paste Lovable prompt in [`KTLO.md`](./KTLO.md), prioritized P0 → P2.

**Environment note:** `bun install` fails outside Lovable (the lockfile pins Lovable's private npm registry, which 403s externally), so typecheck/lint were not run as part of this audit; Lovable runs them natively.

## Contents

- [A. High-severity bugs / correctness](#a-high-severity-bugs--correctness)
- [B. Architecture violations](#b-architecture-violations)
- [C. Database vs code/UI gaps](#c-database-vs-codeui-gaps)
- [D. Cross-page behavioral inconsistencies (KTLO)](#d-cross-page-behavioral-inconsistencies-ktlo)
- [E. Duplication, dead code, dependencies](#e-duplication-dead-code-dependencies)
- [F. Data-layer efficiency](#f-data-layer-efficiency)
- [What's done well](#whats-done-well)

---

## A. High-severity bugs / correctness

| # | Finding | Where | Severity |
|---|---------|-------|----------|
| A1 | **No `<Toaster>` mounted anywhere.** 11 files call `toast()` from sonner, but nothing renders the container — every success/error toast in the app is a silent no-op, including all mutation error handlers that rely on `toast.error`. `src/components/ui/sonner.tsx` exists and is unused. | `src/routes/__root.tsx` (missing mount) | **P0** |
| A2 | **"Stalled" filter is broken and causes N+1 queries.** The toggle at `cases.index.tsx:88` is never referenced by the `filtered`/`sorted` memos (lines 205–231). Stalled logic instead lives per-row in `CaseRow` (lines 498–505), which returns `null` when not stalled — so the "{n} cases" header count is wrong when the filter is on, and **every row calls `useTouches(c.id)`**: one Supabase query per case. | `src/routes/cases.index.tsx` | **P0** |
| A3 | **Silent error swallowing on admin + reports.** No admin page and no reports tab checks `isError`; a failed fetch renders the empty state ("No audit entries match…", "No … match these filters"), so load failures look like empty data. | `admin.payers.tsx`, `admin.statuses.tsx`, `admin.mso-routing.tsx`, `admin.settings.tsx`, `admin.templates.index.tsx`, `admin.audit.tsx:361`, `reports.tsx` (all 4 tabs) | **P0** |
| A4 | **`/providers/new` has no role guard.** The list hides "Add provider" for billing users and the edit page redirects them, but the new page renders and submits for any role (DB RLS is the only backstop). Also: `create.mutateAsync` is awaited with no try/catch (unhandled rejection on failure) and no success toast. | `src/routes/providers.new.tsx:54-57` | **P0** |
| A5 | **`writeAudit` failures are silent.** The `audit_log` insert result is never checked; a mutation can succeed while its compliance-log row silently fails. It also silently no-ops when `orgId` is missing. | `src/lib/audit.ts:23-33` | **P0** |
| A6 | **Sidebar "Dashboard" leads to the marketing site.** `Sidebar.tsx:27` links Dashboard → `/`, which `__root.tsx:131-132,163` treats as a public route rendered **without** AppShell. An authenticated user clicking "Dashboard" is dropped out of the app onto the landing page. There is no actual dashboard route. | `src/components/layout/Sidebar.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx` | **P0** |
| A7 | **Duplicate landing page ships placeholder text.** `routes/landing.tsx` (151 lines) is a self-contained duplicate of the composed `/` landing page, importing none of `src/components/landing/*`, and ships `mailto:YOUREMAIL@DOMAIN.COM` on 3 CTAs (lines 10, 29, 54, 143) — violates the "no placeholder text" rule. `__root.tsx:129` special-cases it. | `src/routes/landing.tsx` | **P0** |
| A8 | **Stale MSO-routing resolver cache.** Rule mutations invalidate `['mso-routing-rules', orgId]` (the list) but never `['mso-routing-rule', …]` (singular — the resolver key used by `useMsoRoutingRule` during case creation). Editing rules leaves case-creation routing stale. | `src/routes/admin.mso-routing.tsx` | **P1** |
| A9 | **No query-cache clear on org switch or sign-out.** `setActiveOrg` (`auth-store.ts:86`) and `signOut` (lines 98–102) never call `queryClient.clear()`. Org-scoped keys prevent stale *serving*, but the previous org's/user's data stays resident in memory after switch/logout. | `src/lib/auth-store.ts` | **P1** |
| A10 | **Cases/contracts are born without a `status_history` row.** `createCase` (`cases.ts:141`) and `createContract` (`contracts.ts:59`) write an audit CREATE but no seed history entry — the initial status is invisible in the timeline; history starts at the first status *change*. | `src/services/cases.ts`, `src/services/contracts.ts` | **P1** |
| A11 | Mutation-error gaps: `tasks.$id.tsx:182-187` auto-completes a task from a `useEffect` with no `onError` (and the effect pattern itself is fragile — deps include the mutation object, guarded only by `isPending`). | `src/routes/tasks.$id.tsx` | P1 |
| A12 | `reports.tsx:344` "N providers" link navigates to `/cases` with no filter — lands on the unfiltered case list instead of scoping to that group/payer. | `src/routes/reports.tsx` | P2 |

## B. Architecture violations

`ARCHITECTURE.md`/`AGENTS.md`: components → hooks → services → Supabase; only `src/services/` may call Supabase. Violations, worst first:

| # | Finding | Where | Severity |
|---|---------|-------|----------|
| B1 | **`admin.settings.tsx` bypasses the entire data layer.** Inline `supabase.from(...)` reads *and writes* on `organizations`, `provider_groups`, `facilities`, `memberships`, `group_insurance_policies` (lines 70–147, 197–218, 525–577, 759–797, 915–932, 1050–1251). **None of the writes create `audit_log` rows** — org config changes and membership/role changes are unaudited. It also defines a private `useProviderGroupsList` with key `['provider-groups', orgId]` shadowing the shared `useProviderGroups` hook — two caches for one table that can disagree after an edit. | `src/routes/admin.settings.tsx` | **P1 (audit gap: P0-adjacent)** |
| B2 | **`admin.mso-routing.tsx`** does direct select/insert/update on `mso_routing_rules` (lines 56–108) with no audit rows; no service exists for writing routing rules. | `src/routes/admin.mso-routing.tsx` | **P1** |
| B3 | **`NewCaseModal.tsx`** imports `supabase` (line 27) and bulk-inserts auto-generated tasks directly (line 365) — those tasks get no audit rows. It also calls the service `getMsoRoutingRule` directly (line 325) instead of the `useMsoRoutingRule` hook, and `catch {}` at line 341 swallows the real create error behind a generic "Save failed". | `src/components/cases/NewCaseModal.tsx` | **P1** |
| B4 | **`reports.tsx`** queries `touches` (whole-org `select('*')`, line 911), `provider_facility_assignments`, `state_licenses`, `facilities` directly (lines 1502–1529), with an unstable array query key `['roster-aux', orgId, providerIds]`. | `src/routes/reports.tsx` | **P1** |
| B5 | **`tasks.$id.tsx`** inlines a notes+profiles query (lines 110–147) that duplicates the author-enrichment logic in `cases.getCase` verbatim. | `src/routes/tasks.$id.tsx` | P1 |
| B6 | `admin.templates.$id.tsx:69-80` inline `rpc('get_sop_field_tokens')`; `admin.statuses.tsx:31` imports the service function `updateStatusConfig` directly instead of a hook. | | P2 |
| B7 | **Query-key factory bypassed on the write path.** Every mutation hook hand-writes invalidation keys (`['cases', orgId]`, `['audit-log', orgId]`, …) instead of using `queryKeys.*`; `useLookups.ts` keys (`facilities`, `provider-groups`, `coordinators`, `state-licenses`, `mso-routing-rule`) aren't in the factory at all, and every route-local query adds more shadow keys. Works today via prefix matching, but the factory no longer describes reality. | `src/hooks/*`, `src/hooks/queryKeys.ts` | P2 |

## C. Database vs code/UI gaps

Comparison of every column in the generated DB types against the code and UI layers. All 21 tables are referenced somewhere; the gaps are at column/feature level.

**Data recorded but never shown to users:**

| Column | Written by | UI gap |
|--------|-----------|--------|
| `status_history.changed_by` | every status change (`cases.ts:190`, `contracts.ts:99`) | The status timeline never shows **who** changed a status — notable for a compliance-oriented product. |
| `credential_cases.created_by` | `cases.ts:132` | Never displayed anywhere. |
| `tasks.completed_date` | `tasks.ts:56,110` | Never displayed — task lists and case detail don't show when a task was completed. |
| `touches.source` | schema supports `'email'` for the planned email-to-touch webhook (SCHEMA.md) | UI never distinguishes email vs manual touches; when the webhook ships, inbound-email touches will be indistinguishable. |

**Schema capability the UI doesn't expose:**

- `notes.entity_type` is generic ("attached to any entity") but the UI only offers notes on **cases and tasks**. Providers, payers, and contracts cannot have notes despite full schema + service support.
- `group_insurance_policies` is managed only through inline code in `admin.settings.tsx`, with stale `as never` casts (lines 1056, 1227, 1234) even though the table **is** in the generated types. No service exists.

**Type drift / dead defensive code:**

- `templates.ts:18-42, 74-80, 107-115` — the `archived` vs `is_archived` retry shim (`TemplateWithArchive`, `shouldRetryArchivedColumn` string-matching the error) is dead code: the migration (`20260613025959`) and generated types both agree the column is `is_archived`.
- Pervasive `as never` casts on **all** service write payloads defeat type-checking on the write path; payloads should be typed as `Database['public']['Tables'][…]['Insert']`.
- `lookups.getMsoRoutingRule:106` casts to reach `createdAt` because it's missing from the `MsoRoutingRule` type.

**Deferred (needs live DB access):** `select distinct color from status_configs` — the five copy-pasted `hexToStatusColor` mappers only recognize 6 hex values; any other configured status color silently renders gray. Run in Lovable or with Supabase MCP approval.

## D. Cross-page behavioral inconsistencies (KTLO)

The root cause of most of these: there is **no shared date util, no shared `EmptyState`, and no shared `hexToStatusColor`** — each page re-implements them. `StatusPill` and `CopyButton` are the only genuinely shared presentational pieces.

1. **Loading states** — main pages use multi-row skeletons; **all 9 admin surfaces** use plain "Loading…" text (`admin.statuses.tsx:276`, `admin.payers.tsx:126`, `admin.mso-routing.tsx:218,294`, `admin.audit.tsx:358`, `admin.settings.tsx:296,975,1120`, `admin.templates.index.tsx:132`, `admin.templates.$id.tsx:451`); reports ContractsTab has a one-off single-skeleton-cell pattern (`reports.tsx:300`).
2. **Error states** — main list/detail pages show inline retry; `providers.$id.edit.tsx:139` shows bare text with no retry; `providers.$id.index.tsx:150` collapses error into "Provider not found"; admin + reports are silent (A3).
3. **Empty states** — ~14 hand-rolled variants with inconsistent punctuation and structure ("No payers yet." / "No tasks yet" / "No data." / rich icon+copy on `cases.$id.tsx:457`).
4. **Page headers** — list pages use `PageHeader`; the three detail pages hand-roll headers (`cases.$id.tsx:230-318`, `providers.$id.index.tsx:226-301`, `tasks.$id.tsx:274-341`); only `tasks.$id` has back-links; templates pages double-pad (`p-6` inside AppShell's `p-4`: `admin.templates.index.tsx:74`, `admin.templates.$id.tsx:465`).
5. **Filtering/search** — providers list filters **server-side** via `useProviders(filters)`; cases list fetches everything and filters **client-side**; `useDebounced` is duplicated in both (`cases.index.tsx:59`, `providers.index.tsx:49`) and absent from templates search; only reports persists filter state to the URL (`reports.tsx:68-81`); only `admin.audit` paginates — and it fetches `limit: 1000` then filters `dateTo` client-side (lines 186–191).
6. **Role gating** — three different `canEdit` derivations coexist: `role !== 'billing'` (cases/providers/tasks), `role === 'admin'` (admin pages), `role === 'specialist' || role === 'admin'` (`reports.tsx:163`, `canTerminate`). No shared helper. `providers.$id.edit.tsx:32` guards via post-render `useEffect` redirect (flash) instead of `beforeLoad`.
7. **Date formatting** — `fmtDate` re-declared 4× with diverging formats: `'MMM dd, yyyy'` (cases.$id, tasks.$id, reports) vs `'MMM d, yyyy'` (providers.$id.index:80, tasks.index:343, admin.settings, admin.templates); `fmtDateTime` separator differs (`h:mm a` vs `· h:mm a`); `admin.audit` uses `'yyyy-MM-dd HH:mm:ss'`; `parseISO` vs raw `new Date()` mixed.
8. **Confirmations/toasts** — one native `window.confirm` (`admin.templates.$id.tsx:205`) vs styled `Dialog` everywhere else; success-toast wording drifts on trailing periods ("Rule added." vs "Payer updated"); `providers.new` fires no success toast at all.
9. **Navigation** — `__root.tsx:66` "Go home" is a raw `<a href="/">` (full reload) while the sibling NotFound branch uses `<Link>`; `landing.tsx` uses raw anchors.

**Consistent (don't churn):** object-form `navigate` + `Route.useParams()` everywhere; `Dialog` as the only modal primitive; `'__all__'` select sentinel; mutation `toast.error` call-sites (once the Toaster is mounted); admin read-only banner copy.

## E. Duplication, dead code, dependencies

1. **`ProviderForm.tsx` (773) vs `EditProviderForm.tsx` (470) — ~70% copy-paste.** Duplicated verbatim: `US_STATES` (ProviderForm:19-24 / Edit:21-26), `Field`/`FieldLabel` (270-297 / 443-470), state helpers, and the four field sections' JSX. **Divergent validation:** Edit requires first/last name (`Edit:30-39`), Add does not (`validateStep:108-119`). SSN/NPI/CAQH regexes duplicated. The header comment on ProviderForm claiming it serves both flows is stale.
2. **Helpers copy-pasted across routes:** `hexToStatusColor` ×5 (cases.index:41, cases.$id:73, providers.index:37, providers.$id.index:53, reports:85), `fmtDate` ×4, `fmtDateTime` ×2, `useDebounced` ×2, `Th` header cell ×4 (cases.index:440, providers.index:301, tasks.index:386, providers.$id.index:713).
3. **Pills bypassing `StatusPill`,** each re-hardcoding the palette: `YesNoPill` (admin.payers:57), `roleBadge` (admin.settings:885), route-type pills (admin.mso-routing:242-250), `ActionPill` (admin.audit:44), group active/inactive pill (admin.settings:324), insurance policy pill (admin.settings:1072), provider-group chip ×2 (providers.index:363, providers.$id.index:246).
4. **Giant route files** mixing data helpers, charts, dialogs, and multiple panels: `reports.tsx` **1807**, `admin.settings.tsx` **1340** (39 `useState`s), `cases.$id.tsx` **1005**, `admin.templates.$id.tsx` **880**.
5. **29 of ~46 `src/components/ui/` files have zero imports** (largest: `sidebar.tsx` 744 lines, `chart.tsx` 331): accordion, alert, alert-dialog, aspect-ratio, avatar, breadcrumb, calendar, carousel, chart, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, sidebar, slider, sonner*, toggle-group; chain-dead: sheet, toggle. (*sonner becomes used once the Toaster is mounted — keep it.) These are protected files; prune only with explicit instruction.
6. **Unused dependencies:** `@hookform/resolvers` (0 imports), `react-hook-form` + `zod` (only dead files/scaffold), `embla-carousel-react`, `input-otp`, `react-resizable-panels`, `react-day-picker`, `cmdk`, `vaul`, and ~15 `@radix-ui/*` packages backing dead ui wrappers.
7. **All forms are manual `useState` forms** despite RHF+zod being dependencies — consistent with each other, inconsistent with the declared stack; either adopt or drop the deps.
8. **Misc dead code:** `queryKeys.useOrgKey` (exported, unused), `src/lib/api/example.functions.ts` scaffold, `cases.ts:224` convenience re-exports, inline `style={{ backgroundColor: '#1B4D3E' }}` ×6 overriding the default Button variant (ProviderForm ×3, EditProviderForm:422, admin.templates.*).

## F. Data-layer efficiency

- **`select('*')` on every list** — provider list views pull `ssn_last4`, `date_of_birth`, home address, malpractice fields to the client. Narrow columns per view (PHI minimization as well as payload size).
- **No pagination anywhere except audit** — `getCases`, `getProviders`, `getTasks`, `listContracts` fetch unbounded result sets (`listAuditLog` caps at 200).
- **`getProviders` filters** (`providers.ts:63-80`) — state/payer filters run a separate id-collection query then `.in('id', ids)`: two round trips + a full join-table column fetch. Use `state_licenses!inner(state)` / `credential_cases!inner(payer_id)` join filters.
- **`getCoordinators`** (`lookups.ts:59-74`) — fetches every case's `assigned_to`, dedupes in JS, second query for profiles.
- **`cases.getCase`** — 3 sequential round trips; the notes+profiles enrichment is duplicated in `tasks.$id.tsx` (B5).
- **`terminateProvider`** (`providers.ts:261-320`) — 5+ sequential queries, no transaction; partial failure leaves inconsistent state. Candidate for an RPC.
- **`reports.tsx`** — whole tables fetched and aggregated in JS; use `count: 'exact', head: true` or aggregate views for counts.
- **No `staleTime` on any hook** — slow-changing lookups (payers, msos, status configs, provider groups) refetch on every mount/window focus. (Only `admin.templates.$id.tsx:77` sets one.)
- **No `onError` on any centralized mutation hook** — error surfacing is left to call sites, while route-local mutations do add `onError` toasts. Inconsistent.
- **Copy-pasted CRUD+audit boilerplate** across `payers.ts`, `msos.ts`, `statusConfigs.ts`, `templates.ts` (`requireActiveOrg → snakeizeRow → insert → select().single() → camelizeRow → writeAudit`); the `status_history` insert is duplicated between `cases.updateCaseStatus:182-191` and `contracts.updateContractStatus:91-100`.
- **Silent sub-query error swallowing:** `providers.getProviders:64,73`, `tasks.getTasks:27`, `cases.getCase:91`, `tasks.completeSOPStep:130-135` destructure `{ data }` without checking `error`.
- **Render/execute org race:** hooks compute query keys from `useActiveOrgId()` at render while services independently read `requireActiveOrg()` at execution; an org switch in between can cache data under a mismatched key.

## What's done well

Record these so future KTLO work doesn't churn on them:

- Layering discipline holds *inside* the sanctioned layers: services own Supabase, hooks own keys/invalidation, and the dead `integrations/supabase/client.ts` is genuinely unimported.
- Org-scoped query keys via the central factory give correct cross-org cache partitioning; persisted `activeOrgId` is re-validated against memberships on load.
- Consistent `if (error) throw error` on primary service operations; `maybeSingle()` used correctly.
- Zero `any` in hand-written code; no `console.log`/`TODO` in app code; named exports throughout.
- Append-only invariants (`touches`, `status_history`, `audit_log`) respected everywhere — inserts only.
- `updateCaseStatus`/`updateContractStatus` capture `before` state and write both history and audit.
- `StatusPill` and `CopyButton` are clean and consistently reused; object-form navigation and `Route.useParams()` are uniform; parent routes render only `<Outlet />`.
- The `/` landing page composition (`src/components/landing/*`) is the model pattern: small single-purpose sections, data-as-const, shared `Eyebrow` primitive.
- The three main list pages share a coherent skeleton → error-retry → filter-aware-empty pattern (which is exactly what makes extracting a shared shell cheap).

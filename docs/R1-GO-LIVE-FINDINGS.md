# R1 Go-Live Verification — Findings

Lane: `claude/r1-golive-verification` · Date: 2026-07-05 · Customer 2 goes live July 7.

Scope: full verification pass over the merged app rebuild + server API layer —
build health, route/cutover verification, code-level QA sweep, design
consistency sweep. Evidence: static audit of every route/component/service, a
mocked-Supabase Playwright render pass over **all 20 nav destinations and
detail pages** (admin and billing roles; 1280/1440/390px), and the targeted
test suite (119 tests green).

## Verification results (what was proven, not just read)

- **Build health:** `npm ci`, `tsc --noEmit`, `lint` (0 errors), `vite build`,
  and all server/service targeted test files pass.
- **Routes:** every Sidebar destination + provider/case/launch/task/template
  detail pages render with **zero page errors, zero console errors** against
  live-DB-shaped fixtures. No broken `Link`/`navigate` targets anywhere in
  `src/`. `routeTree.gen.ts` is in sync with the route files.
- **Cutover:** the M6 cutover (`2367555`) was clean — `/tasks` list deleted,
  detail kept, nothing links to the deleted list. Two generated-scaffold
  stragglers found and deleted in this lane (`integrations/supabase/auth-middleware.ts`,
  `integrations/supabase/client.server.ts`, both zero-importer).
- **Layout:** no body-level horizontal scroll on any page at 390px, none at
  1440px; no overlap/clipping observed at 1280/1440 in screenshot review.
- **Billing role:** every mutation affordance is gated (hidden or disabled)
  on every page; deep links to `/providers/new` and `/providers/:id/edit`
  redirect billing away (after the fix below); admin pages render read-only.
- **Cache:** org switch calls `queryClient.removeQueries()`; sign-out clears
  the cache and persisted org (both paths verified in code; event-driven
  sign-out fixed below).

## P0 — blocks July 7

**None open.** Nothing found rose to stop-ship: tenant isolation held in every
check (RLS on the browser path was never bypassable from the UI; the one
`org_id` service-layer gap below is not reachable with attacker-controlled
input from the current UI), and no route fails to render.

## P1 — fix before customer 2 touches it

### Fixed in this branch (UI-layer)

1. **Billing `beforeLoad` guards were race-y on hard loads** — the guards read
   memberships from the zustand store, which is empty until `init()` runs, so
   a billing user deep-linking `/providers/new` or `/providers/:id/edit` got
   the full form (writes still RLS-blocked). Both routes now also check the
   resolved role at render time and redirect. `307cb13`
2. **Event-driven `SIGNED_OUT` left the query cache populated** (token expiry,
   sign-out in another tab) — previous session's org data survived in cache.
   Now cleared like `signOut()`. `d7ce452`
3. **Silent mutation** — the tasks auto-complete effect (`tasks.$id.tsx`)
   fired `useUpdateTaskStatus` with no `onError`; failures showed nothing.
   Now toasts. `ad68c0f`
4. **False success on query failure** — `/home` showed "You're caught up." and
   `/progress` a blank page when queries errored. Both now show the failed
   banner. `a2f01f9`
5. **Reports default tab (`ContractMatrixTab`) had no error/empty state**;
   `FacilitiesPanel` (Group & Locations) had no loading skeleton and no
   error+retry; `/progress` had no empty state. All added. `4e80c9e`
6. **`text-tertiary` is not a defined utility** — used 15× in `admin.audit.tsx`;
   it emitted no CSS, so "faint" labels rendered full-ink. Replaced with
   `text-muted-foreground`. `977258f`
7. **Date-format strays** off the PRD-locked `MMM d, yyyy`: audit timestamps
   (`yyyy-MM-dd HH:mm:ss`), work-view `eff` suffixes (`MMM d`), task due dates
   (`MMM dd`), provider review step (raw ISO), home launch queue, launch date
   display, contracts matrix. All through `fmtDate`/`fmtDateTime` now. `9383a0c`
8. **Inline pill drift** — seven surfaces hand-rolled pill markup; consolidated
   into the `StatusPill` primitive (which gained the `neutral`/`brand`/`violet`
   tones those surfaces already shipped). `250d49a`
9. **390px clipping** on `admin/mso-routing` and `admin/statuses` (min-width
   cells inside a shell that only scrolls vertically) — wrapped in
   `overflow-x-auto` per the `admin.payers` pattern. `977258f`
10. Cutover stragglers deleted (see above). `784f42e`
11. Cosmetic drift batch: `#F9FAFB`→`#FAFAF9`, `#FFFBEB`→`#FEF3C7` amber note
    boxes, `text-[10px]`→`text-[11px]` overlines, TaskDrawer 16px→15px title,
    OrgPanel Save hidden (not disabled) for non-admins. `977258f` `307cb13`

### MCP review — service-layer / SQL; NOT executed in this lane (chat Claude + SS)

> Everything below requires `src/services` or DB changes, which this lane is
> barred from touching. Ordered by priority.

1. **`org_id` can ride caller metadata into two UPDATE paths.**
   `updateCaseStatus` (`src/services/cases.ts:214`) and
   `updateContractStatus` (`src/services/contracts.ts:90`) build the SET as
   `{ status_id, ...snakeizeRow(metadata) }` where `metadata` is an open
   `Record<string, unknown>` — a `metadata.orgId` key would become `org_id` in
   the SET. Current callers (ChangeStatusDialog, StatusChangeContractDialog)
   only pass required-field keys, and RLS `WITH CHECK` bounds the damage to
   orgs the caller belongs to — but the pattern is one new call site away from
   a cross-org write on the service-role path. **Fix: strip `orgId`/`org_id`
   from metadata before spreading, exactly as `updateProvider`
   (`providers.ts:210`) already does.**
2. **Defense-in-depth: 8 more update paths spread typed patches without
   stripping `org_id`:** `providers.ts:349` (`updateProviderWithLicenses`),
   `launches.ts:94`, `orgSettings.ts:114` + `:194`, `msos.ts:54` + `:141`,
   `payers.ts:68`, `statusConfigs.ts:62`. Not exploitable via current typed
   call sites; recommend the same strip for uniformity.
3. **16 list queries use `select("*")`** (task C4 requires explicit columns;
   all are in services): `touches.ts:20`, `payers.ts:26`, `audit.ts:20`,
   `invites.ts:86`, `lookups.ts:32/44/57/131`, `statusConfigs.ts:17`,
   `launches.ts:120`, `msos.ts:14/92`, `orgSettings.ts:68/151/324`,
   `templates.ts:41`. Plus two internal multi-row fetches (`providers.ts:339`,
   `lookups.ts:95`). The well-behaved lists to copy: `CASE_LIST_COLUMNS`,
   `CONTRACT_LIST_COLUMNS`, `TASK_LIST_COLUMNS`, `PROVIDER_LIST_COLUMNS`,
   `PORTAL_FIELD_MAP_COLUMNS`. None of these leak provider PHI today (the
   providers list is already projected), but audit/touches rows carry full
   payloads the pages don't need.
4. **Demo-data hygiene (live DB, via MCP `execute_sql`):** the four facilities
   imported at the launch pivot store the full address in `street`
   (e.g. `"5200 Clinton Pkwy, Lawrence, KS 66047"`), so row displays render
   "…, Lawrence, KS 66047, Lawrence, KS". Normalize street/city/state/zip on
   those rows before the customer-2 demo.
5. **Profile-read audit decision** is still open (post-gate package §
   Implementation considerations): `/api/providers/:id/profile` returns full
   PHI and reads are not audited; default-if-undecided was "log reads", which
   needs the `audit_log.action_type` check-constraint migration to add `READ`.

## P2 — parked (list only, no action this lane)

- `/progress` has **zero inbound links** (deliberate: owner-facing URL shared
  out-of-band; nav was finalized without it in M6). Confirm the distribution
  story for customer 2, or add an admin-visible link later.
- `src/start.ts` registers `attachSupabaseAuth` middleware which imports the
  dead generated `client.ts`; that client reads `VITE_SUPABASE_PUBLISHABLE_KEY`
  (not the `ANON_KEY` the app sets) and throws on first use. Dormant today —
  zero `createServerFn` call sites — but the first serverFn ever added will
  break. Remove the middleware + both generated files when `start.ts` is next
  touched.
- `services/tablePrefs.ts` + hosted `user_table_prefs` are stranded-but-kept
  (self-documented "do not delete"); no UI reads them since the cutover
  removed `useTablePrefs`.
- Palette coexistence: warm gray (`#F5F5F4`/`#E8E5E0`) vs StatusPill cool gray
  (`#F3F4F6`/`#E5E7EB`) both live as "canonical in context"; the violet
  `TOUCH_LOGGED` tone and brand-green Admin badge are now named StatusPill
  variants. Revisit palette unification post-R1 if desired.
- Sidebar/search overlines use fractional `text-[10.5px]` (protected
  `layout/` files) — off-ramp but confined to chrome.
- Remaining bare tables without `overflow-x` wrappers (reports Summary tables,
  providers detail tables, templates list, Insurance/Members panels,
  GroupsPanel itself — the reference) — desktop-first accepted tradeoff; the
  shell clips rather than scrolls, so wrap opportunistically when touched.
- Owner-view short dates ("since Jun 12", `MMM d`) in
  `ownerWording.ts`/`progress.tsx` are deliberate plain-language copy (tested);
  Home's "Sunday, July 5" greeting is deliberate. RosterTab preview renders
  `yyyy-MM-dd` for CSV parity. Left as-is; flag if SS wants years there.
- `provider_facility_assignments.is_primary` is read but never written by the
  app; provider edit drops facility assignments (both pre-existing, documented
  in CLAUDE.md).
- The e2e smoke suite only asserts unauthenticated redirects. The
  mocked-Supabase fixture harness used for this verification (CLAUDE.md
  recipe; auth via seeded localStorage session + PostgREST emulation over
  live-DB fixture rows) proved all 20 pages render — worth promoting into
  `e2e/` post-R1 so CI covers authenticated renders.
- Lint carries 12 pre-existing warnings (react-refresh export shape,
  `useMemo` dependency hints in audit/templates/tasks) — no errors.

## MCP review

Chat-Claude/SS action list, in order:

1. Strip `org_id` from `updateCaseStatus`/`updateContractStatus` metadata
   (P1-MCP #1), then sweep the 8 defense-in-depth spreads (P1-MCP #2).
2. Explicit column lists for the 16 `select("*")` list queries (P1-MCP #3).
3. Normalize the four launch-pivot facility addresses in the live DB
   (P1-MCP #4).
4. Decide profile-read auditing before extension M1 (P1-MCP #5); needs the
   `audit_log.action_type` check-constraint migration if "log reads" stands.
5. On next `start.ts` change: drop `attachSupabaseAuth` + generated
   `client.ts` (P2).

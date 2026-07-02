# KTLO Backlog — Lovable Prompt Pack

Companion to [`AUDIT.md`](./AUDIT.md). Each item below is a self-contained prompt to paste into Lovable, ordered so earlier fixes don't conflict with later ones (shared utilities land before the pages that consume them). Reference codes (A1, B3, …) point to the audit findings.

**Run order matters within each priority band.** P0 items are correctness bugs; P1 items are architecture and consistency debt; P2 items are refactors and cleanup that can be scheduled any time.

---

## P0 — Correctness

### KTLO-1: Mount the sonner Toaster (A1)

All toasts in the app are silent no-ops because no `<Toaster>` is mounted.

```text
Bug: toast() from sonner is called in 11 files but no <Toaster> component is mounted anywhere, so no toast ever renders — success and error feedback is completely invisible.

Fix: import { Toaster } from '@/components/ui/sonner' and render <Toaster /> once in src/routes/__root.tsx so it is present on every page (public and authenticated). Do not modify src/components/ui/sonner.tsx itself. Verify by triggering any mutation (e.g. edit a payer in Admin → Payers) and confirming the success toast appears.
```

### KTLO-2: Fix the broken "Stalled" filter and its N+1 queries (A2)

```text
Bug in src/routes/cases.index.tsx: the "Stalled" filter toggle (state declared around line 88) is never applied — the `filtered` and `sorted` useMemo blocks (~lines 205-231) don't reference it. Instead each <CaseRow> (~lines 498-505) calls useTouches(caseId) and returns null when the case isn't stalled. Two consequences: the "{n} cases" header count is wrong when Stalled is on, and every rendered row fires its own Supabase query for touches (N+1).

Fix:
1. Remove the per-row useTouches call and the return-null logic from CaseRow.
2. Compute "stalled" once at the page level: fetch the latest touch date per case in a single query (add a service function in src/services/touches.ts or extend the cases service to return last_touch_date per case — one query for all visible cases, e.g. selecting case_id, max(touch_date) grouped by case, or ordering touches by case), then apply the stalled predicate inside the `filtered` memo so the header count and rows agree.
3. Keep the existing stalled threshold logic identical — only move where it is evaluated.

Guardrails: keep the components → hooks → services layering (no supabase calls in the route file); do not modify supabase/migrations; no new dependencies.
```

### KTLO-3: Surface query errors on admin pages and reports (A3)

```text
Bug: none of the admin pages or reports tabs check isError on their queries, so a failed fetch renders the empty state ("No audit entries match…", "No … match these filters") and looks like empty data.

Affected: src/routes/admin.payers.tsx, admin.statuses.tsx, admin.mso-routing.tsx, admin.settings.tsx, admin.templates.index.tsx, admin.audit.tsx (~line 361), and all four tabs in src/routes/reports.tsx (Contracts, Matrix, Summary, Roster).

Fix: in each of these, when the query has isError, render an inline error row/panel with the message and a "Retry" button that calls refetch() — match the existing pattern already used in src/routes/cases.index.tsx (~line 392) and providers.index.tsx (~line 243) so error UI is consistent app-wide. Do not change the empty-state rendering for genuinely empty data.

Guardrails: UI-only change; do not alter queries, services, or supabase/migrations.
```

### KTLO-4: Guard /providers/new and fix its submit handling (A4)

```text
Three fixes in src/routes/providers.new.tsx:

1. Role guard: billing users can currently open and submit this page (the providers list hides the "Add provider" button for billing and providers.$id.edit.tsx redirects them, but this page has no check). Add the same guard as the edit page, but implement it in the route's beforeLoad (redirect to /providers) rather than a post-render useEffect, so there's no flash.
2. The submit handler awaits create.mutateAsync (~lines 54-57) with no try/catch — a failed create is an unhandled promise rejection with zero user feedback. Wrap it and show toast.error with the error message, matching the pattern used in providers.$id.edit.tsx.
3. Add a success toast ("Provider added") after successful creation, consistent with "Provider updated" on the edit page.

While there, also change providers.$id.edit.tsx to do its billing-role redirect in beforeLoad instead of its current useEffect (~lines 32-36), for consistency.

Guardrails: do not modify supabase/migrations or RLS; the DB remains the enforcement backstop — this is UI parity.
```

### KTLO-5: Make writeAudit failures loud (A5)

```text
Bug in src/lib/audit.ts (~lines 18-33): writeAudit inserts into audit_log but never checks the insert's error — a mutation can succeed while its compliance-log row silently fails. It also returns silently when orgId is missing.

Fix: after the insert, check the returned error and throw it so the calling service surfaces the failure (callers already run inside try/catch or React Query mutation error paths). When orgId is missing, throw an explicit Error('writeAudit: no active org') instead of returning silently. Do not change the audit_log schema, the append-only semantics, or any call sites' payloads.

Guardrails: do not modify supabase/migrations; audit_log remains append-only.
```

### KTLO-6: Delete the duplicate landing page with placeholder text (A7)

```text
Cleanup: src/routes/landing.tsx is a 151-line self-contained duplicate of the real landing page at / (src/routes/index.tsx, which composes src/components/landing/*). It imports none of the shared landing components and ships placeholder text: mailto:YOUREMAIL@DOMAIN.COM on three CTAs (lines ~10, 29, 54, 143).

Fix: delete src/routes/landing.tsx and remove the pathname === "/landing" special-case in src/routes/__root.tsx (~line 129). If any link references /landing, point it at /. Do not modify the components in src/components/landing/ — the composed / page is the maintained one.
```

### KTLO-7: Fix "Dashboard" nav pointing at the marketing page (A6)

Decide the product intent first — the prompt below implements the cheapest correct option.

```text
Bug: the sidebar's "Dashboard" item (src/components/layout/Sidebar.tsx, ~line 27) links to /, which is the public marketing landing page rendered WITHOUT the app shell (src/routes/__root.tsx treats / as public, ~lines 131-132 and 163). An authenticated user who clicks "Dashboard" is dropped out of the app onto the marketing site. There is no dashboard route.

Fix (minimal): remove the "Dashboard" entry from the sidebar nav so /cases is the first item, and make authenticated visits to / redirect to /cases (in the index route's beforeLoad, only when a session exists — keep / as the public landing page for signed-out visitors).

Note: Sidebar.tsx is a protected layout file — this edit is explicitly authorized for this fix only. If we later want a real dashboard, that's a separate feature request.
```

---

## P1 — Architecture & consistency

### KTLO-8: Extract shared formatting/status utilities (D7, E2 — run before KTLO-9+)

```text
Refactor: several small helpers are copy-pasted across route files with drifting behavior. Create shared versions and replace ALL call sites:

1. Create src/lib/format.ts with named exports:
   - fmtDate(value): format(parseISO(value), 'MMM d, yyyy') with try/catch returning '—' for null/invalid.
   - fmtDateTime(value): same guard, format 'MMM d, yyyy · h:mm a'.
   These replace the local fmtDate in cases.$id.tsx (~line 85), tasks.$id.tsx (~line 59), providers.$id.index.tsx (~line 77), reports.tsx (~line 103), and the local fmtDateTime in cases.$id.tsx and tasks.$id.tsx. Also replace the inline date formatting in tasks.index.tsx (~line 343), admin.settings.tsx (~lines 1002, 1158) and admin.templates.* — use parseISO via these helpers instead of new Date(). Standardize on 'MMM d, yyyy' everywhere. Leave admin.audit.tsx's technical 'yyyy-MM-dd HH:mm:ss' timestamp format as-is.
2. Move hexToStatusColor into src/components/StatusPill.tsx (exported alongside StatusPill) and delete the five identical copies in cases.index.tsx (~41), cases.$id.tsx (~73), providers.index.tsx (~37), providers.$id.index.tsx (~53), reports.tsx (~85).
3. Create src/hooks/useDebounced.ts and replace the two local copies in cases.index.tsx (~59) and providers.index.tsx (~49); also apply it to the template search input in admin.templates.index.tsx (~line 100).

Guardrails: pure refactor — no visual or behavioral changes beyond unifying the date format to 'MMM d, yyyy'; named exports only; no new dependencies.
```

### KTLO-9: Move admin.settings data access behind services + hooks, with audit logging (B1)

```text
Architecture fix: src/routes/admin.settings.tsx calls supabase directly for reads AND writes on organizations, provider_groups, facilities, memberships, and group_insurance_policies (inline useQuery/useMutation blocks around lines 70-147, 197-218, 525-577, 759-797, 915-932, 1050-1251). None of these writes create audit_log rows — org config, group, facility, insurance, and membership/role changes are currently unaudited. It also defines a private useProviderGroupsList hook with query key ['provider-groups', orgId] that shadows the shared useProviderGroups hook — two caches for the same table.

Fix:
1. Create src/services/orgSettings.ts (or split into settings-domain services) with functions for: getOrganization/updateOrganizationName, list/create/update provider_groups, list/create/update facilities, list/update memberships (role changes), list/create/update group_insurance_policies. Follow the existing service conventions in src/services/payers.ts: requireActiveOrg(), snakeizeRow/camelizeRow, if (error) throw error, and writeAudit(...) on every create/update with appropriate entityType ('organization', 'provider_group', 'facility', 'membership', 'group_insurance_policy') and before/after payloads.
2. Create matching hooks in src/hooks (e.g. useOrgSettings.ts) that own the query keys and invalidations. Remove the local useProviderGroupsList and use the existing shared useProviderGroups hook from src/hooks for provider groups so there is one cache.
3. Replace all inline supabase usage in admin.settings.tsx with these hooks. Remove the 'as never' casts on group_insurance_policies — the table exists in src/integrations/supabase/types.ts, so type the payloads properly.
4. No UI/behavior changes beyond the writes now being audited.

Guardrails: do not modify supabase/migrations or RLS; audit_log is append-only (insert only); no 'any' — use the generated Database types; named exports.
```

### KTLO-10: MSO routing rules service + resolver cache fix (B2, A8)

```text
Two related fixes for MSO routing:

1. Architecture: src/routes/admin.mso-routing.tsx does direct supabase select/insert/update on mso_routing_rules (~lines 56-108) with no audit_log rows. Create service functions (listRoutingRules, createRoutingRule, updateRoutingRule) — put them in src/services/msos.ts or a new mso RoutingRules section — following the conventions in src/services/payers.ts including writeAudit on create/update with entityType 'mso_routing_rule'. Wrap them in hooks and use those from the route.
2. Cache bug: rule mutations currently invalidate only ['mso-routing-rules', orgId] (the admin list) but NOT ['mso-routing-rule', ...] (the singular resolver key used by useMsoRoutingRule in src/hooks/useLookups.ts during case creation). After editing rules, new-case routing uses stale data. Make the new mutation hooks invalidate both key families, and add both keys to src/hooks/queryKeys.ts.

Guardrails: do not modify supabase/migrations; no behavior change to the resolver ranking logic in src/services/lookups.ts or src/lib/sopResolver.ts.
```

### KTLO-11: Shared notes service + NewCaseModal data-layer fixes (B3, B5)

```text
Three related data-layer fixes:

1. src/routes/tasks.$id.tsx (~lines 110-147) inlines a supabase query for notes + a second profiles fetch to attach author names — duplicating the exact enrichment logic already inside cases.getCase (src/services/cases.ts ~lines 78-103). Extract a shared service function getNotesFor(entityType, entityId) in src/services/lookups.ts or a new src/services/notes.ts that returns notes with authorName resolved, use it from a hook (useNotes(entityType, entityId)), and consume that hook in both tasks.$id.tsx and cases.getCase's callers. Remove the inline supabase usage from the route.
2. src/components/cases/NewCaseModal.tsx (~line 365) inserts auto-generated tasks with a direct supabase.from('tasks').insert — bypassing the service layer, so those tasks get no audit_log rows. Move the bulk insert into a service function (e.g. createTasksForCase in src/services/tasks.ts) that writes an audit entry, and call it via the existing mutation flow. Also (~line 325) the modal calls the service getMsoRoutingRule directly — switch to the useMsoRoutingRule hook. And the catch {} around line 341 swallows the real error behind a generic "Save failed" — surface err.message in the toast instead.
3. After the case is created, also invalidate the audit-log query key so Admin → Audit reflects the new entries.

Guardrails: do not modify supabase/migrations; audit_log is append-only; keep the existing SOP template task-generation logic identical (src/lib/sopResolver.ts is protected — do not edit).
```

### KTLO-12: Reports data access behind services (B4)

```text
Architecture fix in src/routes/reports.tsx: the route queries supabase directly — touches with select('*') for the whole org (~line 911) for the Summary tab, and provider_facility_assignments / state_licenses / facilities for the Roster tab (~lines 1502-1529), with an unstable query key ['roster-aux', orgId, providerIds] (an array that changes identity every render cycle).

Fix:
1. Add service functions for these reads (e.g. in src/services/lookups.ts or a new src/services/reports.ts): touch counts/dates needed by Summary (select only the columns used — case_id, touch_date — not '*'), and the roster aux data (assignments, licenses, facilities for the org — fetch org-wide, not keyed by the providerIds array, and join/filter in the component from the already-loaded providers).
2. Wrap in hooks with stable keys registered in src/hooks/queryKeys.ts (e.g. ['touch-summary', orgId], ['roster-aux', orgId]).
3. Replace the inline supabase usage in reports.tsx. No visual changes to any report.

Guardrails: keep aggregation logic identical; do not modify supabase/migrations; no new dependencies.
```

### KTLO-13: Seed initial status history + clear cache on org switch (A9, A10)

```text
Two data-lifecycle fixes:

1. Initial status invisible in timeline: createCase (src/services/cases.ts, ~line 141) and createContract (src/services/contracts.ts, ~line 59) write an audit CREATE but no status_history row, so a case/contract's initial status never appears in the timeline — history starts at the first status CHANGE. After a successful create, insert one status_history row (from_status_id null, to_status_id = the initial status, track 'credentialing' or 'contracting', changed_by = current user) matching the shape used in updateCaseStatus (~lines 182-191) and updateContractStatus (~lines 91-100). While there, extract that duplicated insert into a shared helper appendStatusHistory({track, caseId?, contractId?, fromStatusId, toStatusId, metadata?}) used by all four call sites.
2. Stale cache across org switch / sign-out: setActiveOrg (src/lib/auth-store.ts ~line 86) and signOut (~lines 98-102) never clear the React Query cache, so the previous org's (and previous user's) data stays resident in memory. Call queryClient.clear() on sign-out and remove/invalidate all queries on org switch. The QueryClient lives where the app providers are set up (src/router.tsx or __root) — expose it to the store via a setter or import, whichever fits the existing wiring.

Guardrails: status_history is append-only (insert only); do not modify supabase/migrations.
```

### KTLO-14: One role-permission helper (D6)

```text
Consistency fix: role gating is derived three different ways across pages — role !== 'billing' (cases.$id.tsx ~128, providers.$id.index.tsx ~90, providers.index.tsx ~61, tasks.$id.tsx ~154), role === 'admin' (all admin pages), and role === 'specialist' || role === 'admin' (reports.tsx ~163, canTerminate in providers.$id.index.tsx ~91).

Fix: add named helpers to src/lib/auth-store.ts (or a new src/lib/permissions.ts): canWrite(role) (admin or specialist), isAdmin(role), plus a useCanWrite()/useIsAdmin() hook if convenient. Replace every inline derivation listed above. Note role !== 'billing' and canWrite are equivalent today (roles are admin|specialist|billing) — unifying on canWrite makes intent explicit and future-proofs a fourth role.

Guardrails: pure refactor, no behavior change; named exports; do not touch RLS or supabase/migrations.
```

### KTLO-15: Consistent loading & empty states on admin pages (D1, D3)

```text
Consistency pass: main list pages (cases, providers, tasks) show multi-row table skeletons while loading, but every admin surface shows plain "Loading…" text: admin.statuses.tsx ~276, admin.payers.tsx ~126, admin.mso-routing.tsx ~218 and ~294, admin.audit.tsx ~358, admin.settings.tsx ~296/975/1120, admin.templates.index.tsx ~132, admin.templates.$id.tsx ~451. Reports' ContractsTab also has a one-off single-skeleton-cell (reports.tsx ~300) unlike the multi-row pattern elsewhere.

Fix:
1. Create a small shared component src/components/TableSkeletonRows.tsx ({ rows, cols }) that renders the same skeleton-row markup used in cases.index.tsx (~line 382), and an EmptyState component ({ message, action? }) for the centered empty text.
2. Replace the "Loading…" text on all the admin surfaces above with the skeleton component (matching each table's column count), and fix reports ContractsTab to use it too.
3. Sweep the hand-rolled empty states (~14 variants: "No payers yet.", "No tasks yet", "No data.", etc.) to use EmptyState with consistent copy: sentence case, no trailing period, e.g. "No payers yet", "No rules match these filters".

Guardrails: presentational only — no query or data changes; keep the richer empty states that include action buttons (e.g. Clear filters on list pages, "No touches logged yet" on the case page) by passing them through EmptyState's action slot; do not modify src/components/ui/* primitives.
```

---

## P2 — Refactors, cleanup, surfacing

### KTLO-16: Merge ProviderForm and EditProviderForm (E1)

```text
Refactor: src/components/providers/ProviderForm.tsx (773 lines, the multi-step Add flow) and src/components/providers/EditProviderForm.tsx (470 lines, single-page Edit) are ~70% copy-paste: US_STATES duplicated (ProviderForm ~19-24 / Edit ~21-26), Field + FieldLabel helpers duplicated (~270-297 / ~443-470), the update/updateRow/addRow/removeRow/toggleFacility state helpers, and the four field-section JSX blocks (Personal / Credentials / Licenses / Employment) are near-identical. Validation has silently diverged: Edit requires first/last name, Add does not.

Fix:
1. Extract shared pieces into src/components/providers/: US_STATES + validation regexes (SSN ^\d{4}$, NPI ^1\d{9}$, CAQH ^\d{8}$, email) into providerFormShared.ts, Field/FieldLabel into FormField.tsx, and the four section bodies into section components that take (form, errors, update) props.
2. Rebuild both forms on those sections — keep ProviderForm's stepper UX and EditProviderForm's single-page layout; only the section internals are shared.
3. Unify validation: both flows require first and last name (the Add flow currently allowing empty names is a bug, not a feature).
4. Fix the stale header comment in ProviderForm.tsx claiming it serves both Add and Edit.
5. While there: remove the inline style={{ backgroundColor: '#1B4D3E' }} overrides (ProviderForm ~218, ~223, ~248; EditProviderForm ~422) — the default Button variant already renders the primary token with proper hover states.

Guardrails: no visual redesign — same fields, same steps, same layout; named exports; no new dependencies (do NOT introduce react-hook-form here).
```

### KTLO-17: Prune dead ui components and dependencies (E5, E6, E7)

```text
Cleanup — explicit authorization to remove protected src/components/ui files that are verified dead:

1. Delete the ui components with zero imports anywhere in src: accordion, alert, alert-dialog, aspect-ratio, avatar, breadcrumb, calendar, carousel, chart, command, context-menu, drawer, form, hover-card, input-otp, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, sidebar, slider, toggle-group — plus sheet and toggle (only imported by other dead files). Keep sonner (Toaster is mounted now), and keep: button, input, select, label, dialog, skeleton, textarea, tooltip, checkbox, separator, tabs, switch, card, table, dropdown-menu, collapsible, badge. Verify each deletion with a project-wide import search before removing.
2. Remove now-unused dependencies from package.json: @hookform/resolvers, react-hook-form, zod (only used by src/lib/api/example.functions.ts — delete that scaffold file too), embla-carousel-react, input-otp, react-resizable-panels, react-day-picker, cmdk, vaul, and each @radix-ui/* package whose only consumer was a deleted ui file (accordion, alert-dialog, aspect-ratio, avatar, context-menu, hover-card, menubar, navigation-menu, popover, progress, radio-group, scroll-area, slider, toggle, toggle-group). Re-check imports before removing each.
3. Also delete: the unused useOrgKey export in src/hooks/queryKeys.ts, and the unused type re-exports at the bottom of src/services/cases.ts (~line 224) if nothing imports them.
4. Run a full build afterward to confirm nothing broke.

Note: the app's forms are all manual useState forms; removing react-hook-form/zod codifies that as the convention.
```

### KTLO-18: Data-layer efficiency pass (F)

```text
Efficiency pass on src/services and src/hooks — no behavior changes:

1. Column narrowing: replace select('*') with explicit column lists on LIST queries. Priority: getProviders list view currently pulls ssn_last4, date_of_birth, home address, and malpractice fields to the client for a table that shows none of them — select only the columns the providers table view renders (plus id/group/status fields). Same pass for getCases, getTasks, listContracts list queries. Detail (single-row) queries can keep '*'.
2. getProviders filters (src/services/providers.ts ~63-80): the state/payer filters run a separate id-collection query then .in('id', ids). Replace with PostgREST inner-join filters: state_licenses!inner(state) and credential_cases!inner(payer_id). Also: the two sub-queries there destructure { data } without checking error — throw on error like the rest of the service. Same silent-error fix in tasks.getTasks (~27), cases.getCase profiles fetch (~91), and tasks.completeSOPStep termination update (~130-135).
3. getCoordinators (src/services/lookups.ts ~59-74): fetches every case's assigned_to then dedupes in JS with a second profiles query — replace with a single query joining profiles, or select distinct assigned_to.
4. staleTime: add staleTime (5 minutes is fine) to the slow-changing lookup hooks in src/hooks/useLookups.ts and the payers/msos/status-configs/provider-groups list hooks so they stop refetching on every mount and window focus.
5. Register the useLookups query keys (facilities, provider-groups, coordinators, state-licenses, mso-routing-rule) in src/hooks/queryKeys.ts and use factory keys for mutation invalidations in the hooks instead of hand-written arrays.

Guardrails: no pagination changes in this pass (separate decision); no RPC/migration changes; verify each list page still renders every column it did before.
```

### KTLO-19: Split the giant route files (E4)

```text
Refactor for maintainability — split the four largest route files into feature components per the architecture convention (feature components live in src/components/[module]/):

1. src/routes/reports.tsx (1807 lines): extract each tab into src/components/reports/ — ContractsTab.tsx, MatrixTab.tsx, SummaryTab.tsx, RosterTab.tsx — plus the CSV export util into src/lib/csv.ts and the two dialogs into their own files. The route file keeps only the tab switcher, URL search-param handling, and layout.
2. src/routes/admin.settings.tsx (1340 lines): extract each settings panel into src/components/settings/ — OrgPanel, GroupsPanel, FacilitiesPanel, InsurancePanel, MembersPanel — each owning its own dialog.
3. src/routes/cases.$id.tsx (1005 lines): extract src/components/cases/ CaseHeader, CaseTasksPanel, CaseTouchesPanel, CaseHistoryPanel, CaseNotesPanel and the status-change dialog.
4. src/routes/admin.templates.$id.tsx (880 lines): extract the template task editor rows and the token-help panel into src/components/templates/. Also replace its window.confirm('Discard unsaved changes?') (~line 205) with the same Dialog-based confirm pattern used elsewhere in the app.

Guardrails: pure extraction — zero behavior or visual changes; components take props, no new global state; named exports; keep hooks usage at the same level it is today (extract JSX + local state together per panel). Do these one file at a time and verify the page after each.
```

### KTLO-20: Surface recorded data the UI never shows (C)

```text
Feature/consistency: the database records several fields the UI never displays:

1. status_history.changed_by is written on every status change but the status timeline on the case page (src/routes/cases.$id.tsx history panel) never shows WHO made the change. Resolve changed_by to the profile's full name (the cases service already has a profiles-enrichment pattern) and display "by {name}" next to each timeline entry.
2. tasks.completed_date is set when a task completes but never displayed. Show it on completed tasks in the case detail task list and the tasks list page ("Completed Mar 4, 2026" style, using the shared fmtDate).
3. touches.source exists to distinguish manual vs inbound-email touches (email webhook is planned). Show a small "email" pill on touches where source === 'email' in the touches timeline so the UI is ready when the webhook ships. Manual touches show nothing.
4. Optional, decide before implementing: notes.entity_type supports notes on any entity, but the UI only offers notes on cases and tasks. If desired, add the same notes panel to the provider detail page (entity_type 'provider').

Guardrails: read-only surfacing — no schema or service-write changes except reusing the existing notes create flow for item 4; use shared fmtDate from src/lib/format.ts.
```

### KTLO-21: Remove dead type-drift shims (C)

```text
Cleanup in src/services/templates.ts: the archived-column compatibility shim is dead code — the migration (supabase/migrations/20260613025959_*) and the generated types (src/integrations/supabase/types.ts) both agree the column is is_archived. Remove the TemplateWithArchive shim (~lines 18-42), the payload column toggler (~74-80), and the shouldRetryArchivedColumn error-message string-matching retry (~107-115); use is_archived directly.

Also, a broader typing pass: service write payloads are cast 'as never' throughout src/services/*, which defeats type-checking on the write path. Replace with proper generated types — Database['public']['Tables']['<table>']['Insert'] / ['Update'] — starting with templates.ts, cases.ts, providers.ts. Fix the cast in src/services/lookups.ts (~106) by adding createdAt to the MsoRoutingRule type in src/types/index.ts (additive change, allowed).

Guardrails: src/types/index.ts is additive-only; do not modify supabase/migrations; no behavior changes — this is types only. Verify the build passes.
```

---

## Deferred / needs live data

- **Status color coverage:** the shared `hexToStatusColor` (after KTLO-8) only recognizes 6 hex values; any other color configured in `status_configs` silently renders gray. Run `select distinct color from status_configs;` against the DB — if other colors exist, either extend the mapper or constrain the admin color picker to the 6 supported values.
- **Pagination strategy:** no list except audit paginates; fine at demo scale, revisit when any org exceeds a few hundred cases/providers (decide server-side `.range()` + count vs infinite scroll once, apply everywhere).
- **`terminateProvider` atomicity:** 5+ sequential non-transactional queries (`providers.ts:261-320`); if partial-failure reports appear, move it into a Postgres RPC.
- **Filter-state persistence:** only reports persists filters to the URL; cases/providers/tasks filters reset on navigation. Product decision on whether list filters should be URL-backed (recommended) before prompting the change.

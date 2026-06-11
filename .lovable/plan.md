## Provider List at /providers

Replace the placeholder in `src/routes/providers.index.tsx` with the full list per the screenshot. Parent `providers.tsx` stays as `<Outlet />`.

### Data sources (hooks only)
- `useProviders({ groupId, state, payerId, status, search })` — already filters server-side; debounce search input (300ms) before passing.
- `useCases({})` — fetch all org cases once; group by `providerId` to render a Payer Status pill per case.
- `useStatusConfigs('credentialing')` — map `case.credentialingStatusId` → color (gray/blue/amber/teal/green/red) for each pill.
- `usePayers()` — payer name lookup for pill labels and the Payer filter dropdown.
- New `useProviderGroups()` — for the Group badge text and the Group filter dropdown.
- New `useCoordinators()` — resolve `case.assignedTo` user id → profile `fullName` for the Coordinator column.

State filter options: distinct states from providers' `homeState`. Status filter options: `onboarding | active | terminated`.

### New files (2)
1. `src/services/lookups.ts` — `getProviderGroups()` and `getCoordinators()` (selects `id, full_name` from `profiles` for ids referenced by cases.assigned_to in the active org). Both org-scoped, no audit (read-only).
2. `src/hooks/useLookups.ts` — `useProviderGroups()`, `useCoordinators()` TanStack Query hooks keyed by org.

### Modified file (1)
3. `src/routes/providers.index.tsx` — full implementation.

### Layout (matches screenshot)
- `PageHeader` "Providers" with right-side `{n} providers` count.
- Toolbar row: search input (Search icon, "Search name or NPI...", debounced), 4 shadcn `Select` filters (All Groups / All States / All Payers / All Statuses), spacer, primary `Button` "Add provider" → `navigate({ to: '/providers/new' })`. Button hidden when `useRole() === 'billing'`.
- Custom `<table>` (NOT shared DataTable):
  - `<thead>`: `text-xs uppercase tracking-wider text-muted-foreground`, columns: Provider, Group, State, Payer Statuses, CAQH (right-aligned), Coordinator.
  - `<tbody>` rows: `h-10`, `px-3` cells, `hover:bg-muted/40 cursor-pointer`, `onClick` → `navigate({ to: '/providers/$id', params: { id } })`. `border-b border-border`.
  - Terminated rows: wrap row in `opacity-60`; Payer Statuses cell shows single gray `StatusPill` "Terminated" (override pills).

### Cell rendering
- **Provider**: `<div class="font-medium">{firstName} {lastName}<span class="text-muted-foreground">, {credentials}</span></div><div class="text-xs text-muted-foreground tabular-nums">{npi ?? '—'}</div>`
- **Group**: small bordered pill, `whitespace-nowrap`, text = group name or `—`.
- **State**: `provider.homeState` or `—`.
- **Payer Statuses**: flex-wrap of `StatusPill` per case for this provider; label = payer name; color from status config color → mapped to StatusPill color enum (`gray|blue|amber|teal|green|red`). Empty if no cases.
- **CAQH**: `differenceInDays(now, caqhLastAttestedDate)` via date-fns. `null` → `<span class="text-muted-foreground">—</span>`. `<90`: muted text. `90–109`: amber. `≥110`: red. Always `tabular-nums`, suffix `d`.
- **Coordinator**: most recent case's `assignedTo` resolved via coordinator map → `fullName`, else `—`.

### States
- Loading: 8 skeleton rows of `<Skeleton class="h-4">` per column.
- Error: centered card with message + Retry button calling `refetch()`.
- Empty (no providers at all): "No providers yet" + "Add provider" CTA (hidden for billing).
- Empty after filter/search: "No providers match these filters" with "Clear filters" link.

### Tokens & rules
- All colors via existing semantic tokens / StatusPill enum. No hardcoded hex in JSX.
- Borders `border-border` (already #E8E5E0). No shadows.
- Icons `h-4 w-4`. Spacing multiples of 4.
- Named exports only; 2-line file header comment on each new file; no `any`, no `console.log`.

### Out of scope
- No changes to layout, sidebar, other routes, or existing services.
- `/providers/new` and `/providers/$id` already exist as placeholders; not touched.

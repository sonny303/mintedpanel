# CLAUDE.md — Minted Panel system map

Orientation for AI coding sessions. The **binding rules** (protected files,
data rules, style rules, anti-patterns) live in `AGENTS.md` — read that first;
this file adds the system map and operational knowledge those rules assume.
`ARCHITECTURE.md` and `SCHEMA.md` are the deeper references for layering and
tables.

## What this is

Minted Panel is a credentialing-operations SaaS for medical groups: providers,
payers, credentialing cases, tasks/SOPs, touches, contracts, MSO routing, and
location launches, all multi-tenant (`org_id` + RLS, roles admin/specialist/
billing). React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui, TanStack
Router (file-based) + TanStack Query, Zustand for auth/org state, Supabase
(Postgres + GoTrue) for everything server-side. No app server of our own —
the browser talks straight to Supabase under RLS.

## Running and verifying

- `npm run dev` / `build` / `lint` / `test` (vitest) / `format`.
- Local `.env` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  (see `.env.example`). The hosted project is `fkvuhfsqcmujywzgczmc`
  ("openpanel", us-east-2).
- `npx tsc --noEmit` is the type gate; `vite build` does not typecheck.
- **Claude Code cloud sandboxes block egress to `*.supabase.co`** (403 at the
  gateway proxy). The app cannot reach the real backend from there. What works:
  - All database reads/DDL/data via the **Supabase MCP tools**
    (`execute_sql`, `apply_migration`, `generate_typescript_types`).
  - Browser verification via Playwright (`/opt/pw-browsers/chromium`) against
    `npm run dev`, with the Supabase HTTP layer mocked through
    `context.route("https://<ref>.supabase.co/**", handler)`: emulate
    `/auth/v1/token` (return a session for a fixture user), `/rest/v1/<table>`
    (parse `eq./in./is./order/limit` query params over fixture rows exported
    from the live DB with `json_agg`), `maybeSingle` (Accept
    `vnd.pgrst.object` → single object or 406 `PGRST116`), `Prefer:
return=representation` / `resolution=ignore-duplicates`, and the RPCs
    (`claim_invites` → 0, `create_case_with_tasks` → synthesize the case row +
    tasks). Assert on the recorded request payloads as well as the UI. This
    harness verified the entire launch pivot; rebuild it from this recipe when
    needed.

## Database: repo vs hosted — read this before schema work

The repo's `supabase/migrations/` is a **partial mirror** of the hosted
database. Several hosted migrations were applied directly and have no repo
file (e.g. `create_launches`, `add_action_bucket_to_status_configs`,
`create_case_with_tasks_rpc`, invites/portal-fill infra). Consequences:

- Never assume a column/function is absent because repo migrations lack it —
  check the live DB (MCP `list_migrations` / information_schema).
- `src/integrations/supabase/types.ts` is **generated from the live schema**.
  After any DDL, regenerate via MCP `generate_typescript_types`, overwrite the
  file, and run prettier on it. It is not hand-edited.
- New schema work: apply to the hosted DB via MCP `apply_migration` **and**
  add the identical SQL as a new file in `supabase/migrations/`
  (`YYYYMMDDHHMMSS_<uuid>.sql`). Guard statements that depend on hosted-only
  objects (`to_regclass('public.launches')`, `ADD COLUMN IF NOT EXISTS`) so a
  repo-only rebuild still passes.
- `supabase/seed.sql` is a local fixture with its own two org ids (different
  from the hosted demo orgs) and fixed UUIDs + `ON CONFLICT (id) DO NOTHING`.
- Hosted demo data: two orgs — "Kansas Fitness Physio" (the rich demo) and
  "South Park Physician Group".

### RPCs (hosted-only, not in repo migrations)

- `create_case_with_tasks(p_input jsonb, p_tasks jsonb)` — transactional case
  insert + initial `status_history` row + tasks + two `audit_log` rows;
  `created_by` from `auth.uid()`; default credentialing status = lowest
  `sort_order`. Returns the case as jsonb.
- `claim_invites()` — converts `pending_invites` for the caller's email into
  memberships.
- `get_sop_field_tokens()` — closed token list for SOP templates.
- **Gotcha:** `supabase.rpc` must be called bound. Extracting the method
  (`const rpc = supabase.rpc as ...`) throws `Cannot read properties of
undefined (reading 'rest')` at call time. Use
  `supabase.rpc.bind(supabase)` (fixed everywhere in Jul 2026; keep it that
  way).

## Layering (enforced)

```
Component (src/routes/*, src/components/[module]/*)
  → hook (src/hooks/*, TanStack Query, keys in src/hooks/queryKeys.ts)
    → service (src/services/*, the ONLY Supabase callers)
      → supabase (src/integrations/supabase/externalClient.ts — the ONLY valid client import)
```

- Services: org-scope every query with `requireActiveOrg()` (`src/lib/audit.ts`),
  set `org_id` on inserts, write `audit_log` via `writeAudit` on mutations,
  convert snake↔camel at the boundary with `camelizeRow`/`snakeizeRow`
  (`src/lib/case.ts`).
- Hooks: one file per domain; all keys org-scoped via `queryKeys`; mutations
  invalidate by key prefix (e.g. `["facilities", orgId]` catches all variants).
- Auth/org: `src/lib/auth-store.ts` (Zustand, persisted `activeOrgId`).
  `useActiveOrgId()`, `useRole()`, `useCanWrite()`/`useIsAdmin()`
  (`src/lib/permissions.ts`). Switching org calls `queryClient.removeQueries()`.
- Domain types: `src/types/index.ts` (additive only). One interface per table.

## Domain model in one breath

`organizations` ← `memberships` (user+role) · `provider_groups` ·
`facilities` (a.k.a. **locations**; launches live here — see below) ·
`providers` (PHI-minimized: `ssn_last4` only) · `provider_facility_assignments`
(provider↔location, unique `(provider_id, facility_id)`) · `state_licenses` ·
`payers` (+ sentinel payer **"Pre-Credentialing Setup"**, matched by name) ·
`msos` + `mso_routing_rules` (payer+state+specialty → direct/mso; `'All'`
wildcards; scored client-side in `getMsoRoutingRule`) · `credential_cases`
(**unique `(provider_id, payer_id, state)`**, credentialing status only;
`facility_id` links a case to its location) · `contracts` (group+payer+state,
contracting status lives here, never on cases) · `tasks` (SOP checklists,
seeded from `sop_templates` via `src/lib/sopResolver.ts` — closed token list) ·
`status_configs` (tracks below) · append-only: `touches`, `status_history`,
`audit_log`.

### Statuses pattern

`status_configs` rows per org with `track ∈ {credentialing, contracting,
location}`, `label`, `color` (hex), `sort_order`, `required_fields`,
`action_bucket` (`ours|waiting_payer|waiting_provider|complete` — drives the
Home action engine, `src/lib/actionState.ts`). Admin > Statuses
(`src/routes/admin.statuses.tsx`) renders one `TrackSection` per track with
drag-to-reorder and an add/edit modal (fixed `TOKEN_COLORS` palette).
**Semantics are matched by label** across the app ("In-Network", "Live",
"Pre-Credentialing Setup") — the codebase idiom, not ids.

Status pills: `src/components/triage/StatusPill.tsx` takes the raw hex from
`status_configs.color` (color-mix tinting) — use this for DB-driven statuses.
The legacy `src/components/StatusPill.tsx` + `hexToStatusColor` is for
semantic one-offs.

## Launches = locations (launch PRD v2.1, built Jul 2026)

**A launch is not an entity — it's a `facilities` row in a pre-active
location-track status.** The Launches page is a filtered view of locations.

- Schema: `facilities.status_id` (FK → location-track `status_configs`),
  `facilities.effective_date` (date; month-only dates stored as the 1st).
  Seeded per org: Prospect(10) → Planned(20) → Interviewing(30) → Pending
  Fulfillment(40) → Ready for Launch(50) → Live(60), plus Inactive(70).
- Cases link to a location through the **existing**
  `credential_cases.facility_id` — the PRD's `cases.location_id` maps onto it;
  do not add a second FK.
- Provider-on-launch = `provider_facility_assignments`.
- **Legacy, do not use:** the hosted `launches` table and
  `providers.launch_id`. Their data was folded into facilities/pfa by
  migration `20260704041301_*` (launch_location_pivot). They remain in the DB
  per the additive rule but nothing reads or writes them.
- Pure page logic + tests: `src/lib/launchLocations.ts` —
  `splitLaunchSections` (Recently Launched = Live + effective date within
  `RECENTLY_LAUNCHED_DAYS = 30`, future dates tolerated; Pipeline = pre-Live
  sorted date asc, no-date last; Inactive and status-null rows never appear),
  `launchDateDisplay` ("Target Mmm D, YYYY" for Planned/Interviewing, "Starts"
  for Pending Fulfillment/Ready for Launch/Live, nothing for Prospect),
  `isNewStateLaunch` (no other Live location in group+state; status-null
  locations count as live), `needsGoLiveNudge`, `transitionWarnings`
  (Ready for Launch w/o provider, Live w/ zero cases — warn, never block).
- Feature surface: `src/routes/launches.index.tsx` (sections, counts, row
  kebab: Edit launch / Assign provider / Create cases, New Launch modal),
  `src/routes/launches.$id.tsx` (detail; `?createCases=true` auto-opens case
  creation), `src/components/launches/` (`LaunchEditModal`,
  `AssignProviderDialog`, `CreateCasesDialog`), service
  `src/services/launches.ts`, hooks `src/hooks/useLaunches.ts` (list shares
  the `facilities` cache key; assignments under `facility-assignments`).
- Case kickoff: checklist of active payers ordered pre-cred → direct →
  MSO-routed (by MSO name) → no-routing; pre-checks payers with routing and no
  existing case for (provider, state); existing combos disabled ("Case
  exists"); each created case carries `facility_id = location.id` and goes
  through `createCase` → `create_case_with_tasks` (SOP tasks + audit included).
- New-provider-from-launch: `/providers/new?locationId=<facilityId>` prefills
  group + facility checkbox; on save `createProviderWithDetails` writes the
  assignment and the page navigates back to the launch.
- Home's "Launches at risk" queue and Reports > Contracts matrix also read
  locations (label match on "Pending Fulfillment"/"Ready for Launch").

## Case creation flow (manual + launch)

`NewCaseModal` (provider detail) and `CreateCasesDialog` (launch) both:
resolve the MSO routing rule per payer/state/specialty, pick a SOP template
(`pickTemplate`: payer+state+group → payer+state → payer+**null-state**+group →
payer+null-state — the null-state fallback lets payers with a non-state SOP,
e.g. Medicare and Pre-Credentialing, still seed tasks; duplicated module-locally
in both, keep in sync), resolve tokens via
`resolveTemplate(template, provider, group, facility, {mso}, licenseNumber)`,
then `createCase(input, tasks)`. Duplicate `(provider, payer, state)` combos
are pre-filtered client-side; the DB unique constraint is the backstop.

## UI conventions worth knowing

- Create/edit modals: mount-when-editing pattern (`{modal ? <Modal .../> :
null}` with `<Dialog open onOpenChange={(o) => !o && onClose()}>`), nullable
  entity prop switches create/edit, `"__none__"` sentinel for empty selects,
  footer `variant="outline"` Cancel + `bg-[#1B4D3E]` primary, amber note boxes
  `border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]`, red error boxes
  `text-[#B91C1C] border-[#FCA5A5] bg-[#FEF2F2]`.
- Dates: `fmtDate`/`fmtDateTime` in `src/lib/format.ts` → "MMM d, yyyy"
  everywhere (PRD-locked; no month-only display).
- Toasts: `import { toast } from "sonner"`; `Toaster` mounted once in
  `__root.tsx`.
- Feature tables are hand-rolled `<table>` markup (see `admin.payers.tsx`);
  work-list pages use row-card lists, not tables. `PageHeader` on every route.
- Design tokens `var(--mp-*)` on triage/launch surfaces; hex-token classes on
  admin surfaces. Follow whichever the file you're editing already uses.

## Known warts (pre-existing; don't "discover" them again)

- `PROVIDER_LIST_COLUMNS` (`src/services/providers.ts`) is a partial
  projection — list rows are typed `Provider` but omit unlisted columns (e.g.
  the legacy `launchId`). `specialty` and `email` were added Jul 2026 because
  the launch kickoff routes off the list projection; keep the projection and
  its consumers in mind before reading "missing" fields. `getProvider`
  selects `*`.
- Provider **edit** drops facility assignments (`providers.$id.edit.tsx`
  passes `facilityIds: []` and the update path never syncs them); assignments
  are effectively write-once at creation plus launch-flow inserts.
- `provider_facility_assignments.is_primary` is read (NewCaseModal facility
  default) but never written by the app.
- `src/integrations/supabase/client.ts` is dead generated code — never import
  it (`externalClient.ts` is the one).
- MSO routing matching is exact and case-sensitive (`'All'` is the only
  wildcard). Demo data was aligned Jul 2026: rules and providers both say
  `Physical Therapy` (rules previously said `PT` and never matched).
- `supabase/seed.sql` stores `sop_templates.task_definitions` in a legacy
  shape (`{title, dayOffset, sopStepTemplates:[{step, dataFieldTokens}]}`)
  that `sopResolver.resolveTemplate` cannot read (it expects
  `{dueOffsetDays, steps:[{label, dataFields}]}`, which is what ALL hosted
  templates use). A local rebuild seeded from that file breaks task seeding
  until the definitions are normalized.
- NewCaseModal still passes `facility: null` into `resolveTemplate`, so
  `{{facility.*}}` tokens resolve empty there; the launch kickoff passes the
  location.
- `user_table_prefs` is **dead schema**: its only consumer (the Tasks list) was
  deleted at M6, and `src/services/tablePrefs.ts` was removed Jul 2026. The
  table remains per the additive rule — drop it via a sanctioned migration when
  convenient.
- The priority engine (`actionState.ts`) classifies **Approved with a null
  effective date** as `awaiting_effective`, never `complete` — an approved case
  with no billing date still needs the date chased. Approved with a _past_
  effective date falls through to complete.

## Keep this file honest — session-end ritual

At the end of every Claude Code session that changes this repo, before the
final push:

1. Re-read this file and update anything the session made stale — new
   tables/columns/RPCs (and hosted-vs-repo drift), new services/hooks/routes,
   moved responsibilities, new conventions, new gotchas discovered while
   debugging, retired code paths.
2. Keep `SCHEMA.md` in step with applied migrations and regenerate
   `src/integrations/supabase/types.ts` after any DDL.
3. Do not duplicate `AGENTS.md` rules here; link concepts instead. If a rule
   changed, change it in `AGENTS.md`.
4. If nothing changed structurally, leave the file untouched — no churn.

A future session should be able to read `AGENTS.md` + this file and work
confidently without re-mapping the codebase.

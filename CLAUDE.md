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
billing). React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui, **TanStack
Start** (file-based routing on a nitro server, SSR-capable) + TanStack Query,
Zustand for auth/org state, Supabase (Postgres + GoTrue) for everything
server-side. The framework is TanStack Start, not a plain Vite SPA: `src/server.ts`
and `src/start.ts` are a real server runtime.

A slice of app server logic runs as `/api/*` routes in `src/server/` on the
nitro server, behind a shared org/role guard using the service-role client:
health + provider CRUD (Chunk 3 pilot, PR #19) and the five extension-facing
endpoints (Chunk 4 — provider profile, portal field maps, fill events; R2
Workbench — open cases, submission touches). The
**bulk of data access is still browser → Supabase PostgREST under RLS**, and
**no frontend hook calls the API routes** — by locked decision (below), the
current app UI stays on direct Supabase + RLS; the API's consumer is the Chrome
extension. See the "Server API layer" section below and `docs/phase-0-audit.md`
for the framework/deploy detail.

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
    needed. Additions proven by the R1 go-live pass (2026-07-05): skip the
    login flow by seeding localStorage in `addInitScript` — the GoTrue session
    under `sb-<ref>-auth-token` plus zustand's `minted-panel-active-org` —
    and synthesize `profiles` + `memberships` rows for the fixture user
    (memberships embeds `organizations(name)`); fixture tables must also
    include empty `notes` and `user_table_prefs` or those queries 404. The
    repo's Playwright pin is newer than the sandbox browsers — launch with
    `executablePath: "/opt/pw-browsers/chromium"`. This rig rendered all 20
    routes as admin and billing for `docs/R1-GO-LIVE-FINDINGS.md`.
  - The **/api org-isolation gate** in-sandbox: `node
scripts/verify-isolation-local.mjs` (mock-and-run) boots a fixture mock of
    the API contract and runs `scripts/verify-org-isolation.mjs` against it —
    once expecting green, once per leak mode expecting red. The real gate runs
    on GitHub runners against the production deploy: automatically on every
    successful production deployment (`deployment_status` trigger) and via
    manual dispatch. A red gate run is stop-ship until a human reads it.

## Database: repo vs hosted — read this before schema work

`supabase/migrations/` is a **squashed baseline**
(`20260704210000_baseline_live_schema.sql`) dumped from the live DB and
verified to rebuild it exactly (fingerprint match; see
`docs/migration-baseline.md`), plus post-baseline migrations (first:
`20260705190000_audit_log_read_action_type.sql`, adding `READ` to the
`audit_log.action_type` check — applied to hosted the same day). The 15 old partial-mirror files are parked in
`supabase/migrations_archive/` (kept per the additive rule, outside the
migrations dir so the CLI ignores them). The baseline reflects the state after
all 23 hosted migrations. Consequences:

- The **live DB is still the source of truth.** The baseline is a snapshot; if
  the two ever diverge, regenerate a baseline from live rather than trusting the
  file. Check the live DB (MCP `list_migrations` / information_schema) before
  assuming a column/function's presence.
- `src/integrations/supabase/types.ts` is **generated from the live schema**.
  After any DDL, regenerate via MCP `generate_typescript_types`, overwrite the
  file, and run prettier on it. It is not hand-edited.
- New schema work (**repo-first**, full rule in `docs/migration-baseline.md`):
  add the change as a **new** file in `supabase/migrations/`
  (`YYYYMMDDHHMMSS_<slug>.sql`) — never edit the baseline or an archived file —
  **and** apply the identical SQL to hosted via MCP `apply_migration`. Guard
  statements that depend on hosted-only objects or elevated privileges
  (`to_regclass('public.launches')`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE ... IF NOT EXISTS`, exception-guarded event triggers) so a repo-only
  rebuild still passes.
- Do **not** re-apply the baseline to the already-migrated hosted project (its
  objects exist); it is for fresh rebuilds — local stacks, new projects, CI.
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
- `get_sop_field_tokens()` — the token **catalog**: `[{ table, token, column }]`
  for 132 tokens across 9 tables — which fields exist and where they live, not
  per-provider values. Client SOP templates use it as the closed token list;
  the server resolves actual values in `src/services/providerProfile.ts` for
  the profile endpoint.
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

### Server API layer (`src/server/*` — Chunk 3 pilot PR #19, Chunk 4 extension endpoints)

`/api` routes run on the nitro server. **No frontend hook consumes them** — the
browser still talks straight to Supabase for everything. That is deliberate
(locked decisions below): routes get built only when a real consumer pulls
them. The current surface:

- `GET /api/health` (public) · provider CRUD (`GET/POST /api/providers`,
  `GET/PATCH /api/providers/:id`) — Chunk 3.
- `GET /api/providers/:id/profile?state=XX` — the fill engine's payload: the
  provider row + every catalog token resolved to a value server-side
  (`src/services/providerProfile.ts`). Deterministic source-row picking:
  `?state` selects the state license; primary-else-sole assignment selects the
  facility; sole policy selects group insurance; `payers`/`msos`/`contracts`
  tokens are case-scoped and always come back `null` + listed in `unresolved`
  with a reason. The `{{user.*}}` token family (`user.name` from
  user_metadata full_name/name, `user.email` from the JWT claim — no schema
  backing) is appended by the route via `src/server/userTokens.ts`;
  empty-resolution notes surface in the envelope's `meta.notes`. **The most
  PHI-dense response in the system** (SSN last-4, DOB, home address, unmasked
  by design): `Cache-Control: no-store`, never log the body. Every successful
  profile read writes one `audit_log` row (`action_type 'READ'`, actor,
  provider, route — never the body or token values; a failed audit write
  fails the request) — R2 locked decision 4, 2026-07-05, superseding the
  same-day rely-on-fill_sessions decision (both recorded in
  `docs/minted-panel-release-plan.md`).
- `GET /api/portal-field-maps?portal_key=...` — shared catalog: `org_id NULL`
  rows (global, selectors are portal truths) + the caller's org overrides
  (`src/services/portalFieldMaps.ts`).
- `POST /api/fill-events` — writes `fill_sessions`; the client-generated `id`
  (UUID) is the idempotency key AND the row PK — replays return the stored row
  (200) instead of inserting (201). case/provider/task ownership is validated
  against the resolved org **before any write**; `org_id`/`performed_by` come
  from the guard ctx, never the body. Optional `taskId` marks the task
  completed (org-checked, audited). Writer roles only (billing → 403).
  (`src/services/fillSessions.ts`)
- `GET /api/cases?providerId=<uuid>` — the popup's case dropdown (R2): the
  provider's OPEN cases, `{ id, payerName, state, status, submittedDate }`.
  Open = credentialing status not in the `action_bucket 'complete'` bucket —
  derived from `status_configs`, never from labels; status-less cases count
  as open. Cross-org providerId → 404. (`src/services/providerCases.ts`)
- `POST /api/cases/:id/touches` — the "Mark submitted" business log (R2):
  ONE append-only touch (`touch_type 'portal'`, `outcome 'submitted'`,
  `source 'extension'`, text "Application submitted via <portal label>").
  **Snake_case body keys per the locked R2 contract** (`kind:
'portal_submission'`, `portal_key`, `fill_session_id?`, `note?`,
  `idempotency_id`) — unlike fill-events' camelCase. `idempotency_id` is the
  touch PK (same replay semantics as fill-events); case + fill-session
  ownership checked before any write; never a status change, never a task
  write. Portal label is derived from `portal_key` (no server-side portal
  catalog exists — labels live in the extension).
  (`src/services/submissionTouches.ts`)

Layer mechanics:

- **Entry:** this TanStack Start version ships **no** file-based server-route API
  (`createServerFileRoute` is absent), so `src/server.ts` (the nitro fetch entry)
  intercepts the whole **`/api` prefix** and delegates to `src/server/api.ts`
  before SSR (unknown `/api/*` paths are a JSON 404, not SSR). Keep the
  `src/server.ts` check and `isApiRequest` in `api.ts` in sync.
- **CORS (`src/server/cors.ts`):** env allowlist `API_CORS_ORIGINS`
  (comma-separated exact origins; must include `chrome-extension://<id>` once
  the extension id exists). Default empty = no CORS headers ever. OPTIONS
  preflights are answered 204 for all of `/api/*` (an Authorization header
  always triggers one); allow-headers are `authorization, content-type,
x-org-id`.
- **Guard (`src/server/guard.ts`) — every data route runs through it.** The
  service-role client **bypasses RLS**, so tenant isolation is enforced in code:
  `authenticate()` verifies the JWT (`supabase.auth.getClaims`), resolves the
  caller's membership (`org_id` + role, disambiguated by an optional `x-org-id`
  header / `?orgId=`), and returns an `AuthContext` already scoped to that org
  with a `writeAudit` closure. There is no path to a handler without a resolved
  ctx. `isWriter(ctx)` = admin|specialist (billing is read-only), mirroring the
  RLS write policies; handlers turn a false into a 403.
- **Service reuse via DI, browser callers unchanged.** `src/services/providers.ts`
  gained a `ProviderServiceCtx` (`{ db, orgId, writeAudit }`); its functions take
  an **optional** ctx defaulting to `browserCtx()` (the RLS anon client +
  `requireActiveOrg()`). Server routes inject a service-role ctx; the browser path
  is untouched. No query logic is duplicated between layers. New server routes
  should follow the same pattern — thread a ctx, never a second copy of the query.
- **PHI + writes:** the list route returns an explicit **narrowed** column set
  (`PROVIDER_LIST_COLUMNS` — no `ssn_last4`/`date_of_birth`/home address); never
  `select('*')` in a list payload. Writes set `org_id` from the authenticated
  membership (**never the request body** — it's stripped) and audit through the
  service layer.
- **Envelope:** `src/server/envelope.ts` — every response is `{ data, error, meta }`
  via `ok(data, meta?, status?)` / `fail(status, message)`; list meta carries
  `{ total, page, pageSize }`; `meta.notes` (string[]) carries non-fatal
  resolution notes (currently only empty `{{user.*}}` tokens).
- **Server-only, do not import client-side:** `src/server/serviceClient.ts` (the
  service-role + auth clients) and everything it pulls. Vite's `**/server/**`
  import-protection blocks a browser bundle from importing it. `api.ts`
  lazy-imports `providerRoutes` so `/api/health` stays free of the Supabase graph.
- **Tests:** handler + service-DI suites use a query-shape fake (supabase-js speaks
  PostgREST, not raw Postgres, so a CI-Postgres integration test isn't feasible) —
  `src/server/*.test.ts`, `src/services/*.di.test.ts`.
- **Env:** `src/server/env.ts` resolves `SUPABASE_URL ?? VITE_SUPABASE_URL` etc.
  and `SUPABASE_SERVICE_ROLE_KEY` (server-only, no `VITE_` prefix; set on Vercel
  Prod + Preview). `API_CORS_ORIGINS` is read directly in `cors.ts`.
- **The gate is the wall.** The service key bypasses RLS on API paths; guard.ts
  is the only isolation enforcement there. Every new resource route adds
  assertions to `scripts/verify-org-isolation.mjs` before merge, plus pass/leak
  coverage in `scripts/mock-api-server.mjs`. Gate fixtures: the one South
  Park-scoped `portal_field_maps` row (id in the workflow env block, seeded via
  MCP 2026-07-05) keeps the field-maps assertion non-vacuous. The expected
  per-org provider counts also live in that env block
  (`EXPECTED_KANSAS_PROVIDERS`/`EXPECTED_SOUTHPARK_PROVIDERS`) — adding or
  removing a demo/UAT provider means updating the count there, or assertions
  1/2 go red as fixture drift (not a leak; the leak checks are 1b/2b/2c/3).

### Locked decisions (2026-07-04, mirrored from the release plan)

1. **Three products, one backend.** API core, Chrome extension, and a future
   workflow UI are separate products. The current app UI keeps running on
   direct Supabase + RLS. Do not migrate current screens to the API.
2. **Consumer-pulled API surface.** Routes get built only when a real consumer
   pulls them. The extension pulls five (profile, field maps, fill events,
   open cases, submission touches). Other cases/tasks/payers routes wait for
   their consumer.
3. **R1 exit criteria revised.** "Zero direct Supabase calls in frontend" and
   RLS lockout deferred to the workflow-UI product. Dual data paths accepted
   deliberately: current UI guarded by RLS, API guarded by guard.ts + the gate.
4. **The gate is the wall.** Red gate = stop-ship.
5. **Server misconfig returns 500, never 401** (PR #24).
6. **Portal field maps are a shared catalog.** `org_id NULL` = global, org rows
   = overrides. The endpoint contract reflects this.

### Locked decisions (R2 Workbench, 2026-07-05)

1. **Case selection in the popup is REQUIRED.** No case, no fill
   (extension-side; the panel serves the dropdown via GET /api/cases).
2. **Fill event = machine log, submission touch = business log.** The
   extension logs "submitted" as an append-only touch only after the human
   submits the portal form. Never a status change from the extension (v1).
3. **Profile endpoint reads are audited** — one `READ` audit row per read,
   never the body. Supersedes the same-day rely-on-fill_sessions decision.
4. **`{{user.name}}`/`{{user.email}}` resolve from auth/JWT metadata.** No
   schema change.
5. **The extension never submits portal forms. Unchanged, forever.**

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
semantic one-offs, and since the R1 sweep it is the ONLY place pill styling
lives: it carries `neutral` (warm gray), `brand` (Admin badge), and `violet`
(audit TOUCH_LOGGED) variants, and admin payers/audit/mso-routing plus the
settings panels all render through it. Don't hand-roll
`rounded-[20px]`-style pill spans; neutral _tag_ chips (group name, via-MSO,
Archived) are the deliberate exception.

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
(`pickTemplate`: exact payer+state+group, then payer+state — duplicated
module-locally in both, keep in sync), resolve tokens via
`resolveTemplate(template, provider, group, facility, {mso}, licenseNumber)`,
then `createCase(input, tasks)`. Duplicate `(provider, payer, state)` combos
are pre-filtered client-side; the DB unique constraint is the backstop.

## Owner-facing view (one, consolidated Jul 2026)

- `/client-progress` (Client Progress v1) is **the** owner view: nav entry
  "Client Progress", page + entry gated to **admin and billing** roles. One card per
  non-terminated provider; x-of-y in-network `ProgressBar` whose denominator
  is the org's active payer set (pre-cred sentinel excluded; a payer whose
  only case for the provider is "Not Required"/"OON" drops out); one line per
  payer-with-case showing a locked owner wording (In progress / Submitted /
  With payer / Approved / Active — mapped by label, unknown labels fall back
  to `action_bucket`) via `src/lib/clientProgress.ts` (tested). Multi-state
  payers are represented by their most advanced case. Read-only. Pieces:
  `src/routes/client-progress.tsx`, `src/components/client-progress/`,
  `src/hooks/useClientProgress.ts`, `src/services/clientProgress.ts` (own
  narrow projection because `PROVIDER_LIST_COLUMNS` lacks `start_date`).
- The older M5.5 owner view at `/progress` was folded into it: the route file
  remains only as a redirect to `/client-progress` (the URL had been shared
  with owners out-of-band), and `src/lib/ownerWording.ts` + its test were
  deleted with the page they served.

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
- The Providers work view's filter card is URL-driven
  (`/providers?chip=needs|inprog|awaiting`, no param = all) so other pages can
  deep-link a filtered view — Home's "View all" uses it. Home's section/row
  components live in `src/components/home/`.
- Design tokens `var(--mp-*)` on triage/launch surfaces; hex-token classes on
  admin surfaces. Follow whichever the file you're editing already uses.
- Public (no-session) routes are `/` (landing), `/login`, `/dev*`, and
  `/privacy` — the list lives in `__root.tsx` (`isPublicRoute` skips the login
  redirect; a separate check renders `/`, `/login`, `/privacy` outside
  `AppShell`). `/privacy` is the Chrome Web Store policy URL for the
  extension; its content mirrors `docs/privacy-policy.md` (edit the doc first,
  keep the page in sync). Entity/date/contact were filled 2026-07-05 (South
  Park Physician Group, surapurs@gmail.com); the policy is a business
  document — don't reword it without the owner.

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
- The generated Supabase scaffold is fully gone (Jul 2026): `auth-middleware.ts`
  and `client.server.ts` were deleted in the R1 verification lane; the dead
  `client.ts` and the `auth-attacher.ts` middleware `start.ts` registered were
  deleted in the consolidation pass (zero `createServerFn` call sites existed,
  and that client read `VITE_SUPABASE_PUBLISHABLE_KEY`, which is never set).
  `externalClient.ts` is the only Supabase client. If serverFns are ever
  introduced, attach auth against `externalClient.ts`.
- `beforeLoad` role guards (providers new/edit) read the zustand store,
  which is EMPTY during a hard-load beforeLoad (init() runs after route
  load) — they only guard client-side navigation. Any guarded route needs
  the render-time `useRole()` backstop those two files now carry.
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

## Shared state ownership (parallel lanes)

When multiple Claude Code lanes run in parallel, these pieces of shared state
have exactly one owner at a time:

1. **`portal_field_maps` rows change via Supabase MCP only, never in code
   sessions.** Code (the extension's `portals.ts`) and the DB `url_pattern`
   change together — one actor, same day.
2. **CLAUDE.md is edited by at most one lane per day** — the last lane to
   close.
3. **Gate expected-count env values** (`EXPECTED_KANSAS_PROVIDERS` /
   `EXPECTED_SOUTHPARK_PROVIDERS` in the isolation-gate workflow env block)
   are owned by whichever lane changes demo-org data, in the same PR.

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

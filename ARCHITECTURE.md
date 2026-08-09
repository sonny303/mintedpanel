# Architecture

React 19 + TypeScript + Tailwind v4 + shadcn/ui on **TanStack Start** — file-based
routing served by a nitro server runtime (`src/server.ts`, `src/start.ts`), not a
plain Vite SPA. TanStack Query owns server state; Zustand (`src/lib/auth-store.ts`)
owns session + active org. Supabase (Postgres + GoTrue + RLS) is the backend.

Write/merge process: [`docs/ops/repo-workflow.md`](docs/ops/repo-workflow.md).
Binding coding rules: [`AGENTS.md`](AGENTS.md). Tables: [`SCHEMA.md`](SCHEMA.md).

## Directory structure

```
src/
  routes/                    TanStack file-based routes. Parents render <Outlet /> only.
  components/
    layout/                  AppShell, Sidebar, TopBar, PageHeader.
    ui/                      shadcn primitives.
    [module]/                Feature components grouped by domain (cases, providers, ...).
  services/                  The ONLY layer that talks to Supabase. One file per table/domain.
                             Query functions take an optional server ctx (DI); default is the browser client.
  hooks/                     TanStack Query hooks that wrap services.
  server/                    Nitro-side /api routes. Server-only — never imported by a browser bundle.
    api.ts                   Router dispatched from src/server.ts (the nitro fetch entry).
    guard.ts                 authenticate() → org/role-scoped AuthContext; every data route runs through it.
    envelope.ts              { data, error, meta } response helpers.
    cors.ts                  API_CORS_ORIGINS allowlist + OPTIONS preflight for /api/*.
    serviceClient.ts         Service-role + auth clients (RLS-bypassing; **/server/** import-protected).
    providerRoutes.ts        Provider handlers; compose src/services/providers.ts via injected ctx.
    extensionRoutes.ts       Extension-facing handlers (profile, field maps, cases, touches, ...).
    documentRoutes.ts        Document upload-intent / finalize / signed download.
  types/index.ts             All domain interfaces (additive only).
  lib/                       Pure utilities + client state: sopResolver, audit, case helpers,
                             auth-store.ts (Zustand: session + active org). No src/stores/.
  styles/tokens.css          Design tokens (drop-in from docs/redesign/design-system; do not edit).
  integrations/supabase/
    externalClient.ts        The ONLY valid browser Supabase client import.
    types.ts                 Generated DB types (regenerate after any DDL; not hand-edited).
src/server.ts                Nitro fetch entry; intercepts /api/* before SSR.
src/start.ts                 TanStack Start config (error middleware; no functionMiddleware).
supabase/migrations/         Append-only SQL migrations.
```

## Data flow

Today's default path (all domains) — browser → Supabase under RLS:

```
Component
   │  useFooQuery / useFooMutation
   ▼
Hook (src/hooks)
   │  fooService.list / .get / .upsert   (browser ctx: RLS anon client + requireActiveOrg())
   ▼
Service (src/services)
   │  supabase.from('foo')...
   ▼
Supabase (RLS by org_id)
```

Components never call Supabase. Services never call hooks. Hooks own cache keys (`src/hooks/queryKeys.ts`) and invalidation.

### Server API path (`/api/*` — the Chrome extension's backend)

A parallel server route path serves the Chrome extension (provider profile,
portal field maps, fill events, cases, touches, org discovery, case context,
next-best-action, view prefs, the shared training tier) plus the three
`/api/documents/*` signing endpoints. The **same service functions** are reused
via dependency injection — they take an optional context, so the server injects
a service-role, org-scoped ctx while the browser keeps its default. No query
logic is duplicated.

Browser hooks stay on Supabase + RLS by locked decision; the documents signing
endpoints are the single sanctioned exception (a signed Storage URL cannot be
minted client-side). Routes get built when a real consumer pulls them.
Endpoint-by-endpoint contracts live in `CLAUDE.md` § Server API layer.

```
HTTP  →  src/server.ts (nitro fetch entry)
             │  intercepts /api/*
             ▼
         src/server/api.ts (router)
             │  authenticate(request) — JWT → membership (org_id + role)
             ▼
         guard.ts AuthContext  { db: service-role, orgId, role, writeAudit }
             │  serviceCtx(ctx)
             ▼
         Service (src/services, injected ctx)
             │  db.from('foo')...  (RLS bypassed → org isolation enforced in code)
             ▼
         Supabase (Postgres)
```

Because the service-role client bypasses RLS, the **guard is the tenant boundary**:
`org_id` is taken from the authenticated membership (never the request body), writes
are gated by role (`isWriter` = admin|specialist), and list payloads use narrowed
columns (no PHI). Server-only modules (`src/server/*`) must never reach a browser
bundle — Vite `**/server/**` import-protection enforces it. That boundary is
verified by the org-isolation gate (`scripts/verify-org-isolation.mjs`, run by
`.github/workflows/verify-org-isolation.yml`); a red gate is stop-ship.

Never call a SECURITY INVOKER RPC on `ctx.db` — under the service key, RLS,
`auth.uid()` and `user_role()` all break at once. Bind the caller's JWT instead.

## Multi-tenancy

- Production is N organizations; local fixtures (`supabase/seed.sql`, `supabase/seed-redesign.sql`) seed a demo universe that never runs on hosted.
- `memberships(user_id, org_id, role)` links a user to one or more orgs with a role: `admin`, `specialist`, or `billing`.
- The active org lives in the Zustand store (`src/lib/auth-store.ts`, persisted), surfaced as the sidebar org switcher. All service queries read this id via `requireActiveOrg()` and pass it as `org_id` on inserts; switching org clears the query cache.
- RLS policies on every public table restrict rows to `org_id IN (select user_org_ids())`.
- The `billing` role is read-only at the policy level — write policies require `has_role(auth.uid(), 'admin'|'specialist')`. The UI mirrors this, but the database is the source of truth.

## Append-only tables

`touches`, `status_history`, and `audit_log` have no UPDATE or DELETE policies for any role. All history is preserved; corrections are new rows.

## Chrome extension note

The Workbench extension (`sonny303/minted-extension`) **never queries Supabase
tables and never holds the service-role key**. Supabase auth only mints a JWT;
every read and write goes through the `/api` routes above, guarded by
`guard.ts`. Wire contracts are panel-first: change the route here, then mirror
the types in the extension as a coordinated follow-up
(see [`docs/ops/repo-workflow.md`](docs/ops/repo-workflow.md) and the extension's
`CLAUDE.md`).

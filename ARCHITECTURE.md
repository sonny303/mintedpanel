# Architecture

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
  server/                    Nitro-side /api routes (Chunk 3 pilot). Server-only — never imported by a browser bundle.
    api.ts                   Router dispatched from src/server.ts (the nitro fetch entry).
    guard.ts                 authenticate() → org/role-scoped AuthContext; every data route runs through it.
    envelope.ts              { data, error, meta } response helpers.
    serviceClient.ts         Service-role + auth clients (RLS-bypassing; **/server/** import-protected).
    providerRoutes.ts        Provider handlers; compose src/services/providers.ts via injected ctx.
  types/index.ts             All domain interfaces.
  lib/                       Pure utilities: sopResolver, audit, case helpers, auth-store.
  stores/                    Zustand stores (active org, transient UI state).
  integrations/supabase/
    externalClient.ts        The ONLY valid browser Supabase client import.
    client.ts                Auto-generated dead code — do not import.
    types.ts                 Generated DB types.
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

### Server API path (Chunk 3 pilot — providers only, not yet consumed by hooks)

A parallel server route path exists for a first slice of endpoints. The **same
service functions** are reused via dependency injection — they take an optional
context, so the server injects a service-role, org-scoped ctx while the browser
keeps its default. No query logic is duplicated.

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
bundle — Vite `**/server/**` import-protection enforces it.

## Multi-tenancy

- Two seeded organizations demonstrate the model; production is N organizations.
- `memberships(user_id, org_id, role)` links a user to one or more orgs with a role: `admin`, `specialist`, or `billing`.
- The active org lives in a Zustand store, surfaced as an org switcher in the top bar. All service queries read this id and pass it as `org_id` on inserts.
- RLS policies on every public table restrict rows to `org_id IN (select user_org_ids())`.
- The `billing` role is read-only at the policy level — write policies require `has_role(auth.uid(), 'admin'|'specialist')`. The UI mirrors this, but the database is the source of truth.

## Append-only tables

`touches`, `status_history`, and `audit_log` have no UPDATE or DELETE policies for any role. All history is preserved; corrections are new rows.

## Chrome extension note

A future browser extension will read the same tables through the same RLS with a Supabase session. No schema changes required.

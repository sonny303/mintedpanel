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
  hooks/                     TanStack Query hooks that wrap services.
  types/index.ts             All domain interfaces.
  lib/                       Pure utilities: sopResolver, audit, case helpers, auth-store.
  stores/                    Zustand stores (active org, transient UI state).
  integrations/supabase/
    externalClient.ts        The ONLY valid Supabase client import.
    client.ts                Auto-generated dead code — do not import.
    types.ts                 Generated DB types.
supabase/migrations/         Append-only SQL migrations.
```

## Data flow

```
Component
   │  useFooQuery / useFooMutation
   ▼
Hook (src/hooks)
   │  fooService.list / .get / .upsert
   ▼
Service (src/services)
   │  supabase.from('foo')...
   ▼
Supabase (RLS by org_id)
```

Components never call Supabase. Services never call hooks. Hooks own cache keys (`src/hooks/queryKeys.ts`) and invalidation.

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

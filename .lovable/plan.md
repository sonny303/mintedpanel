## Heads up: Cloud isn't connected yet

I checked the project and there's no Supabase integration wired in (no `src/integrations/supabase/`, no `supabase/` folder, no database env vars). Before any migration can run, I need to enable Lovable Cloud — that provisions the backend and creates the integration files.

## Step 1 — Enable Lovable Cloud

Calls the Cloud enable tool. This provisions the database, auth, and the typed Supabase clients (`@/integrations/supabase/client`, `client.server`, `auth-middleware`).

## Step 2 — Migration: `0001_init_orgs_and_membership.sql`

Single migration creating the multi-tenant foundation.

### Tables (all in `public`, snake_case)

- `organizations` — `id`, `name`, `created_at`
- `profiles` — `id` (FK → `auth.users` on delete cascade), `full_name`, `email`, `created_at`
- `memberships` — `id`, `org_id` → orgs, `user_id` → profiles, `role` check-constrained to `specialist|billing|admin`, `created_at`, unique `(org_id, user_id)`
- `provider_groups` — `id`, `org_id`, `name`, `tin`, `npi_type2`, `states text[]`, `is_active default true`, `created_at`
- `facilities` — `id`, `org_id`, `group_id` → provider_groups, `name`, `street`, `city`, `state`, `zip`, `is_active`, `created_at`

All FKs on `org_id` reference `organizations(id)`. Every public table gets:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
GRANT ALL ON public.<table> TO service_role;
```
No `anon` grants (every policy is auth-scoped).

### Helper functions (security definer, stable, `search_path=public`)

- `public.user_org_ids() returns setof uuid` — `select org_id from memberships where user_id = auth.uid()`
- `public.user_role(p_org uuid) returns text` — role for `auth.uid()` in `p_org`

### RLS (enabled on every table)

- `organizations`: SELECT where `id in (select user_org_ids())`
- `profiles`: SELECT `id = auth.uid()`; UPDATE `id = auth.uid()`
- `memberships`: SELECT where `org_id in (select user_org_ids())`
- `provider_groups`, `facilities`:
  - SELECT where `org_id in (select user_org_ids())`
  - INSERT WITH CHECK `org_id in (select user_org_ids()) AND user_role(org_id) in ('specialist','admin')`
  - UPDATE USING/WITH CHECK same as INSERT
- No DELETE policies anywhere.

### Signup trigger

`handle_new_user()` security definer function + `on_auth_user_created` trigger on `auth.users` AFTER INSERT, inserting `(id, email, raw_user_meta_data->>'full_name')` into `profiles`.

## What I will NOT do

- No UI changes
- No seed data
- No edits to existing tables (none exist)
- No self-testing — you'll verify in the Supabase table editor

## Open question

Should `profiles.email` be unique? Spec doesn't say. I'll leave it non-unique (matches Supabase convention since `auth.users.email` is already the source of truth) unless you want it unique.

-- E0.0 (redesign) TE-1: internal-only organization lifecycle state.
--
-- Additive and guarded. Every existing row defaults to 'active', so this is
-- inert for current data. The column is read-only in the app and drives the
-- redesigned Portfolio buckets only:
--   prospect  -> "Prospects" count
--   active    -> "In motion" count
--   inactive  -> excluded from both counts (archived)
-- It is NEVER rendered to the Credentialing Manager as a status label she
-- manages (epic F0.0.2). Stage 0 does not write it (E0.1 will create prospects);
-- transitions are manual until later tooling exists.
--
-- Repo-first per docs/migration-baseline.md; the identical SQL was applied to
-- hosted via MCP apply_migration. Guarded (ADD COLUMN IF NOT EXISTS + a named,
-- existence-checked CHECK) so a repo-only rebuild also passes.

alter table public.organizations
  add column if not exists lifecycle_state text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_lifecycle_state_check'
  ) then
    alter table public.organizations
      add constraint organizations_lifecycle_state_check
      check (lifecycle_state in ('prospect', 'active', 'inactive'));
  end if;
end $$;

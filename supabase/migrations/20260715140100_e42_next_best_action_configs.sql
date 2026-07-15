-- E4.2 F4.2.5 / TE-7 — org-level next-best-action queue ranking config.
-- One row per org (org_id PK). `ranking` stores the validated shape
-- `{ "order": ["follow_up","task_due", ...] }` — an exact permutation subset of
-- the four fixed input keys; omitted keys are disabled. Absence of a row means
-- the shipped default comparator (arrived/overdue follow-ups first, then all by
-- earliest deadline). "Reset to default" DELETEs the row. The queue derivation
-- reads the effective setting live — no per-case/per-user priority is stored.
-- Org members read (their queue depends on it); admins insert/update/delete.
create table if not exists public.next_best_action_configs (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  ranking jsonb not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

alter table public.next_best_action_configs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'next_best_action_configs'
      and policyname = 'next_best_action_configs_select'
  ) then
    create policy next_best_action_configs_select on public.next_best_action_configs
      for select using (org_id in (select user_org_ids()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'next_best_action_configs'
      and policyname = 'next_best_action_configs_insert'
  ) then
    create policy next_best_action_configs_insert on public.next_best_action_configs
      for insert with check (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'next_best_action_configs'
      and policyname = 'next_best_action_configs_update'
  ) then
    create policy next_best_action_configs_update on public.next_best_action_configs
      for update using (org_id in (select user_org_ids()) and user_role(org_id) = 'admin')
      with check (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'next_best_action_configs'
      and policyname = 'next_best_action_configs_delete'
  ) then
    create policy next_best_action_configs_delete on public.next_best_action_configs
      for delete using (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;
end $$;

grant select, insert, update, delete on public.next_best_action_configs to authenticated;

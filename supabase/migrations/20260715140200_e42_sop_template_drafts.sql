-- E4.2 F4.2.1 (PM round-4) — SOP wizard save-as-draft.
-- An unpublished work-in-progress that persists across sessions and is
-- visible/editable by other admin/config users, so a half-encoded payer is
-- never lost and can be handed off. `template_id` optionally references the
-- head being edited (NULL = a brand-new template). `payload` is the wizard
-- state (name, match key, editable task tree). Drafts NEVER resolve for
-- generation and NEVER count toward readiness — they are deleted on successful
-- publish. E1.7b publish semantics are unchanged. Admin-member RLS.
create table if not exists public.sop_template_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid references public.sop_templates (id) on delete cascade,
  payload jsonb not null,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sop_template_drafts_org on public.sop_template_drafts (org_id);

alter table public.sop_template_drafts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sop_template_drafts' and policyname='sop_template_drafts_select') then
    create policy sop_template_drafts_select on public.sop_template_drafts
      for select using (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sop_template_drafts' and policyname='sop_template_drafts_insert') then
    create policy sop_template_drafts_insert on public.sop_template_drafts
      for insert with check (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sop_template_drafts' and policyname='sop_template_drafts_update') then
    create policy sop_template_drafts_update on public.sop_template_drafts
      for update using (org_id in (select user_org_ids()) and user_role(org_id) = 'admin')
      with check (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sop_template_drafts' and policyname='sop_template_drafts_delete') then
    create policy sop_template_drafts_delete on public.sop_template_drafts
      for delete using (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;
end $$;

grant select, insert, update, delete on public.sop_template_drafts to authenticated;

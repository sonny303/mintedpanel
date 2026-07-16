-- E4.2 payer governance — org_payer_settings: the organization-scoped payer
-- configuration grain (grain O in the field-usage audit's vocabulary).
--
-- Why: the F4.2.1 resolution-identifier config shipped on public.payers
-- (`resolution_id_label` / `resolution_id_expected`), but 269 of 287 payer rows
-- are GLOBAL (org_id IS NULL) and org users cannot — and must not — update
-- global rows (payers_update RLS is own-org only). The E4.2 dialog therefore
-- rendered a control that always failed on save for catalog payers. This table
-- gives org-varying payer configuration a home whose grain is actually
-- org × payer, starting with the ONE setting that has a confirmed consumer:
-- the resolution-identifier label/expectation read by the E4.0 approval step
-- through src/lib/payerResolutionIdentifier.ts. The payers columns remain as
-- the Minted-curated global fallback tier (additive rule; not dropped here).
--
-- Deliberately minimal: no other legacy payer field moves here without a
-- product-approved consumer (audit §1.2 "class 2, hold").

create table if not exists public.org_payer_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  payer_id uuid not null references public.payers (id) on delete cascade,
  -- What this payer calls its payer-issued INDIVIDUAL (Type 1) enrollment
  -- identifier for THIS org (e.g. Aetna "Provider PIN"). NULL = unconfigured →
  -- the seam falls back to the Minted-curated global label, then the generic
  -- "Payer-issued ID".
  resolution_id_label text,
  -- Whether this payer is expected to issue an individual ID at approval for
  -- this org. NULL = unconfigured (same fallback chain).
  resolution_id_expected boolean,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_payer_settings_org_payer_key unique (org_id, payer_id)
);

-- FK cover indexes (E0.10 convention). The unique constraint's index covers
-- org_id-leading lookups; payer_id needs its own.
create index if not exists idx_org_payer_settings_payer_id
  on public.org_payer_settings (payer_id);

alter table public.org_payer_settings enable row level security;

-- Member SELECT own-org (the approval dialog reads it for every role that can
-- see the case); ADMIN-only INSERT/UPDATE own-org. No DELETE policy or grant —
-- clearing a setting is an UPDATE to NULLs, so history-by-audit stays coherent.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_payer_settings'
      and policyname = 'org_payer_settings_select'
  ) then
    create policy org_payer_settings_select on public.org_payer_settings
      for select using (org_id in (select user_org_ids()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_payer_settings'
      and policyname = 'org_payer_settings_insert'
  ) then
    create policy org_payer_settings_insert on public.org_payer_settings
      for insert with check (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_payer_settings'
      and policyname = 'org_payer_settings_update'
  ) then
    create policy org_payer_settings_update on public.org_payer_settings
      for update using (org_id in (select user_org_ids()) and user_role(org_id) = 'admin')
      with check (org_id in (select user_org_ids()) and user_role(org_id) = 'admin');
  end if;
end $$;

-- Revoke-then-grant: the hosted project's default privileges hand ALL on new
-- public tables to anon/authenticated, so a bare GRANT would leave a DELETE
-- (and TRUNCATE/…) floor behind. No DELETE grant for authenticated — matching
-- the no-DELETE-policy posture above.
revoke all on public.org_payer_settings from anon;
revoke all on public.org_payer_settings from authenticated;
grant select, insert, update on public.org_payer_settings to authenticated;
grant select, insert, update, delete on public.org_payer_settings to service_role;

-- S6.1 — per-field verification stamps.
--
-- The Details card needs to show "this NPI was verified on Jul 12" and treat a
-- field as stale past its freshness window. That is a per-FIELD fact, and the
-- schema had nowhere to put it.
--
-- Shape decision: ONE narrow table keyed (provider_id, field_key), not N
-- `*_verified_at` columns on `providers`. Columns would mean a migration every
-- time a field becomes verifiable, would leave the vast majority NULL, and
-- would give the E1.8/E4.5 readiness reads a wider row to carry. A row per
-- verified field costs one join and stays additive forever.
--
-- `field_key` is the BARE catalog token key (`provider.npi`,
-- `license.licenseNumber`) — the same identifier the profile endpoint, the
-- portal field maps and the quick-card catalog already speak, so nothing has
-- to translate. It is deliberately NOT an FK: the token catalog is derived
-- from information_schema, not a table.
--
-- Additive and inert on apply: no existing read changes, and an unverified
-- field is simply an absent row.

create table if not exists public.provider_field_verifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  -- Bare catalog token key, e.g. 'provider.npi'.
  field_key text not null,
  verified_at timestamptz not null default now(),
  -- Who/what confirmed it. 'caqh' is the C6 push; 'manual' is a human in the
  -- webapp. Kept open-ended as text with a CHECK so adding a source is a
  -- one-line migration, not a type change.
  verified_source text not null default 'manual',
  verified_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_field_verifications_source_check
    check (verified_source in ('manual', 'caqh', 'extension')),
  -- One CURRENT stamp per field per provider: re-verifying updates the row
  -- rather than accumulating history. Verification history, if it is ever
  -- wanted, belongs in the audit log — which already records these writes.
  constraint provider_field_verifications_provider_field_key
    unique (provider_id, field_key)
);

-- FK cover (the E0.10 rule: every FK column gets an index).
create index if not exists idx_provider_field_verifications_org
  on public.provider_field_verifications (org_id);
create index if not exists idx_provider_field_verifications_provider
  on public.provider_field_verifications (provider_id);

alter table public.provider_field_verifications enable row level security;

-- Member SELECT / writer INSERT+UPDATE, mirroring the provider write policies.
-- No DELETE policy and no delete grant: un-verifying is a re-verification with
-- a new source, never a quiet erasure of the trail.
drop policy if exists provider_field_verifications_select on public.provider_field_verifications;
create policy provider_field_verifications_select
  on public.provider_field_verifications for select
  using (org_id in (select public.user_org_ids()));

drop policy if exists provider_field_verifications_insert on public.provider_field_verifications;
create policy provider_field_verifications_insert
  on public.provider_field_verifications for insert
  with check (
    public.user_role(org_id) in ('admin', 'specialist')
    and exists (
      select 1 from public.providers p
      where p.id = provider_id and p.org_id = org_id
    )
  );

drop policy if exists provider_field_verifications_update on public.provider_field_verifications;
create policy provider_field_verifications_update
  on public.provider_field_verifications for update
  using (public.user_role(org_id) in ('admin', 'specialist'))
  with check (public.user_role(org_id) in ('admin', 'specialist'));

revoke all on public.provider_field_verifications from anon, authenticated;
grant select, insert, update on public.provider_field_verifications to authenticated;

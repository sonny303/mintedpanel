-- Group insurance: explicit primary vs secondary coverage.
--
-- A group must carry a PRIMARY malpractice policy and may carry secondary
-- policies alongside it. Until now "the group's malpractice policy" was a
-- heuristic (newest policy_end_date among professional_liability rows) and
-- the only capture surface was four flat fields on the provider-group form,
-- which can hold exactly one policy. This column makes the primary policy a
-- stored fact so a list surface can track the rest.
--
-- Additive: existing rows become 'primary', which is what they already were
-- in effect (one policy per group today).

alter table public.group_insurance_policies
  add column if not exists coverage_level text not null default 'primary';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.group_insurance_policies'::regclass
      and conname = 'group_insurance_policies_coverage_level_check'
  ) then
    alter table public.group_insurance_policies
      add constraint group_insurance_policies_coverage_level_check
      check (coverage_level in ('primary', 'secondary'));
  end if;
end $$;

-- At most ONE primary policy per (group, insurance type). Secondary rows are
-- unconstrained — a group can carry as many as it needs.
create unique index if not exists uq_group_insurance_policies_one_primary
  on public.group_insurance_policies (group_id, insurance_type)
  where coverage_level = 'primary';

comment on column public.group_insurance_policies.coverage_level is
  'primary | secondary. One primary row per (group, insurance_type); the fill-profile malpractice resolution and the group readiness COI check prefer it.';

-- Reporting v1 — live validation probes (read-only).
-- Run in Supabase SQL editor; paste each result set back into the agent thread.
--
-- HOW TO USE
-- 1) Run Q0; copy an org uuid (prefer an active demo with real cases).
-- 2) Replace EVERY occurrence of 00000000-0000-4000-a000-000000000000
--    below with that uuid (editor Find & Replace).
-- 3) Run Q1–Q8 one block at a time; paste results.

-- =============================================================================
-- Q0) Orgs available
-- =============================================================================
select id, name, lifecycle_state, created_at
from organizations
order by created_at desc
limit 20;

-- =============================================================================
-- Q1) Case status distribution
-- =============================================================================
select
  case_status,
  count(*) as n,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as pct
from credential_cases
where org_id = '00000000-0000-4000-a000-000000000000'
group by case_status
order by n desc;

-- =============================================================================
-- Q2) assigned_to fill rate
-- =============================================================================
select
  count(*) as cases_total,
  count(assigned_to) as cases_with_assignee,
  count(*) - count(assigned_to) as cases_unassigned,
  round(100.0 * count(assigned_to) / nullif(count(*), 0), 1) as pct_assigned
from credential_cases
where org_id = '00000000-0000-4000-a000-000000000000';

select
  count(*) as open_cases,
  count(assigned_to) as open_with_assignee,
  round(100.0 * count(assigned_to) / nullif(count(*), 0), 1) as pct_assigned_open
from credential_cases
where org_id = '00000000-0000-4000-a000-000000000000'
  and case_status in (
    'not_started', 'in_progress', 'submitted', 'in_review', 'action_required'
  );

-- =============================================================================
-- Q3) case_status_history completeness (TAT / MoM)
-- =============================================================================
select
  (select count(*) from credential_cases
    where org_id = '00000000-0000-4000-a000-000000000000') as cases,
  (select count(distinct h.case_id)
     from case_status_history h
     join credential_cases c on c.id = h.case_id
    where c.org_id = '00000000-0000-4000-a000-000000000000') as cases_with_history;

select
  count(*) as approved_cases,
  count(*) filter (
    where exists (
      select 1 from case_status_history h
      where h.case_id = c.id and h.to_status = 'approved'
    )
  ) as approved_with_history_row
from credential_cases c
where c.org_id = '00000000-0000-4000-a000-000000000000'
  and c.case_status = 'approved';

select
  count(*) filter (where submitted_date is not null) as with_submitted_date,
  count(*) filter (where approved_date is not null) as with_approved_date,
  count(*) as cases_total
from credential_cases
where org_id = '00000000-0000-4000-a000-000000000000';

-- =============================================================================
-- Q4) Enrollment overlap: live facts vs approved cases
-- =============================================================================
with live_facts as (
  select provider_id, group_id, payer_id, state
  from enrollment_facts
  where org_id = '00000000-0000-4000-a000-000000000000'
    and expired_at is null
),
approved as (
  select provider_id, group_id, payer_id, state
  from credential_cases
  where org_id = '00000000-0000-4000-a000-000000000000'
    and case_status = 'approved'
)
select
  (select count(*) from live_facts) as live_fact_rows,
  (select count(*) from approved) as approved_case_rows,
  (
    select count(*)
    from live_facts f
    join approved a
      on a.provider_id = f.provider_id
     and a.group_id is not distinct from f.group_id
     and a.payer_id = f.payer_id
     and a.state = f.state
  ) as same_4part_both,
  (
    select count(*) from live_facts f
    where not exists (
      select 1 from approved a
      where a.provider_id = f.provider_id
        and a.group_id is not distinct from f.group_id
        and a.payer_id = f.payer_id
        and a.state = f.state
    )
  ) as fact_only,
  (
    select count(*) from approved a
    where not exists (
      select 1 from live_facts f
      where f.provider_id = a.provider_id
        and f.group_id is not distinct from a.group_id
        and f.payer_id = a.payer_id
        and f.state = a.state
    )
  ) as approved_only;

-- =============================================================================
-- Q5) Active + parallel open case at same provider×payer (matrix 30A)
-- =============================================================================
with active_keys as (
  select distinct provider_id, payer_id
  from enrollment_facts
  where org_id = '00000000-0000-4000-a000-000000000000'
    and expired_at is null
  union
  select distinct provider_id, payer_id
  from credential_cases
  where org_id = '00000000-0000-4000-a000-000000000000'
    and case_status = 'approved'
),
open_keys as (
  select distinct provider_id, payer_id
  from credential_cases
  where org_id = '00000000-0000-4000-a000-000000000000'
    and case_status in (
      'not_started', 'in_progress', 'submitted', 'in_review', 'action_required'
    )
)
select count(*) as provider_payer_active_with_parallel_open
from active_keys a
join open_keys o using (provider_id, payer_id);

-- =============================================================================
-- Q6) Targets / null-group cases
-- =============================================================================
select
  count(*) as active_targets,
  count(distinct payer_id) as distinct_payers,
  count(distinct group_id) as distinct_groups,
  count(distinct state) as distinct_states
from payer_network_targets
where org_id = '00000000-0000-4000-a000-000000000000'
  and status = 'active';

select count(*) as null_group_cases
from credential_cases
where org_id = '00000000-0000-4000-a000-000000000000'
  and group_id is null;

-- =============================================================================
-- Q7) Touches (Ops Workload)
-- =============================================================================
select
  count(*) as touchpoints,
  count(coordinator_id) as with_coordinator,
  round(100.0 * count(coordinator_id) / nullif(count(*), 0), 1) as pct_with_coordinator
from touches
where org_id = '00000000-0000-4000-a000-000000000000'
  and entry_type = 'touchpoint';

select touch_type, count(*) as n
from touches
where org_id = '00000000-0000-4000-a000-000000000000'
  and entry_type = 'touchpoint'
group by touch_type
order by n desc;

select count(distinct case_id) as cases_with_any_follow_up_date
from touches
where org_id = '00000000-0000-4000-a000-000000000000'
  and entry_type = 'touchpoint'
  and next_follow_up_date is not null;

-- =============================================================================
-- Q8) Cross-org lifecycle (Portfolio only)
-- =============================================================================
select lifecycle_state, count(*) as n
from organizations
group by lifecycle_state
order by n desc;

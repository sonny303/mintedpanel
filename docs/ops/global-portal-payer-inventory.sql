-- Read-only inventory: global portals × payers (Slice 6 / 3M).
-- Run in SQL Editor. No DELETE / UPDATE. Companion:
--   docs/ops/slice-6-platform-org-spike.md §D6.6

-- Summary counts
select
  count(*) filter (where org_id is null) as global_portals,
  count(*) filter (where org_id is null and payer_id is null) as global_null_payer,
  count(*) filter (
    where org_id is null
      and payer_id is not null
      and exists (
        select 1 from payers p
        where p.id = portals.payer_id
          and (p.status is distinct from 'active' or p.archived_at is not null)
      )
  ) as global_on_inactive_or_archived_payer
from portals;

-- Global portals with null payer_id
select id, portal_key, name, form_url, created_at
from portals
where org_id is null and payer_id is null
order by name, id;

-- Global portals linked to non-active / archived / merged payers
select
  po.id as portal_id,
  po.portal_key,
  po.name as portal_name,
  po.payer_id,
  p.name as payer_name,
  p.status,
  p.archived_at,
  p.merged_into_id
from portals po
join payers p on p.id = po.payer_id
where po.org_id is null
  and (p.status is distinct from 'active' or p.archived_at is not null)
order by p.status, po.name;

-- Shared field maps whose portal_key has no global portals row (orphans)
select m.portal_key, count(*) as map_rows
from portal_field_maps m
where m.org_id is null
  and not exists (
    select 1 from portals po
    where po.org_id is null and po.portal_key = m.portal_key
  )
group by m.portal_key
order by map_rows desc, m.portal_key;

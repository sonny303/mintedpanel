-- Catalog-isolation probe for the global payer/SOP catalog (P2).
--
-- The org-isolation GATE (scripts/verify-org-isolation.mjs) covers the
-- service-role /api surface. The global catalog is a BROWSER-RLS concern
-- (payers/sop_templates are read by the anon client under RLS, not via /api),
-- so this probe verifies that layer directly. Run it against the live DB via
-- the Supabase SQL editor / MCP execute_sql. It seeds a temporary global payer
-- assigned to ONE org inside a transaction and ROLLS BACK — nothing persists.
--
-- Expected (proven 2026-07-07 on the production DB):
--   assigned org      -> sees the global payer, sees its own payers, sees 0
--                        foreign payers, cannot forge a global payer (RLS blocks)
--   unassigned org    -> does NOT see the global payer, sees its own payers,
--                        sees 0 foreign payers
--
-- Replace the two user ids + two org ids below with the gate's test users
-- (testkansas@ / testsouthpark@) before running.
begin;

create temp table _rls_probe (
  who text,
  sees_global boolean,
  sees_own int,
  sees_foreign int,
  rogue_blocked boolean
) on commit drop;

insert into payers (id, org_id, name, is_active)
  values ('00000000-0000-4000-a000-0000000000ff', null, 'ZZZ Global RLS Test', true);
insert into org_payer_assignments (org_id, payer_id)
  values (:'assigned_org', '00000000-0000-4000-a000-0000000000ff');

do $$
declare
  a_global boolean; a_own int; a_foreign int; a_rogue boolean;
  u_global boolean; u_own int; u_foreign int;
begin
  -- Assigned org's user
  perform set_config('request.jwt.claim.sub', :'assigned_user', true);
  set local role authenticated;
  select exists(select 1 from payers where id='00000000-0000-4000-a000-0000000000ff') into a_global;
  select count(*) from payers where org_id = :'assigned_org' into a_own;
  select count(*) from payers where org_id = :'unassigned_org' into a_foreign;
  begin
    insert into payers (org_id, name, is_active) values (null, 'ROGUE GLOBAL', true);
    a_rogue := false;  -- succeeded => RLS did NOT block (BAD)
  exception when others then
    a_rogue := true;   -- blocked (GOOD)
  end;
  reset role;

  -- Unassigned org's user
  perform set_config('request.jwt.claim.sub', :'unassigned_user', true);
  set local role authenticated;
  select exists(select 1 from payers where id='00000000-0000-4000-a000-0000000000ff') into u_global;
  select count(*) from payers where org_id = :'unassigned_org' into u_own;
  select count(*) from payers where org_id = :'assigned_org' into u_foreign;
  reset role;

  insert into _rls_probe values
    ('assigned', a_global, a_own, a_foreign, a_rogue),
    ('unassigned', u_global, u_own, u_foreign, null);
end $$;

select json_agg(_rls_probe) as probe from _rls_probe;

rollback;

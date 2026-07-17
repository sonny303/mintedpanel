-- =====================================================================
-- TEARDOWN: non-KFP test orgs  |  project fkvuhfsqcmujywzgczmc
-- Traced against LIVE schema + data 2026-07-17. Verified, not assumed.
--
-- *** DO NOT EXECUTE FROM AN AGENT / MCP. REFERENCE ONLY. ***
-- The human runs this, in the SQL editor, AFTER a pg_dump snapshot.
--
-- PRECONDITIONS (all three, no exceptions):
--   1. pg_dump snapshot taken and restore verified. KFP is in this DB.
--   2. AGENTS.md carve-out merged: this deletes 103 append-only ledger
--      rows (touches 8, status_history 21, audit_log 74). The pre-GA DDL
--      window you merged in PR #169 explicitly protects these. Amend the
--      rule BEFORE running, same pattern as #169.
--   3. Confirmed no e2e spec / seed-universe scenario depends on the
--      South Park demo org (d0e40000-...). If any does, CI goes red and
--      Gate 0 blocks every merge.
--
-- SURVIVES: KFP org 20563fd6-8e95-46a0-8e1c-cb3b968b3c3d
--           269 global payers (org_id IS NULL) -- the catalog
--           KFP's 8 org-scoped payers
--
-- WHY THIS ORDER: 19 tables carry a NO ACTION FK to organizations, so a
-- bare DELETE FROM organizations fails. The CASCADE tables are not safe
-- to leave to the cascade either: organizations -> facilities is CASCADE,
-- but credential_cases.facility_id -> facilities is NO ACTION, and
-- facilities.status_id -> status_configs is NO ACTION. So facilities must
-- be deleted explicitly, before status_configs, or the cascade deadlocks.
-- =====================================================================

begin;

-- Explicit ID list, NOT "<> KFP". A new org created tomorrow must never
-- get swept into this. 14 rows, named for the record.
create temporary table _targets (id uuid primary key, label text) on commit drop;
insert into _targets (id, label) values
  ('5eed0001-0000-4000-a000-000000000001','seed: Outer Banks Rehab Group'),
  ('5eed0001-0000-4000-a000-000000000002','seed: Tree Hill Sports Therapy'),
  ('5eed0001-0000-4000-a000-000000000003','seed: Shelby Sports Rehab'),
  ('5eed0001-0000-4000-a000-000000000004','seed: Outer Banks Therapy Group'),
  ('5eed0001-0000-4000-a000-000000000005','seed: Gemstone Family Rehab'),
  ('5eed0001-0000-4000-a000-000000000006','seed: Lowcountry Charm PT'),
  ('5eed0001-0000-4000-a000-000000000007','seed: South Park Physical Therapy'),
  ('5eed0001-0000-4000-a000-000000000008','seed: Dillon Sports Medicine'),
  ('5eed0001-0000-4000-a000-000000000009','seed: Lone Star Rehab Group'),
  ('5eed0001-0000-4000-a000-000000000010','seed: Point Place Physical Therapy'),
  ('5eed0001-0000-4000-a000-000000000011','seed: Rose City Rehab Collective'),
  ('d0e40000-0000-4000-a000-000000000001','demo: South Park Physician Group'),
  ('262eb40f-da8f-4035-9206-23d8bc803961','junk: Dragon Ball PT'),
  ('8278f2a6-5a18-4e0e-9104-85714cb92245','junk: Dummy Test Org');

-- ---------------------------------------------------------------------
-- GUARD 0: KFP must never be in the target set. Abort if it is.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from _targets where id = '20563fd6-8e95-46a0-8e1c-cb3b968b3c3d') then
    raise exception 'ABORT: KFP is in the target set';
  end if;
  if (select count(*) from _targets) <> 14 then
    raise exception 'ABORT: expected 14 targets, got %', (select count(*) from _targets);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- GUARD 1: re-run the cross-contamination checks INSIDE the transaction.
-- All four were 0 at trace time. If any is non-zero now, someone wired
-- KFP data to a test row since. Abort rather than cascade into it.
-- ---------------------------------------------------------------------
do $$
declare v int;
begin
  select count(*) into v from credential_cases
   where org_id = '20563fd6-8e95-46a0-8e1c-cb3b968b3c3d'
     and payer_id in (select id from payers where org_id in (select id from _targets));
  if v > 0 then raise exception 'ABORT: % KFP case(s) reference a target payer', v; end if;

  select count(*) into v from payers
   where org_id is null
     and (prerequisite_payer_id in (select id from payers where org_id in (select id from _targets))
       or merged_into_id       in (select id from payers where org_id in (select id from _targets)));
  if v > 0 then raise exception 'ABORT: % global payer(s) reference a target payer', v; end if;

  select count(*) into v from communication_event
   where payer_id in (select id from payers where org_id in (select id from _targets));
  if v > 0 then raise exception 'ABORT: % communication_event row(s) reference a target payer', v; end if;

  select count(*) into v from payer_catalog_changes
   where payer_id in (select id from payers where org_id in (select id from _targets));
  if v > 0 then raise exception 'ABORT: % payer_catalog_change(s) reference a target payer', v; end if;
end $$;

-- ---------------------------------------------------------------------
-- PHASE 1 -- append-only ledgers. Requires the AGENTS.md carve-out.
-- touches goes first: tasks/credential_cases both sit upstream of it.
-- The self-FK touches.corrects_touch_id is NO ACTION, checked at end of
-- statement, so one DELETE covering all rows is fine.
-- ---------------------------------------------------------------------
delete from touches         where org_id in (select id from _targets);  -- exp 8
delete from status_history  where org_id in (select id from _targets);  -- exp 21

-- ---------------------------------------------------------------------
-- PHASE 2 -- leaf children
-- ---------------------------------------------------------------------
delete from tasks                         where org_id in (select id from _targets);  -- exp 46
delete from notes                         where org_id in (select id from _targets);  -- exp 0
delete from provider_facility_assignments where org_id in (select id from _targets);  -- exp 8
delete from provider_group_assignments    where org_id in (select id from _targets);  -- exp 3
delete from state_licenses                where org_id in (select id from _targets);  -- exp 4
delete from group_insurance_policies      where org_id in (select id from _targets);  -- exp 1

-- ---------------------------------------------------------------------
-- PHASE 3 -- cases and contracts
-- credential_cases CASCADEs: fill_sessions (6), payer_pipeline_history
-- and SET NULLs: case_generation_run_rows.case_id, provider_documents.case_id
-- ---------------------------------------------------------------------
delete from credential_cases where org_id in (select id from _targets);  -- exp 17
delete from contracts        where org_id in (select id from _targets);  -- exp 6

-- ---------------------------------------------------------------------
-- PHASE 4 -- config and org-scoped catalog
-- sop_template_versions has NO org_id. It is reachable only via
-- template_id, so it must be scoped through sop_templates and deleted
-- before them.
-- facilities is CASCADE from organizations but MUST be explicit here:
-- it is the parent of status_configs via facilities.status_id (NO ACTION).
-- payers: org-scoped rows only. The 269 global catalog rows are untouched.
-- ---------------------------------------------------------------------
delete from mso_routing_rules where org_id in (select id from _targets);  -- exp 2

delete from sop_template_versions
 where template_id in (select id from sop_templates where org_id in (select id from _targets));  -- exp 11

delete from sop_templates   where org_id in (select id from _targets);  -- exp 11
-- providers <-> launches is a mutual NO ACTION FK cycle
-- (providers.launch_id -> launches, launches.clinic_director_provider_id ->
-- providers), and launches also carries NO ACTION FKs to organizations and
-- facilities: null the provider side, delete providers, then launches, all
-- BEFORE facilities and the org delete.
update launches set clinic_director_provider_id = null
 where org_id in (select id from _targets);
delete from providers       where org_id in (select id from _targets);  -- exp 9
delete from launches        where org_id in (select id from _targets);
delete from facilities      where org_id in (select id from _targets);  -- exp 5
delete from msos            where org_id in (select id from _targets);  -- exp 2
delete from payers          where org_id in (select id from _targets);  -- exp 10
delete from status_configs  where org_id in (select id from _targets);  -- exp 308
delete from audit_log       where org_id in (select id from _targets);  -- exp 74

-- ---------------------------------------------------------------------
-- PHASE 5 -- the orgs. CASCADE now clears the rest:
--   memberships (18), party_role_assignments (18), provider_groups (5),
--   portal_field_maps (1), org_payer_assignments, org_payer_settings,
--   payer_network_targets, case_generation_runs/_run_rows/_exclusions,
--   import_runs/_rows, provider_documents, field_dictionary, portals,
--   pending_invites, next_best_action_configs, denial_reason_codes,
--   sop_template_drafts, party_capture_links, report_shares, fill_sessions
-- and SET NULLs inbound_leads.converted_org_id
-- ---------------------------------------------------------------------
delete from organizations where id in (select id from _targets);  -- exp 14

-- ---------------------------------------------------------------------
-- PHASE 6 -- orphans
-- parties has no org_id. Its only tenancy link is party_role_assignments,
-- which just cascaded away. 17 parties are newly orphaned; 4 were ALREADY
-- orphaned before this script (pre-existing bug, the missing orphan guard).
-- This sweeps both. 22 parties total, 1 is KFP's and survives.
-- ---------------------------------------------------------------------
delete from parties p
 where not exists (select 1 from party_role_assignments r where r.party_id = p.id);  -- exp 21

commit;

-- =====================================================================
-- POST-RUN VERIFICATION -- run separately, expect every count 0 except KFP
-- =====================================================================
-- select
--   (select count(*) from organizations)                          as orgs_left,        -- exp 1
--   (select count(*) from organizations
--     where id = '20563fd6-8e95-46a0-8e1c-cb3b968b3c3d')          as kfp_alive,        -- exp 1
--   (select count(*) from payers where org_id is null)            as global_payers,    -- exp 269
--   (select count(*) from payers)                                 as payers_total,     -- exp 277
--   (select count(*) from credential_cases)                       as cases,            -- exp 48
--   (select count(*) from providers)                              as providers,        -- exp 7
--   (select count(*) from touches)                                as touches,          -- exp 52
--   (select count(*) from audit_log)                              as audit_rows,       -- exp 260
--   (select count(*) from parties)                                as parties,          -- exp 1
--   (select count(*) from parties p where not exists
--      (select 1 from party_role_assignments r where r.party_id = p.id)) as orphans;   -- exp 0

-- Re-run the payer drop inventory. Every drop-list column should now be
-- 0 non-null EXCEPT the four real KFP values called out below.
-- select count(*) total, count(portal_url) portal_url,
--        count(provider_type_path) ptp, count(payer_billing_id) pbi,
--        count(prior_auth_vendor) pav, count(retro_billing_window_days) rbw,
--        count(caqh_pull_deadline_days) cpd, count(avg_decision_days) add
--   from payers;
-- expect: portal_url 2, ptp 1, pbi 1, avg_decision_days 1, everything else 0

-- =====================================================================
-- NOT IN THIS SCRIPT -- deliberate, needs your call
--
-- 1. AUTH USERS. 1 profile is a member of target orgs only (delete
--    candidate). 3 profiles are members of BOTH a target org and KFP --
--    those MUST stay. Deleting a profile means deleting auth.users (the
--    profiles FK is CASCADE), which is better done through the Supabase
--    admin API than raw SQL. Left out on purpose. Confirm which of your
--    four test accounts is the orphan before touching auth.
--
-- 2. STORAGE. provider_documents rows cascade with the org, but the
--    underlying objects in the provider-documents bucket do NOT. Any
--    test-org files stay in storage as garbage. Sweep by org_id path
--    prefix separately.
-- =====================================================================

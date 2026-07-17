-- =====================================================================
-- FULL WIPE: all orgs + all users except sowmya@minted.com
-- project fkvuhfsqcmujywzgczmc  |  traced against LIVE schema 2026-07-17
--
-- *** DO NOT EXECUTE FROM AN AGENT / MCP. REFERENCE ONLY. ***
-- Human runs this AFTER pg_dump snapshot + restore verification.
--
-- PM decisions 2026-07-17: Q1=C (KFP re-onboarded fresh in prod, current
-- data not needed), Q2=C (SOP templates die with the org, rebuild later),
-- Q3=B (empty app, first-run onboarding creates the first org).
--
-- DELETES: all 15 organizations (14 test + KFP), 5 of 6 auth users.
-- KEEPS:   sowmya@minted.com
--          269 global payers (org_id IS NULL) -- product catalog
--          24 global portal_field_maps        -- BCBS KS fill engine
--          1  global sop_template
--          6  party_role_types                -- lookup
--
-- ORDER RATIONALE: 19 tables carry NO ACTION FKs to organizations, so a
-- bare DELETE FROM organizations fails. facilities is CASCADE from org
-- but MUST be explicit: facilities.status_id -> status_configs is
-- NO ACTION, and status_configs.org_id -> organizations is NO ACTION, so
-- the cascade deadlocks against itself. sop_template_versions has no
-- org_id and is reachable only via template_id.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 0 -- PREFLIGHT. Run alone. Paste output into the PR description.
-- The AGENTS.md pre-GA window requires a pre-drop data inventory.
-- ---------------------------------------------------------------------
-- select 'organizations' t, count(*) n from organizations
-- union all select 'audit_log',        count(*) from audit_log
-- union all select 'touches',          count(*) from touches
-- union all select 'status_history',   count(*) from status_history
-- union all select 'credential_cases', count(*) from credential_cases
-- union all select 'tasks',            count(*) from tasks
-- union all select 'providers',        count(*) from providers
-- union all select 'contracts',        count(*) from contracts
-- union all select 'sop_templates (org-scoped)', count(*) from sop_templates where org_id is not null
-- union all select 'sop_templates (global, KEPT)', count(*) from sop_templates where org_id is null
-- union all select 'fill_sessions',    count(*) from fill_sessions
-- union all select 'payers (org-scoped)', count(*) from payers where org_id is not null
-- union all select 'payers (global, KEPT)', count(*) from payers where org_id is null
-- union all select 'portal_field_maps (global, KEPT)', count(*) from portal_field_maps where org_id is null
-- union all select 'status_configs',   count(*) from status_configs
-- union all select 'parties',          count(*) from parties
-- union all select 'auth.users',       count(*) from auth.users
-- order by n desc;

begin;

-- ---------------------------------------------------------------------
-- GUARD -- confirm the world is the shape we traced. Abort if not.
-- ---------------------------------------------------------------------
do $$
declare v int;
begin
  select count(*) into v from organizations;
  if v <> 15 then
    raise exception 'ABORT: expected 15 orgs, found %. Someone added one. Re-trace before running.', v;
  end if;

  select count(*) into v from auth.users where email = 'sowmya@minted.com';
  if v <> 1 then
    raise exception 'ABORT: sowmya@minted.com not found or duplicated (count=%)', v;
  end if;

  select count(*) into v from payers where org_id is null;
  if v <> 269 then
    raise exception 'ABORT: expected 269 global payers, found %. Catalog changed.', v;
  end if;

  -- Global catalog rows must not reference org-scoped payers, or the Phase 4
  -- org-payer delete throws (payers.prerequisite_payer_id / merged_into_id are
  -- NO ACTION self-FKs). Kept rows referencing deleted rows need a human call.
  select count(*) into v from payers
   where org_id is null
     and (prerequisite_payer_id in (select id from payers where org_id is not null)
       or merged_into_id       in (select id from payers where org_id is not null));
  if v > 0 then
    raise exception 'ABORT: % global payer(s) reference an org-scoped payer. Resolve before wiping.', v;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- PHASE 1 -- append-only ledgers. REQUIRES the AGENTS.md carve-out.
-- touches first: tasks and credential_cases sit upstream of it.
-- touches.corrects_touch_id is a NO ACTION self-FK, checked at end of
-- statement, so one DELETE covering all rows is safe.
-- ---------------------------------------------------------------------
delete from touches;
delete from status_history;

-- ---------------------------------------------------------------------
-- PHASE 2 -- leaf children
-- ---------------------------------------------------------------------
delete from tasks;
delete from notes;
delete from provider_facility_assignments;
delete from provider_group_assignments;
delete from state_licenses;
delete from group_insurance_policies;

-- ---------------------------------------------------------------------
-- PHASE 3 -- cases and contracts
-- credential_cases CASCADEs fill_sessions + payer_pipeline_history,
-- SET NULLs case_generation_run_rows.case_id and provider_documents.case_id
-- ---------------------------------------------------------------------
delete from credential_cases;
delete from contracts;

-- ---------------------------------------------------------------------
-- PHASE 4 -- config and org-scoped catalog.
-- Global rows (org_id IS NULL) are preserved by the IS NOT NULL filter.
-- ---------------------------------------------------------------------
delete from mso_routing_rules;

delete from sop_template_versions
 where template_id in (select id from sop_templates where org_id is not null);

delete from sop_templates where org_id is not null;   -- keeps the 1 global

-- providers <-> launches is a mutual NO ACTION FK cycle
-- (providers.launch_id -> launches, launches.clinic_director_provider_id ->
-- providers). Both tables are fully wiped, so no pure ordering works when both
-- columns are populated: null one side first, then delete providers, then
-- launches.
update launches set clinic_director_provider_id = null;
delete from providers;
delete from launches;

-- communication_event carries org_id but has NO FK to organizations (never
-- cascades) and a NO ACTION NOT NULL FK to payers -- clear it before the
-- org-payer delete. All rows are org data; a full wipe removes them all.
delete from communication_event;

-- payer_catalog_changes.payer_id is a NO ACTION NOT NULL FK to payers; rows
-- pointing at org-scoped payers block the delete below. Global-payer rows
-- (the catalog diff log) are KEPT.
delete from payer_catalog_changes
 where payer_id in (select id from payers where org_id is not null);
delete from facilities;                               -- explicit: parent of status_configs
delete from msos;
delete from payers         where org_id is not null;  -- keeps the 269 global
delete from portals        where org_id is not null;
delete from portal_field_maps where org_id is not null; -- keeps the 24 global
delete from status_configs;
delete from audit_log;

-- ---------------------------------------------------------------------
-- PHASE 5 -- the orgs. CASCADE clears memberships, party_role_assignments,
-- provider_groups, org_payer_assignments/_settings, payer_network_targets,
-- case_generation_*, import_runs/_rows, provider_documents, field_dictionary,
-- pending_invites, next_best_action_configs, denial_reason_codes,
-- sop_template_drafts, party_capture_links, report_shares.
-- SET NULLs inbound_leads.converted_org_id.
-- ---------------------------------------------------------------------
delete from organizations;

-- ---------------------------------------------------------------------
-- PHASE 6 -- orphans. parties has no org_id; its only tenancy link is
-- party_role_assignments, which just cascaded. Sweeps the 4 rows that were
-- ALREADY orphaned before this script (pre-existing missing orphan guard).
-- ---------------------------------------------------------------------
delete from parties p
 where not exists (select 1 from party_role_assignments r where r.party_id = p.id);

commit;

-- =====================================================================
-- PHASE 7 -- AUTH USERS. Run SEPARATELY, after Phase 1-6 commits clean.
-- Prefer the Supabase Auth admin API over raw SQL. profiles.id ->
-- auth.users is CASCADE, so deleting the user deletes the profile.
-- user_table_prefs.user_id -> auth.users is also CASCADE.
--
-- After Phase 5 every org-scoped row is gone, so the NO ACTION FKs that
-- pin profiles (credential_cases.created_by, touches.coordinator_id,
-- status_history.changed_by, notes.author_id, import_runs.created_by,
-- case_generation_runs.created_by) are all clear.
--
-- DELETE these 5:
--   sowmya@fitness.fit         (2 memberships, never signed in)
--   test@minted.com            (3 memberships, last 2026-07-05)
--   testkansas@minted.com      (1 membership, last 2026-07-08)
--   testsouthpark@minted.com   (1 membership, last 2026-07-08)
--   uatbilling@minted.com      (0 memberships, never signed in)
-- KEEP:
--   sowmya@minted.com          (last sign-in 2026-07-17)
--
-- delete from auth.users where email in (
--   'sowmya@fitness.fit','test@minted.com','testkansas@minted.com',
--   'testsouthpark@minted.com','uatbilling@minted.com'
-- );
-- =====================================================================

-- =====================================================================
-- POST-RUN VERIFICATION
-- =====================================================================
-- select
--   (select count(*) from organizations)      as orgs,           -- exp 0
--   (select count(*) from credential_cases)   as cases,          -- exp 0
--   (select count(*) from providers)          as providers,      -- exp 0
--   (select count(*) from touches)            as touches,        -- exp 0
--   (select count(*) from audit_log)          as audit_rows,     -- exp 0
--   (select count(*) from parties)            as parties,        -- exp 0
--   (select count(*) from memberships)        as memberships,    -- exp 0
--   (select count(*) from auth.users)         as users,          -- exp 1
--   (select count(*) from payers where org_id is null)           as global_payers,  -- exp 269
--   (select count(*) from payers)             as payers_total,   -- exp 269
--   (select count(*) from portal_field_maps)  as field_maps,     -- exp 24
--   (select count(*) from sop_templates)      as sop_templates,  -- exp 1
--   (select count(*) from party_role_types)   as role_types;     -- exp 6

-- Payer drop inventory. Every column on the 20260716180000 drop list
-- should now read 0 non-null, which makes that migration free to apply.
-- select count(*) total, count(portal_url) portal_url,
--        count(provider_type_path) ptp, count(payer_billing_id) pbi,
--        count(prior_auth_vendor) pav, count(cms_hios_id) hios,
--        count(prerequisite_payer_id) prereq
--   from payers;
-- expect: total 269, every other column 0

-- =====================================================================
-- KNOWN GAPS -- not handled here, need a follow-up
--
-- 1. STORAGE. provider_documents rows cascade; the objects in the
--    provider-documents bucket do NOT. All files become garbage with no
--    DB row pointing at them. Sweep the bucket separately.
--
-- 2. PORTAL REGISTRY vs FIELD MAPS. The 24 global portal_field_maps
--    survive. The 1 portals registry row was KFP-scoped and dies. There
--    is no FK between them (they join on portal_key text), so this will
--    not error -- it will just leave the extension with field maps for a
--    portal that is no longer registered. Re-seed portals as a global row
--    before the next fill test.
--
-- 3. SOP TEMPLATES. 21 of 22 deleted. E4.2/E4.3 SOP resolution work now
--    has 1 row to resolve against. Expect e2e specs asserting on template
--    tiers / generic fallback to fail until the seed universe is rebuilt.
-- =====================================================================

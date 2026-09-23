\set QUIET 1
BEGIN;
-- Fail before fixture writes, including when this file is invoked directly.
-- The runner observes local identity through loopback, or verifies the pinned
-- staging cluster. A hosted restore requires an explicit identity re-audit.
SELECT set_config('minted.uat_expected_database_identity', :'expected_database_identity', true);
DO $$
DECLARE v_identity text := (SELECT system_identifier::text FROM pg_control_system());
BEGIN
  IF v_identity = '7642734024280108049'
     OR v_identity IS DISTINCT FROM current_setting('minted.uat_expected_database_identity') THEN
    RAISE EXCEPTION 'UAT fixture refused: database identity is production or does not match preflight';
  END IF;
END;
$$;
SELECT set_config('minted.uat_fixture_version', :'fixture_version', true);
SELECT set_config('minted.uat_reset_mode', :'reset_mode', true);
SELECT set_config('minted.uat_deletion_case_ids', :'deletion_case_ids', true);

CREATE OR REPLACE FUNCTION pg_temp.uat_uuid(p_kind text, p_index integer)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
  FROM (SELECT encode(extensions.digest('minted-uat:' || current_setting('minted.uat_fixture_version') || ':' || p_kind || ':' || p_index, 'sha256'), 'hex') h) s
$$;
CREATE OR REPLACE FUNCTION pg_temp.uat_full_seed()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('minted.uat_reset_mode') <> 'deletion-pool'
$$;

-- Reset boundaries are exact deterministic IDs. Audit receipts are never deleted.
DO $$
DECLARE v_mode text := current_setting('minted.uat_reset_mode');
BEGIN
  IF v_mode IN ('deletion-pool', 'all') THEN
    UPDATE public.touches SET corrects_touch_id = NULL
      WHERE case_id = ANY(string_to_array(current_setting('minted.uat_deletion_case_ids'), ',')::uuid[]);
    DELETE FROM public.touches WHERE case_id = ANY(string_to_array(current_setting('minted.uat_deletion_case_ids'), ',')::uuid[]);
    DELETE FROM public.tasks WHERE case_id = ANY(string_to_array(current_setting('minted.uat_deletion_case_ids'), ',')::uuid[]);
    DELETE FROM public.status_history WHERE case_id = ANY(string_to_array(current_setting('minted.uat_deletion_case_ids'), ',')::uuid[]);
    DELETE FROM public.case_facilities WHERE case_id = ANY(string_to_array(current_setting('minted.uat_deletion_case_ids'), ',')::uuid[]);
    DELETE FROM public.credential_cases WHERE id = ANY(string_to_array(current_setting('minted.uat_deletion_case_ids'), ',')::uuid[]);
  END IF;
  IF v_mode = 'all' THEN
    DELETE FROM public.touches WHERE id IN (SELECT pg_temp.uat_uuid('touch', i) FROM generate_series(1,60) i);
    DELETE FROM public.tasks WHERE id IN (SELECT pg_temp.uat_uuid('task', i) FROM generate_series(1,100) i);
    DELETE FROM public.case_facilities WHERE id IN (SELECT pg_temp.uat_uuid('case-facility', i) FROM generate_series(1,100) i);
    DELETE FROM public.credential_cases WHERE id IN (SELECT pg_temp.uat_uuid('case', i) FROM generate_series(1,50) i);
    DELETE FROM public.enrollment_facts WHERE id IN (SELECT pg_temp.uat_uuid('enrollment', i) FROM generate_series(1,20) i);
    DELETE FROM public.provider_facility_assignments WHERE id IN (SELECT pg_temp.uat_uuid('provider-facility', i) FROM generate_series(1,30) i);
    DELETE FROM public.provider_group_assignments WHERE id IN (SELECT pg_temp.uat_uuid('provider-group', i) FROM generate_series(1,20) i);
    DELETE FROM public.state_licenses WHERE id IN (SELECT pg_temp.uat_uuid('license', i) FROM generate_series(1,30) i);
    DELETE FROM public.providers WHERE id IN (SELECT pg_temp.uat_uuid('provider', i) FROM generate_series(1,20) i);
    DELETE FROM public.payer_network_targets WHERE id IN (SELECT pg_temp.uat_uuid('payer-target', i) FROM generate_series(1,30) i);
    DELETE FROM public.org_payer_assignments WHERE id IN (SELECT pg_temp.uat_uuid('org-payer', i) FROM generate_series(1,24) i);
    DELETE FROM public.facilities WHERE id IN (SELECT pg_temp.uat_uuid('facility', i) FROM generate_series(1,10) i);
    DELETE FROM public.provider_groups WHERE id IN (SELECT pg_temp.uat_uuid('group', i) FROM generate_series(1,5) i);
    DELETE FROM public.payers WHERE id IN (SELECT pg_temp.uat_uuid('payer', i) FROM generate_series(1,8) i);
  END IF;
END $$;

SELECT pg_temp.uat_full_seed() AS uat_full_seed \gset
\if :uat_full_seed
INSERT INTO public.organizations (id, name)
SELECT pg_temp.uat_uuid('organization', i), 'Minted UAT Organization ' || i
FROM generate_series(1,3) i ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.profiles (id, full_name, email) VALUES
  (:'user_admin_alpha', 'UAT Admin Alpha', 'uat.admin.alpha@minted.invalid'),
  (:'user_admin_beta', 'UAT Admin Beta', 'uat.admin.beta@minted.invalid'),
  (:'user_admin_gamma', 'UAT Admin Gamma', 'uat.admin.gamma@minted.invalid'),
  (:'user_specialist_alpha', 'UAT Specialist Alpha', 'uat.specialist.alpha@minted.invalid')
ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name, email=EXCLUDED.email;

INSERT INTO public.memberships (id, org_id, user_id, role) VALUES
  (pg_temp.uat_uuid('membership',1), pg_temp.uat_uuid('organization',1), :'user_admin_alpha', 'admin'),
  (pg_temp.uat_uuid('membership',2), pg_temp.uat_uuid('organization',2), :'user_admin_beta', 'admin'),
  (pg_temp.uat_uuid('membership',3), pg_temp.uat_uuid('organization',3), :'user_admin_gamma', 'admin'),
  (pg_temp.uat_uuid('membership',4), pg_temp.uat_uuid('organization',1), :'user_specialist_alpha', 'specialist')
ON CONFLICT (user_id, org_id) DO UPDATE SET role=EXCLUDED.role;

INSERT INTO public.provider_groups (id, org_id, name, tin, npi_type2, states, billing_state)
SELECT pg_temp.uat_uuid('group',i), pg_temp.uat_uuid('organization', CASE WHEN i<=3 THEN 1 WHEN i=4 THEN 2 ELSE 3 END),
  'UAT Group '||i, lpad((700000000+i)::text,9,'0'), lpad((1900000000+i)::text,10,'0'),
  CASE WHEN i%2=0 THEN ARRAY['CO','WY'] ELSE ARRAY['CO','UT'] END, 'CO'
FROM generate_series(1,5) i ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name;

INSERT INTO public.facilities (id, org_id, group_id, name, street, city, state, zip, is_active)
SELECT pg_temp.uat_uuid('facility',i), pg_temp.uat_uuid('organization', CASE WHEN i<=6 THEN 1 WHEN i<=8 THEN 2 ELSE 3 END),
  pg_temp.uat_uuid('group', CASE WHEN i<=6 THEN ((i-1)%3)+1 WHEN i<=8 THEN 4 ELSE 5 END),
  'UAT Location '||i, i||' Fixture Way', 'Denver', CASE WHEN i%3=0 THEN 'WY' ELSE 'CO' END, '80202', true
FROM generate_series(1,10) i ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, group_id=EXCLUDED.group_id;

INSERT INTO public.payers (id, org_id, name, is_active, payer_kind, states, status, source)
SELECT pg_temp.uat_uuid('payer',i), NULL, 'UAT Payer '||i, true,
  CASE WHEN i%3=0 THEN 'medicaid' WHEN i%2=0 THEN 'medicare_advantage' ELSE 'commercial' END,
  CASE WHEN i=8 THEN ARRAY['UT'] ELSE ARRAY['CO','WY'] END, 'active', 'seed'
FROM generate_series(1,8) i ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, states=EXCLUDED.states;

INSERT INTO public.org_payer_assignments (id, org_id, payer_id, status)
SELECT pg_temp.uat_uuid('org-payer', ((o-1)*8)+p), pg_temp.uat_uuid('organization',o), pg_temp.uat_uuid('payer',p), 'active'
FROM generate_series(1,3) o CROSS JOIN generate_series(1,8) p ON CONFLICT (org_id,payer_id) DO UPDATE SET status='active', archived_at=NULL;

INSERT INTO public.providers (id, org_id, group_id, first_name, last_name, credentials, npi, specialty, taxonomy_code, home_state, license_state, status)
SELECT pg_temp.uat_uuid('provider',i), pg_temp.uat_uuid('organization', CASE WHEN i<=12 THEN 1 WHEN i<=16 THEN 2 ELSE 3 END),
  pg_temp.uat_uuid('group', CASE WHEN i<=12 THEN ((i-1)%3)+1 WHEN i<=16 THEN 4 ELSE 5 END),
  'Fixture'||i, 'Provider', 'PT, DPT', lpad((1800000000+i)::text,10,'0'), 'Physical Therapy', '225100000X', 'CO', 'CO',
  CASE WHEN i%5=0 THEN 'onboarding' ELSE 'active' END
FROM generate_series(1,20) i ON CONFLICT (id) DO UPDATE SET group_id=EXCLUDED.group_id, status=EXCLUDED.status;

INSERT INTO public.provider_group_assignments (id, org_id, provider_id, group_id, is_primary, start_date)
SELECT pg_temp.uat_uuid('provider-group',i), p.org_id, p.id, p.group_id, true, DATE '2025-01-01'
FROM public.providers p JOIN generate_series(1,20) i ON p.id=pg_temp.uat_uuid('provider',i)
ON CONFLICT (provider_id,group_id) DO UPDATE SET is_primary=true;

INSERT INTO public.state_licenses (id, org_id, provider_id, state, license_number, license_type, issue_date, expiration_date, status, verified_status, verification_source_url)
SELECT pg_temp.uat_uuid('license',i), p.org_id, p.id, CASE WHEN i%3=0 THEN 'WY' ELSE 'CO' END,
  'UAT-LIC-'||lpad(i::text,3,'0'), CASE WHEN i%3=0 THEN 'compact' ELSE 'full' END, DATE '2024-01-01',
  CASE WHEN i%5=0 THEN CURRENT_DATE-30 WHEN i%5=1 THEN CURRENT_DATE+30 ELSE CURRENT_DATE+365 END,
  CASE WHEN i%5=0 THEN 'expired' ELSE 'active' END,
  CASE WHEN i%4=0 THEN 'verified' ELSE 'unverified' END,
  CASE WHEN i%4=0 THEN 'https://example.invalid/uat-license' ELSE NULL END
FROM generate_series(1,30) i JOIN public.providers p ON p.id=pg_temp.uat_uuid('provider', ((i-1)%20)+1)
ON CONFLICT (id) DO UPDATE SET expiration_date=EXCLUDED.expiration_date, status=EXCLUDED.status;

INSERT INTO public.provider_facility_assignments (id, org_id, provider_id, facility_id, is_primary, start_date, practice_frequency)
SELECT pg_temp.uat_uuid('provider-facility',i), p.org_id, p.id,
  pg_temp.uat_uuid('facility', CASE
    WHEN ((i-1)%20)+1 <= 12 THEN ((((i-1)%20)+1+i/21)::integer%6)+1
    WHEN ((i-1)%20)+1 <= 16 THEN 7+((((i-1)%20)+1-13+i/21)::integer%2)
    ELSE 9+((((i-1)%20)+1-17+i/21)::integer%2) END),
  i<=20, DATE '2025-01-01', CASE WHEN i%2=0 THEN 'Full time' ELSE 'Part time' END
FROM generate_series(1,30) i JOIN public.providers p ON p.id=pg_temp.uat_uuid('provider', ((i-1)%20)+1)
ON CONFLICT (provider_id,facility_id) DO UPDATE SET practice_frequency=EXCLUDED.practice_frequency;

INSERT INTO public.payer_network_targets (id, org_id, payer_id, group_id, state, status)
SELECT pg_temp.uat_uuid('payer-target',i), g.org_id, pg_temp.uat_uuid('payer',((i-1)%8)+1), g.id,
  CASE WHEN i%5=0 THEN 'WY' ELSE 'CO' END, CASE WHEN i%11=0 THEN 'archived' ELSE 'active' END
FROM generate_series(1,30) i JOIN public.provider_groups g ON g.id=pg_temp.uat_uuid('group',((i-1)%5)+1)
ON CONFLICT (group_id,payer_id,state) DO UPDATE SET status=EXCLUDED.status;
\endif

-- Fifty cases: 40 shared workflow cases and exactly 10 disposable cases (41-50).
INSERT INTO public.credential_cases (id, org_id, provider_id, group_id, facility_id, payer_id, state, specialty, created_by, case_status, payer_pipeline_state, submitted_date, approved_date)
SELECT pg_temp.uat_uuid('case',i), p.org_id, p.id, p.group_id,
  pg_temp.uat_uuid('facility', CASE
    WHEN p.org_id=pg_temp.uat_uuid('organization',1) THEN ((i-1)%6)+1
    WHEN p.org_id=pg_temp.uat_uuid('organization',2) THEN 7+((i-1)%2)
    ELSE 9+((i-1)%2) END),
  pg_temp.uat_uuid('payer',CASE WHEN i>40 THEN ((i-39)%8)+1 ELSE ((i-1)%8)+1 END),
  CASE WHEN i>40 THEN 'CO' WHEN i%4=0 THEN 'WY' ELSE 'CO' END, 'Physical Therapy', :'user_admin_alpha',
  (ARRAY['not_started','in_progress','submitted','approved','denied','action_required'])[((i-1)%6)+1],
  (ARRAY['not_started','drafting','submitted','approved','denied','action_required'])[((i-1)%6)+1],
  CASE WHEN i%6 IN (3,4,5) THEN CURRENT_DATE-20 ELSE NULL END,
  CASE WHEN i%6=4 THEN CURRENT_DATE-5 ELSE NULL END
FROM generate_series(1,50) i JOIN public.providers p ON p.id=pg_temp.uat_uuid('provider', CASE WHEN i<=40 THEN ((i-1)%20)+1 ELSE ((i-41)%12)+1 END)
WHERE pg_temp.uat_full_seed() OR i>40
ON CONFLICT (id) DO UPDATE SET case_status=EXCLUDED.case_status, payer_pipeline_state=EXCLUDED.payer_pipeline_state;

INSERT INTO public.tasks (id, org_id, case_id, provider_id, title, description, sop_content, status, sort_order, is_auto_generated)
SELECT pg_temp.uat_uuid('task',i), c.org_id, c.id, c.provider_id, 'UAT Workflow Step '||i, 'Synthetic UAT task',
  jsonb_build_array(jsonb_build_object('id','step-'||i,'label','Verify synthetic fixture','completed',i%3=0)),
  CASE WHEN i%4=0 THEN 'completed' WHEN i%4=1 THEN 'not_started' ELSE 'in_progress' END, ((i-1)%2)+1, true
FROM generate_series(1,100) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',((i-1)%50)+1)
WHERE pg_temp.uat_full_seed() OR ((i-1)%50)+1>40
ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, sop_content=EXCLUDED.sop_content;

INSERT INTO public.touches (id, org_id, case_id, touch_date, touch_type, outcome, notes, coordinator_id, entry_type, corrects_touch_id)
SELECT pg_temp.uat_uuid('touch',i), c.org_id, c.id, CURRENT_DATE-(i%20),
  CASE WHEN i%4=0 THEN 'portal' WHEN i%4=1 THEN 'call' WHEN i%4=2 THEN 'email' ELSE 'fax' END,
  CASE WHEN i%3=0 THEN 'successful' ELSE 'attempted' END, 'Synthetic UAT touch '||i, :'user_specialist_alpha', 'touchpoint',
  CASE WHEN i>50 THEN pg_temp.uat_uuid('touch',i-50) ELSE NULL END
FROM generate_series(1,60) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',CASE WHEN i<=50 THEN i ELSE i-10 END)
WHERE pg_temp.uat_full_seed() OR i>=41
ON CONFLICT (id) DO UPDATE SET notes=EXCLUDED.notes, corrects_touch_id=EXCLUDED.corrects_touch_id;

INSERT INTO public.case_status_history (id, org_id, case_id, from_status, to_status, actor_kind, changed_by)
SELECT pg_temp.uat_uuid('case-history',i), c.org_id, c.id, NULL, c.case_status, 'system', :'user_admin_alpha'
FROM generate_series(1,50) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',i)
WHERE pg_temp.uat_full_seed() OR i>40
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payer_pipeline_history (id, org_id, case_id, from_state, to_state, changed_by)
SELECT pg_temp.uat_uuid('payer-history',i), c.org_id, c.id, NULL, c.payer_pipeline_state, :'user_admin_alpha'
FROM generate_series(1,50) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',i)
WHERE pg_temp.uat_full_seed() OR i>40
ON CONFLICT (id) DO NOTHING;

\if :uat_full_seed
INSERT INTO public.status_configs (id, org_id, track, label, color, sort_order)
SELECT pg_temp.uat_uuid('status-config',i), pg_temp.uat_uuid('organization',((i-1)%3)+1), 'credentialing', 'UAT Legacy Status '||i, '#64748B', i
FROM generate_series(1,3) i ON CONFLICT (id) DO NOTHING;
\endif

INSERT INTO public.status_history (id, org_id, case_id, track, to_status_id, changed_by)
SELECT pg_temp.uat_uuid('legacy-history',i), c.org_id, c.id, 'credentialing', pg_temp.uat_uuid('status-config',1), :'user_admin_alpha'
FROM generate_series(41,50) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',i)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_facilities (id, org_id, case_id, facility_id, is_primary, created_by)
SELECT pg_temp.uat_uuid('case-facility',i), c.org_id, c.id, c.facility_id, true, :'user_admin_alpha'
FROM generate_series(1,50) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',i)
WHERE pg_temp.uat_full_seed() OR i>40
ON CONFLICT (case_id,facility_id) DO UPDATE SET is_primary=true;

INSERT INTO public.case_facilities (id, org_id, case_id, facility_id, is_primary, created_by)
SELECT pg_temp.uat_uuid('case-facility',50+i), c.org_id, c.id,
  pg_temp.uat_uuid('facility', CASE WHEN c.facility_id=pg_temp.uat_uuid('facility',1) THEN 2 ELSE 1 END), false, :'user_admin_alpha'
FROM generate_series(41,50) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',i)
ON CONFLICT (case_id,facility_id) DO NOTHING;

INSERT INTO public.fill_sessions (id, org_id, case_id, provider_id, portal_key, fill_mode, fields_filled, performed_by)
SELECT pg_temp.uat_uuid('fill-session',i), c.org_id, c.id, c.provider_id, 'uat-payer-portal', 'web', 12, :'user_admin_alpha'
FROM generate_series(41,50) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',i)
ON CONFLICT (id) DO UPDATE SET fields_filled=EXCLUDED.fields_filled;

\if :uat_full_seed
INSERT INTO public.case_generation_runs (id, org_id, created_by, proposed_count, created_count, skipped_existing_count, excluded_count, failed_count)
VALUES (pg_temp.uat_uuid('generation-run',1), pg_temp.uat_uuid('organization',1), :'user_admin_alpha', 10, 10, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;
\endif

INSERT INTO public.case_generation_run_rows (id, org_id, run_id, provider_id, group_id, payer_id, state, disposition, reason, case_id)
SELECT pg_temp.uat_uuid('generation-row',i), c.org_id, pg_temp.uat_uuid('generation-run',1), c.provider_id, c.group_id, c.payer_id, c.state, 'created', 'UAT deletion-pool generation path', c.id
FROM generate_series(41,50) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',i)
ON CONFLICT (id) DO UPDATE SET case_id=EXCLUDED.case_id;

-- Twenty enrollment facts; deletion case 46 is forced approved with a live fact.
UPDATE public.credential_cases SET case_status='approved', payer_pipeline_state='approved', approved_date=CURRENT_DATE-5
WHERE id=pg_temp.uat_uuid('case',46);
INSERT INTO public.enrollment_facts (id, org_id, provider_id, group_id, payer_id, state, effective_date, source, created_by)
SELECT pg_temp.uat_uuid('enrollment',i), c.org_id, c.provider_id, c.group_id, c.payer_id, c.state, CURRENT_DATE-90, 'migration', :'user_admin_alpha'
FROM generate_series(1,20) i JOIN public.credential_cases c ON c.id=pg_temp.uat_uuid('case',CASE WHEN i=20 THEN 46 ELSE i END)
WHERE pg_temp.uat_full_seed() OR i=20
ON CONFLICT (id) DO UPDATE SET expired_at=NULL, expired_by=NULL, effective_date=EXCLUDED.effective_date;

INSERT INTO public.case_generation_exclusions (id, org_id, provider_id, group_id, payer_id, state, reason, status, created_by)
SELECT pg_temp.uat_uuid('exclusion',1), c.org_id, c.provider_id, c.group_id, c.payer_id, c.state, 'already_credentialed', 'active', :'user_admin_alpha'
FROM public.credential_cases c WHERE c.id=pg_temp.uat_uuid('case',46)
ON CONFLICT (id) DO UPDATE SET status='active', voided_by=NULL, voided_at=NULL;

COMMIT;
\set QUIET 0
\echo 'UAT public fixture transaction committed'

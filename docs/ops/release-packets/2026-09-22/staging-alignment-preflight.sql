-- READ ONLY: aggregate preflight for staging alignment B1-B14.
-- Fixed project: vmznysvietfaddakkegt. No production query is authorized.
-- Baseline source: 43b59cfa95c84a929c452cc097453c802bbef50b.
-- No DDL, DML, temporary objects, application RPC calls or row/text output.
-- The identity guard deliberately raises division_by_zero on another cluster.
-- Existing-column references were checked against the staging catalog snapshot.
-- Missing future columns are inspected through catalog metadata/to_jsonb only.
-- This is a pre-alignment query, not a complete post-migration validator.
WITH
identity_guard AS MATERIALIZED (
  SELECT 1 / (system_identifier::text = '7662742571317219726')::integer AS ok
  FROM pg_control_system()
),
cases AS MATERIALIZED (
  SELECT c.*, to_jsonb(c) AS j, s.label AS legacy_label,
    CASE
      WHEN c.payer_pipeline_state IN ('assigned', 'drafting') THEN 'in_progress'
      WHEN c.payer_pipeline_state IN ('submitted', 'in_review', 'action_required', 'approved', 'denied') THEN c.payer_pipeline_state
      WHEN c.payer_pipeline_state = 'oon' THEN 'not_pursuing'
      ELSE CASE COALESCE(s.label, '')
        WHEN 'In Progress' THEN 'in_progress'
        WHEN 'Waiting on Provider' THEN 'in_progress'
        WHEN 'Submitted' THEN 'submitted'
        WHEN 'Approved' THEN 'approved'
        WHEN 'In-Network' THEN 'approved'
        WHEN 'Denied' THEN 'denied'
        WHEN 'OON' THEN 'not_pursuing'
        WHEN 'Not Required' THEN 'not_pursuing'
        ELSE 'not_started'
      END
    END AS proposed_status
  FROM public.credential_cases c
  LEFT JOIN public.status_configs s ON s.id = c.credentialing_status_id
  CROSS JOIN identity_guard g
  WHERE g.ok = 1
),
contract_candidates AS (
  SELECT c.id, count(ct.id) AS matches,
    count(DISTINCT ct.effective_date) AS distinct_dates
  FROM cases c
  LEFT JOIN public.contracts ct
    ON ct.org_id = c.org_id AND ct.group_id = c.group_id
    AND ct.payer_id = c.payer_id AND ct.state = c.state
    AND ct.effective_date IS NOT NULL
  WHERE c.proposed_status = 'approved' AND c.confirmed_effective_date IS NULL
  GROUP BY c.id
),
party_assignment_orgs AS (
  SELECT party_id, count(*) AS assignments, count(DISTINCT org_id) AS orgs,
    min(org_id::text)::uuid AS sole_org
  FROM public.party_role_assignments GROUP BY party_id
),
creator_orgs AS (
  SELECT user_id, count(DISTINCT org_id) AS orgs, min(org_id::text)::uuid AS sole_org
  FROM public.memberships GROUP BY user_id
),
party_resolution AS (
  SELECT p.id, p.created_by, to_jsonb(p) AS j,
    COALESCE(a.assignments, 0) AS assignments,
    COALESCE(a.orgs, 0) AS assignment_orgs,
    COALESCE(m.orgs, 0) AS creator_orgs,
    CASE WHEN a.orgs = 1 THEN a.sole_org
      WHEN COALESCE(a.orgs, 0) = 0 AND m.orgs = 1 THEN m.sole_org
      ELSE NULL END AS proposed_org
  FROM public.parties p
  LEFT JOIN party_assignment_orgs a ON a.party_id = p.id
  LEFT JOIN creator_orgs m ON m.user_id = p.created_by
),
role_defaults AS (
  SELECT org_id, role_key, count(*) AS assignments,
    count(*) FILTER (WHERE COALESCE((to_jsonb(a)->>'is_default')::boolean, false)) AS defaults
  FROM public.party_role_assignments a GROUP BY org_id, role_key
),
insurance_grains AS (
  SELECT group_id, insurance_type, count(*) AS policies,
    count(*) FILTER (WHERE COALESCE(to_jsonb(i)->>'coverage_level', 'primary') = 'primary') AS proposed_primaries
  FROM public.group_insurance_policies i GROUP BY group_id, insurance_type
),
template_rows AS MATERIALIZED (
  SELECT t.*, to_jsonb(t) AS j,
    CASE
      WHEN jsonb_typeof(to_jsonb(t)->'states') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(to_jsonb(t)->'states'))
      WHEN t.state IS NOT NULL THEN ARRAY[t.state]
      ELSE NULL::text[]
    END AS proposed_states
  FROM public.sop_templates t
),
template_steps AS MATERIALIZED (
  SELECT t.id AS template_id, t.org_id, t.current_version, t.name,
    t.task_definitions, task.ordinality AS task_ordinal,
    step.ordinality AS step_ordinal, step.value AS step_value
  FROM template_rows t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.task_definitions) = 'array' THEN t.task_definitions ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS task(value, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(task.value->'steps') = 'array' THEN task.value->'steps' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS step(value, ordinality)
),
affected_templates AS MATERIALIZED (
  SELECT DISTINCT template_id, org_id, current_version, name, task_definitions
  FROM template_steps
  WHERE step_value->>'stepType' = 'online_form'
    AND jsonb_array_length(CASE WHEN jsonb_typeof(step_value->'dataFields') = 'array'
      THEN step_value->'dataFields' ELSE '[]'::jsonb END) > 0
),
step_fields AS MATERIALIZED (
  SELECT s.template_id, s.org_id,
    lower(btrim(s.step_value->>'portalKey')) AS portal_key,
    'manual:' || md5(s.template_id::text || ':' || s.task_ordinal::text || ':' || s.step_ordinal::text || ':' ||
      COALESCE(field.value->>'token', field.value->>'label', field.ordinality::text)) AS selector,
    nullif(btrim(COALESCE(field.value->>'label', '')), '') AS field_label
  FROM template_steps s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.step_value->'dataFields') = 'array'
      THEN s.step_value->'dataFields' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS field(value, ordinality)
  WHERE s.step_value->>'stepType' = 'online_form'
),
missing_tables AS (
  SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
  FROM (VALUES ('case_facilities'), ('case_status_history'), ('enrollment_facts'),
    ('payer_contacts'), ('payer_forms'), ('provider_field_verifications'),
    ('provider_ssn_intake_links'), ('provider_ssn_vault')) AS v(name)
),
function_preservation AS (
  SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
    md5(pg_get_functiondef(p.oid)) AS definition_md5,
    p.prosecdef AS security_definer,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'commit_import_run', 'delete_case', 'trg_case_generation_run_rows_created_case_check')
),
preservation_rows AS (
  SELECT 'credential_cases' AS object_name, count(*) AS rows,
    md5(COALESCE(string_agg(md5(to_jsonb(c)::text), '' ORDER BY c.id), '')) AS rowset_md5
  FROM public.credential_cases c
  UNION ALL
  SELECT 'parties', count(*), md5(COALESCE(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id), '')) FROM public.parties p
  UNION ALL
  SELECT 'party_role_assignments', count(*), md5(COALESCE(string_agg(md5(to_jsonb(a)::text), '' ORDER BY a.id), '')) FROM public.party_role_assignments a
  UNION ALL
  SELECT 'provider_facility_assignments', count(*), md5(COALESCE(string_agg(md5(to_jsonb(a)::text), '' ORDER BY a.id), '')) FROM public.provider_facility_assignments a
  UNION ALL
  SELECT 'provider_group_assignments', count(*), md5(COALESCE(string_agg(md5(to_jsonb(a)::text), '' ORDER BY a.id), '')) FROM public.provider_group_assignments a
  UNION ALL
  SELECT 'provider_documents', count(*), md5(COALESCE(string_agg(md5(to_jsonb(d)::text), '' ORDER BY d.id), '')) FROM public.provider_documents d
  UNION ALL
  SELECT 'sop_templates', count(*), md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t.id), '')) FROM public.sop_templates t
  UNION ALL
  SELECT 'sop_template_versions', count(*), md5(COALESCE(string_agg(md5(to_jsonb(v)::text), '' ORDER BY v.id), '')) FROM public.sop_template_versions v
)
SELECT jsonb_build_object(
  'scope', jsonb_build_object(
    'project_ref', 'vmznysvietfaddakkegt', 'identity_guard_passed', g.ok = 1,
    'captured_at_utc', current_timestamp AT TIME ZONE 'UTC',
    'source_ref', '43b59cfa95c84a929c452cc097453c802bbef50b',
    'read_only_aggregate', true),
  'B1_status', jsonb_build_object(
    'cases', (SELECT count(*) FROM cases),
    'mapped_counts', (SELECT jsonb_object_agg(proposed_status, n) FROM (SELECT proposed_status, count(*) AS n FROM cases GROUP BY proposed_status) x),
    'unknown_pipeline', (SELECT count(*) FROM cases WHERE payer_pipeline_state IS NOT NULL AND payer_pipeline_state NOT IN ('not_started','assigned','drafting','submitted','in_review','action_required','approved','denied','oon')),
    'unknown_label', (SELECT count(*) FROM cases WHERE legacy_label IS NOT NULL AND legacy_label NOT IN ('Not Started','In Progress','Waiting on Provider','Submitted','Approved','In-Network','Denied','OON','Not Required')),
    'missing_status_reference', (SELECT count(*) FROM cases WHERE credentialing_status_id IS NOT NULL AND legacy_label IS NULL),
    'already_canonical', (SELECT count(*) FROM cases WHERE j->>'case_status' IS NOT NULL)),
  'B2_dates', jsonb_build_object(
    'approved_missing_date', (SELECT count(*) FROM contract_candidates),
    'eligible_single_contract', (SELECT count(*) FROM contract_candidates WHERE matches = 1),
    'no_contract_date', (SELECT count(*) FROM contract_candidates WHERE matches = 0),
    'multiple_contract_matches', (SELECT count(*) FROM contract_candidates WHERE matches > 1),
    'conflicting_contract_dates', (SELECT count(*) FROM contract_candidates WHERE distinct_dates > 1)),
  'B3_history', jsonb_build_object(
    'history_table_present', to_regclass('public.case_status_history') IS NOT NULL,
    'initial_rows_expected_if_table_absent', (SELECT count(*) FROM cases)),
  'B4_numbers', jsonb_build_object(
    'missing_numbers', (SELECT count(*) FROM cases WHERE j->>'case_number' IS NULL),
    'existing_numbers', (SELECT count(*) FROM cases WHERE j->>'case_number' IS NOT NULL),
    'duplicate_number_groups', (SELECT count(*) FROM (SELECT j->>'case_number' FROM cases WHERE j->>'case_number' IS NOT NULL GROUP BY j->>'case_number' HAVING count(*) > 1) x),
    'maximum_number', (SELECT max((j->>'case_number')::bigint) FROM cases),
    'sequence_present', to_regclass('public.credential_cases_case_number_seq') IS NOT NULL,
    'sequence_last_value', (SELECT last_value FROM pg_sequences WHERE schemaname='public' AND sequencename='credential_cases_case_number_seq')),
  'B5_facilities', jsonb_build_object(
    'explicit_facility', (SELECT count(*) FROM cases WHERE facility_id IS NOT NULL),
    'null_facility', (SELECT count(*) FROM cases WHERE facility_id IS NULL),
    'missing_or_wrong_org_facility', (SELECT count(*) FROM cases c LEFT JOIN public.facilities f ON f.id=c.facility_id WHERE c.facility_id IS NOT NULL AND (f.id IS NULL OR f.org_id IS DISTINCT FROM c.org_id)),
    'wrong_case_group_facility', (SELECT count(*) FROM cases c JOIN public.facilities f ON f.id=c.facility_id WHERE f.group_id IS DISTINCT FROM c.group_id),
    'missing_provider_assignment', (SELECT count(*) FROM cases c WHERE c.facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.provider_facility_assignments a WHERE a.provider_id=c.provider_id AND a.facility_id=c.facility_id AND a.org_id=c.org_id)),
    'explicit_inactive_facility_preserve', (SELECT count(*) FROM cases c JOIN public.facilities f ON f.id=c.facility_id WHERE f.is_active IS NOT TRUE),
    'join_table_present', to_regclass('public.case_facilities') IS NOT NULL),
  'B6_documents', jsonb_build_object(
    'rows', (SELECT count(*) FROM public.provider_documents),
    'missing_family', (SELECT count(*) FROM public.provider_documents d WHERE to_jsonb(d)->>'document_family_id' IS NULL),
    'unsupported_kind', (SELECT count(*) FROM public.provider_documents WHERE doc_type IS NULL OR doc_type NOT IN ('w9','coi','state_license','dea','diploma','board_cert','voided_check','filled_form','other','cms_460','cv','cp_575')),
    'legacy_expiring_without_date', (SELECT count(*) FROM public.provider_documents WHERE doc_type IN ('state_license','dea','coi') AND expiration_date IS NULL),
    'invalid_version', (SELECT count(*) FROM public.provider_documents d WHERE to_jsonb(d)->>'version_number' IS NOT NULL AND (to_jsonb(d)->>'version_number')::integer < 1),
    'duplicate_family_version_groups', (SELECT count(*) FROM (SELECT org_id,to_jsonb(d)->>'document_family_id',to_jsonb(d)->>'version_number' FROM public.provider_documents d WHERE to_jsonb(d)->>'document_family_id' IS NOT NULL GROUP BY org_id,to_jsonb(d)->>'document_family_id',to_jsonb(d)->>'version_number' HAVING count(*)>1) x),
    'orphaned_owner_reference', (SELECT count(*) FROM public.provider_documents d WHERE (d.provider_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.providers p WHERE p.id=d.provider_id AND p.org_id=d.org_id)) OR (d.group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.provider_groups p WHERE p.id=d.group_id AND p.org_id=d.org_id)) OR (d.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.id=d.case_id AND c.org_id=d.org_id)))),
  'B7_payers', jsonb_build_object(
    'rows', (SELECT count(*) FROM public.payers),
    'duplicate_global_name_groups', (SELECT count(*) FROM (SELECT lower(btrim(name)) FROM public.payers WHERE org_id IS NULL AND status<>'merged' GROUP BY lower(btrim(name)) HAVING count(*)>1) x),
    'unknown_kind', (SELECT count(*) FROM public.payers WHERE payer_kind IS NOT NULL AND payer_kind NOT IN ('commercial','medicare','medicaid','medicaid_mco','medicare_advantage','tricare')),
    'unknown_status', (SELECT count(*) FROM public.payers WHERE status IS NOT NULL AND status NOT IN ('active','merged','retired')),
    'unknown_source', (SELECT count(*) FROM public.payers p WHERE to_jsonb(p)->>'source' IS NOT NULL AND to_jsonb(p)->>'source' NOT IN ('seed','sync','manual')),
    'provider_id_pair_eligible', (SELECT count(*) FROM public.payers p WHERE to_jsonb(p)->>'provider_id_label' IS NULL AND to_jsonb(p)->>'provider_id_expected' IS NULL AND (resolution_id_label IS NOT NULL OR resolution_id_expected IS NOT NULL)),
    'source_backfill_eligible', (SELECT count(*) FROM public.payers p WHERE to_jsonb(p)->>'source' IS NULL)),
  'B8_parties', jsonb_build_object(
    'rows', (SELECT count(*) FROM party_resolution),
    'multiple_assignment_orgs', (SELECT count(*) FROM party_resolution WHERE assignment_orgs>1),
    'resolved_by_assignment', (SELECT count(*) FROM party_resolution WHERE assignment_orgs=1),
    'resolved_by_sole_creator_org', (SELECT count(*) FROM party_resolution WHERE assignment_orgs=0 AND creator_orgs=1),
    'unresolved', (SELECT count(*) FROM party_resolution WHERE proposed_org IS NULL),
    'unassigned_multi_org_creator', (SELECT count(*) FROM party_resolution WHERE assignments=0 AND creator_orgs>1),
    'unassigned_no_creator_membership', (SELECT count(*) FROM party_resolution WHERE assignments=0 AND creator_orgs=0),
    'existing_owner_conflict', (SELECT count(*) FROM party_resolution WHERE j->>'org_id' IS NOT NULL AND (j->>'org_id')::uuid IS DISTINCT FROM proposed_org),
    'orphan_assignment', (SELECT count(*) FROM public.party_role_assignments a LEFT JOIN public.parties p ON p.id=a.party_id WHERE p.id IS NULL),
    'legacy_name_split_eligible', (SELECT count(*) FROM public.parties p WHERE to_jsonb(p)->>'first_name' IS NULL AND to_jsonb(p)->>'last_name' IS NULL)),
  'B9_defaults', jsonb_build_object(
    'role_grains', (SELECT count(*) FROM role_defaults),
    'missing_default_grains', (SELECT count(*) FROM role_defaults WHERE defaults=0),
    'multiple_default_grains', (SELECT count(*) FROM role_defaults WHERE defaults>1),
    'unknown_scope_type', (SELECT count(*) FROM public.party_role_assignments WHERE scope_type IS NULL OR scope_type NOT IN ('org','group','facility','case')),
    'reserved_roles_to_activate', (SELECT count(*) FROM public.party_role_types WHERE role_key IN ('billing_contact','contracting_signer','credentialing_contact') AND is_active IS NOT TRUE)),
  'B10_insurance', jsonb_build_object(
    'rows', (SELECT count(*) FROM public.group_insurance_policies),
    'multiple_policy_grains', (SELECT count(*) FROM insurance_grains WHERE policies>1),
    'conflicting_proposed_primary_grains', (SELECT count(*) FROM insurance_grains WHERE proposed_primaries>1),
    'unknown_coverage_level', (SELECT count(*) FROM public.group_insurance_policies i WHERE to_jsonb(i)->>'coverage_level' IS NOT NULL AND to_jsonb(i)->>'coverage_level' NOT IN ('primary','secondary'))),
  'B11_registry', jsonb_build_object(
    'rows', (SELECT count(*) FROM public.portal_field_maps),
    'shared_duplicate_groups', (SELECT count(*) FROM (SELECT portal_key,selector FROM public.portal_field_maps WHERE org_id IS NULL GROUP BY portal_key,selector HAVING count(*)>1) x),
    'org_duplicate_groups', (SELECT count(*) FROM (SELECT org_id,portal_key,selector FROM public.portal_field_maps WHERE org_id IS NOT NULL GROUP BY org_id,portal_key,selector HAVING count(*)>1) x),
    'missing_sort_order', (SELECT count(*) FROM public.portal_field_maps m WHERE to_jsonb(m)->>'sort_order' IS NULL),
    'global_portal_duplicate_keys', (SELECT count(*) FROM (SELECT portal_key FROM public.portals WHERE org_id IS NULL GROUP BY portal_key HAVING count(*)>1) x)),
  'B12_sop_states', jsonb_build_object(
    'rows', (SELECT count(*) FROM template_rows),
    'backfill_eligible', (SELECT count(*) FROM template_rows WHERE j->>'states' IS NULL AND state IS NOT NULL),
    'null_fallback_preserve', (SELECT count(*) FROM template_rows WHERE proposed_states IS NULL),
    'invalid_proposed_shape', (SELECT count(*) FROM template_rows WHERE proposed_states IS NOT NULL AND (COALESCE(cardinality(proposed_states),0)=0 OR array_position(proposed_states,NULL::text) IS NOT NULL OR NOT (proposed_states=ARRAY['All']::text[] OR array_to_string(proposed_states,',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'))),
    'active_overlap_pairs', (SELECT count(*) FROM template_rows a JOIN template_rows b ON a.id<b.id AND a.org_id IS NOT DISTINCT FROM b.org_id AND a.payer_id=b.payer_id AND a.group_id IS NOT DISTINCT FROM b.group_id WHERE NOT a.archived AND NOT b.archived AND a.payer_id IS NOT NULL AND a.proposed_states && b.proposed_states)),
  'B13_datafields', jsonb_build_object(
    'affected_templates', (SELECT count(*) FROM affected_templates),
    'affected_org_templates', (SELECT count(*) FROM affected_templates WHERE org_id IS NOT NULL),
    'fields_with_portal', (SELECT count(*) FROM step_fields WHERE nullif(portal_key,'') IS NOT NULL),
    'org_fields_would_become_shared', (SELECT count(*) FROM step_fields WHERE org_id IS NOT NULL AND nullif(portal_key,'') IS NOT NULL),
    'fields_without_portal', (SELECT count(*) FROM step_fields WHERE nullif(portal_key,'') IS NULL),
    'new_snapshots_needed', (SELECT count(*) FROM affected_templates a WHERE NOT EXISTS (SELECT 1 FROM public.sop_template_versions v WHERE v.template_id=a.template_id AND v.change_note='Snapshot before the E6.9 data-fields migration')),
    'next_version_already_occupied', (SELECT count(*) FROM affected_templates a WHERE NOT EXISTS (SELECT 1 FROM public.sop_template_versions v WHERE v.template_id=a.template_id AND v.change_note='Snapshot before the E6.9 data-fields migration') AND EXISTS (SELECT 1 FROM public.sop_template_versions v WHERE v.template_id=a.template_id AND v.version=a.current_version+1)),
    'snapshot_marker_duplicates', (SELECT count(*) FROM (SELECT template_id FROM public.sop_template_versions WHERE change_note='Snapshot before the E6.9 data-fields migration' GROUP BY template_id HAVING count(*)>1) x),
    'candidate_selector_duplicate_groups', (SELECT count(*) FROM (SELECT portal_key,selector FROM step_fields WHERE nullif(portal_key,'') IS NOT NULL GROUP BY portal_key,selector HAVING count(*)>1) x),
    'existing_shared_selector_matches', (SELECT count(*) FROM step_fields f JOIN public.portal_field_maps m ON m.org_id IS NULL AND m.portal_key=f.portal_key AND m.selector=f.selector WHERE nullif(f.portal_key,'') IS NOT NULL),
    'existing_shared_selector_label_conflicts', (SELECT count(*) FROM step_fields f JOIN public.portal_field_maps m ON m.org_id IS NULL AND m.portal_key=f.portal_key AND m.selector=f.selector WHERE nullif(f.portal_key,'') IS NOT NULL AND m.field_label IS DISTINCT FROM f.field_label)),
  'B14_environment', jsonb_build_object(
    'required_table_presence', (SELECT jsonb_object_agg(name,present) FROM missing_tables),
    'public_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
    'public_columns', (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'),
    'organizations', (SELECT count(*) FROM public.organizations),
    'auth_users', (SELECT count(*) FROM auth.users),
    'memberships', (SELECT count(*) FROM public.memberships),
    'storage_buckets', (SELECT count(*) FROM storage.buckets),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'pgcrypto_in_extensions', EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto' AND n.nspname='extensions'),
    'vault_relation_present', to_regclass('vault.secrets') IS NOT NULL,
    'profile_split_columns_present', (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('first_name','last_name','title'))),
  'preservation', jsonb_build_object(
    'function_definitions', (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.name,f.args) FROM function_preservation f),
    'rowsets', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.object_name) FROM preservation_rows p),
    'old_created_case_check_present', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.case_generation_run_rows'::regclass AND conname='case_generation_run_rows_created_case_check'),
    'insert_only_validator_present', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.case_generation_run_rows'::regclass AND tgname='trg_case_generation_run_rows_created_case_check' AND NOT tgisinternal AND tgtype=7 AND tgenabled='O'),
    'case_fk_set_null', EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid='public.case_generation_run_rows'::regclass AND k.confrelid='public.credential_cases'::regclass AND k.contype='f' AND k.confdeltype='n'),
    'invalid_import_kinds_for_target', (SELECT count(*) FROM public.import_runs WHERE entity_kind IS NULL OR entity_kind NOT IN ('provider_group','facility','provider','combined','payer_attach')),
    'invalid_generation_dispositions_for_target', (SELECT count(*) FROM public.case_generation_run_rows WHERE disposition IS NULL OR disposition NOT IN ('created','skipped_existing','excluded','failed','skipped','enrolled')),
    'missing_required_generation_reasons', (SELECT count(*) FROM public.case_generation_run_rows WHERE disposition IN ('excluded','failed','skipped','enrolled') AND reason IS NULL))
) AS preflight
FROM identity_guard g
WHERE g.ok=1;

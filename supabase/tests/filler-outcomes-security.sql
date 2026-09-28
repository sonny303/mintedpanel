-- Runs only in verify-filler-outcomes.mjs's newly owned network-none DB.
CREATE TEMP TABLE filler_outcome_results (name text PRIMARY KEY, passed boolean NOT NULL);
GRANT ALL ON filler_outcome_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.filler_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO filler_outcome_results VALUES (p_name, p_passed) $$;

CREATE FUNCTION pg_temp.filler_expect_state(p_state text, p_statement text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  BEGIN
    EXECUTE p_statement;
    RETURN p_state = '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RETURN v_state = p_state;
  END;
END;
$$;

CREATE FUNCTION pg_temp.filler_expect_no_rows(p_statement text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE v_rows bigint;
BEGIN
  EXECUTE p_statement;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 0;
END;
$$;

CREATE FUNCTION pg_temp.filler_valid_outcomes() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT '[
    {"mapId":"60000000-0000-4000-8000-000000000001","targetKey":"t_70000000-0000-4000-8000-000000000001","frameKey":"f_80000000-0000-4000-8000-000000000001","stepKey":"s_90000000-0000-4000-8000-000000000001","attempted":true,"outcome":"verified","reasonCode":null},
    {"mapId":"60000000-0000-4000-8000-000000000001","targetKey":"t_70000000-0000-4000-8000-000000000002","frameKey":"f_80000000-0000-4000-8000-000000000002","stepKey":"s_90000000-0000-4000-8000-000000000002","attempted":true,"outcome":"write_rejected","reasonCode":"readback_mismatch"},
    {"mapId":"60000000-0000-4000-8000-000000000001","targetKey":"t_70000000-0000-4000-8000-000000000003","frameKey":"f_80000000-0000-4000-8000-000000000003","stepKey":"s_90000000-0000-4000-8000-000000000003","attempted":false,"outcome":"unchanged","reasonCode":"unchanged_value"},
    {"mapId":"60000000-0000-4000-8000-000000000001","targetKey":"t_70000000-0000-4000-8000-000000000004","frameKey":"f_80000000-0000-4000-8000-000000000004","stepKey":"s_90000000-0000-4000-8000-000000000004","attempted":false,"outcome":"not_found","reasonCode":"target_missing","notFoundEvidence":{"stepKnown":true,"frameAccessible":true,"pageSettled":true,"searchComplete":true,"targetAbsent":true}}
  ]'::jsonb
$$;

CREATE FUNCTION pg_temp.filler_valid_skipped() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT '[
    {"label":"","reason":"readback_mismatch","kind":"write_rejected","mapId":"60000000-0000-4000-8000-000000000001"},
    {"label":"","reason":"target_missing","kind":"not_found","mapId":"60000000-0000-4000-8000-000000000001"}
  ]'::jsonb
$$;

CREATE FUNCTION pg_temp.filler_insert(
  p_id uuid,
  p_org_id uuid,
  p_case_id uuid,
  p_provider_id uuid,
  p_portal_key text,
  p_fill_mode text,
  p_event_schema_version integer,
  p_fields_attempted integer,
  p_fields_verified integer,
  p_fields_rejected integer,
  p_fields_filled integer,
  p_field_outcomes jsonb,
  p_fields_skipped jsonb,
  p_docs_attached jsonb,
  p_is_test boolean,
  p_performed_by uuid
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fill_sessions (
    id, org_id, case_id, provider_id, portal_key, fill_mode,
    event_schema_version, fields_attempted, fields_verified, fields_rejected,
    fields_filled, field_outcomes, fields_skipped, docs_attached, is_test, performed_by
  ) VALUES (
    p_id, p_org_id, p_case_id, p_provider_id, p_portal_key, p_fill_mode,
    p_event_schema_version::smallint, p_fields_attempted, p_fields_verified, p_fields_rejected,
    p_fields_filled, p_field_outcomes, p_fields_skipped, p_docs_attached, p_is_test, p_performed_by
  );
END;
$$;

-- Synthetic, unrelated tenants and two writer actors.
INSERT INTO auth.users(id, email) VALUES
  ('20000000-0000-4000-8000-000000000001', 'filler-a@example.invalid'),
  ('20000000-0000-4000-8000-000000000002', 'filler-b@example.invalid'),
  ('20000000-0000-4000-8000-000000000003', 'filler-admin-a@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Synthetic Filler A', 'filler-a@example.invalid'),
  ('20000000-0000-4000-8000-000000000002', 'Synthetic Filler B', 'filler-b@example.invalid'),
  ('20000000-0000-4000-8000-000000000003', 'Synthetic Filler Admin A', 'filler-admin-a@example.invalid');
INSERT INTO public.organizations(id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Filler Org A'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Filler Org B');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'specialist'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'specialist'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'admin');
INSERT INTO public.payers(id, org_id, name) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic Payer A'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Synthetic Payer B');
INSERT INTO public.providers(id, org_id, first_name, last_name) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic', 'Provider A'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Synthetic', 'Provider A2'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Synthetic', 'Provider B');
INSERT INTO public.credential_cases(id, org_id, provider_id, payer_id, state) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'NC'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'SC'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'VA'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'GA'),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'TN'),
  ('40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'KY'),
  ('40000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'WV'),
  ('40000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'AL'),
  ('40000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', 'NC');

INSERT INTO public.portal_field_maps(id, org_id, portal_key, map_type, selector, source, field_type, notes, status) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 'synthetic-pdf-selector', 'manual', 'text', 'Synthetic security fixture', 'approved'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'web', 'synthetic-web-selector', 'manual', 'text', 'Synthetic security fixture', 'approved'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'payer-form:synthetic-family', 'pdf', 'synthetic-foreign-selector', 'manual', 'text', 'Synthetic security fixture', 'approved');

-- Legacy rows retain NULL and explicit version 1 semantics. Both PDF rows still
-- advance the case, matching the existing transition behavior.
SET ROLE authenticated;
SET request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.filler_insert(
  '41000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'payer-form:synthetic-family', 'pdf', NULL, NULL, NULL, NULL, 0, NULL,
  '[{"selector":"legacy-selector","label":"legacy label","reason":"legacy"}]', NULL, false,
  '20000000-0000-4000-8000-000000000001'
);
SELECT pg_temp.filler_insert(
  '41000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
  'payer-form:synthetic-family', 'pdf', 1, NULL, NULL, NULL, 0, NULL,
  '[]', NULL, false, '20000000-0000-4000-8000-000000000001'
);
SELECT pg_temp.filler_mark('legacy_null_schema_pdf_transition', (
  (SELECT case_status = 'in_progress' FROM public.credential_cases WHERE id = '40000000-0000-4000-8000-000000000001')
  AND (SELECT event_schema_version IS NULL AND field_outcomes IS NULL FROM public.fill_sessions WHERE id = '41000000-0000-4000-8000-000000000001')
));
SELECT pg_temp.filler_mark('legacy_v1_pdf_transition', (
  (SELECT case_status = 'in_progress' FROM public.credential_cases WHERE id = '40000000-0000-4000-8000-000000000002')
  AND (SELECT event_schema_version = 1 AND field_outcomes IS NULL FROM public.fill_sessions WHERE id = '41000000-0000-4000-8000-000000000002')
));

-- V2 PDF is audited but does not advance the case. Actor identity is derived
-- from auth.uid() when the authenticated caller omits performed_by.
SELECT pg_temp.filler_insert(
  '41000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001',
  'payer-form:synthetic-family', 'pdf', 2, 2, 1, 1, 1,
  pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false, NULL
);
SELECT pg_temp.filler_mark('v2_pdf_skips_case_transition',
  (SELECT case_status = 'not_started' FROM public.credential_cases WHERE id = '40000000-0000-4000-8000-000000000003'));
SELECT pg_temp.filler_mark('v2_actor_and_one_atomic_summary_audit',
  (SELECT performed_by = '20000000-0000-4000-8000-000000000001'
   FROM public.fill_sessions WHERE id = '41000000-0000-4000-8000-000000000003')
  AND (SELECT count(*) = 1 FROM public.audit_log
       WHERE entity_type = 'fill_session' AND entity_id = '41000000-0000-4000-8000-000000000003')
  AND (SELECT NOT (after ? 'field_outcomes') AND after->>'fields_rejected' = '1'
       FROM public.audit_log WHERE entity_type = 'fill_session' AND entity_id = '41000000-0000-4000-8000-000000000003')
);
SELECT pg_temp.filler_mark('v2_skipped_projection_is_exact',
  (SELECT fields_skipped = pg_temp.filler_valid_skipped() AND docs_attached IS NULL
   FROM public.fill_sessions WHERE id = '41000000-0000-4000-8000-000000000003'));

-- V2 web retains the existing case transition behavior.
SELECT pg_temp.filler_insert(
  '41000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001',
  'payer-form:synthetic-family', 'web', 2, 1, 1, 0, 1,
  jsonb_build_array(jsonb_set(pg_temp.filler_valid_outcomes()->0, '{mapId}', '"60000000-0000-4000-8000-000000000002"')),
  '[]', NULL, false, NULL
);
SELECT pg_temp.filler_mark('v2_web_keeps_case_transition',
  (SELECT case_status = 'in_progress' FROM public.credential_cases WHERE id = '40000000-0000-4000-8000-000000000004'));

-- Null-case/provider in-app test fills remain accepted for legacy and V2 rows.
SELECT pg_temp.filler_insert(
  '41000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
  NULL, NULL, 'payer-form:synthetic-family', 'web', 1, NULL, NULL, NULL, 0, NULL,
  '[]', NULL, true, '20000000-0000-4000-8000-000000000001'
);
SELECT pg_temp.filler_insert(
  '41000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001',
  NULL, NULL, 'payer-form:synthetic-family', 'web', 2, 0, 0, 0, 0,
  '[{"mapId":null,"targetKey":"t_70000000-0000-4000-8000-000000000006","frameKey":null,"stepKey":null,"attempted":false,"outcome":"needs_mapping","reasonCode":"mapping_required"}]',
  '[{"label":"","reason":"mapping_required","kind":"needs_mapping","mapId":null}]', NULL, true, NULL
);
SELECT pg_temp.filler_mark('null_case_provider_test_fills_preserved',
  (SELECT count(*) = 2 FROM public.fill_sessions
   WHERE id IN ('41000000-0000-4000-8000-000000000005', '41000000-0000-4000-8000-000000000006')
     AND case_id IS NULL AND provider_id IS NULL AND is_test));

-- Unknown schema values, malformed outcome details, unsafe payload channels,
-- duplicate identities, and inconsistent counters fail closed.
SELECT pg_temp.filler_mark('unknown_schema_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 3,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('v1_cannot_carry_v2_result_columns', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 1,
    0, 0, 0, 0, '[]', '[]', NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('extra_outcome_key_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, jsonb_set(pg_temp.filler_valid_outcomes(), '{0,label}', '"Synthetic label"', true),
    pg_temp.filler_valid_skipped(), NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('raw_target_key_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, jsonb_set(pg_temp.filler_valid_outcomes(), '{0,targetKey}', '"input[name=ssn]"'),
    pg_temp.filler_valid_skipped(), NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('illegal_reason_pair_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, jsonb_set(pg_temp.filler_valid_outcomes(), '{0,reasonCode}', '"invalid_format"'),
    pg_temp.filler_valid_skipped(), NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('false_not_found_evidence_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, jsonb_set(pg_temp.filler_valid_outcomes(), '{3,notFoundEvidence,targetAbsent}', 'false'),
    pg_temp.filler_valid_skipped(), NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('duplicate_outcome_identity_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 2, 0, 2, jsonb_build_array(pg_temp.filler_valid_outcomes()->0, pg_temp.filler_valid_outcomes()->0),
    '[]', NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('counter_mismatch_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2, 1, 1, 0, 1,
    pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('rejected_counter_counts_write_rejected_only', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 0, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('unsafe_skipped_projection_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(),
    jsonb_set(pg_temp.filler_valid_skipped(), '{0,label}', '"Synthetic label"'), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('docs_attached_rejected_for_v2', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), '[]', false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('outcome_limit_251_rejected', pg_temp.filler_expect_state('22023', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    0, 0, 0, 0, (SELECT jsonb_agg(pg_temp.filler_valid_outcomes()->0) FROM generate_series(1,251)),
    '[]', NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('authenticated_actor_cannot_be_forged', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000019',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000002')
$$));
SELECT pg_temp.filler_mark('authenticated_cross_org_provider_rejected', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000020',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000003', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('authenticated_cross_org_case_rejected', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('authenticated_case_provider_mismatch_rejected', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000002', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('authenticated_real_fill_requires_case', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000023',
    '10000000-0000-4000-8000-000000000001', NULL,
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));

-- A map id from another organization cannot be smuggled into this event.
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'service_role';
SET request.jwt.claims = '{"role":"service_role"}';
SELECT pg_temp.filler_mark('foreign_map_rejected', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1,
    jsonb_set(pg_temp.filler_valid_outcomes(), '{0,mapId}', '"60000000-0000-4000-8000-000000000003"'),
    pg_temp.filler_valid_skipped(), NULL, false, '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('service_role_valid_actor_insert_allowed', pg_temp.filler_expect_state('00000', $$
  SELECT pg_temp.filler_insert('41000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('service_role_rejects_nonmember_actor', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000002')
$$));
SELECT pg_temp.filler_mark('service_role_rejects_cross_org_case_provider', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000015',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000003', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('service_role_cannot_forge_org_for_an_actor', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000024',
    '10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000009',
    '30000000-0000-4000-8000-000000000003', 'payer-form:synthetic-family', 'web', 2,
    0, 0, 0, 0,
    '[{"mapId":null,"targetKey":"t_70000000-0000-4000-8000-000000000024","frameKey":null,"stepKey":null,"attempted":false,"outcome":"needs_mapping","reasonCode":"mapping_required"}]',
    '[{"label":"","reason":"mapping_required","kind":"needs_mapping","mapId":null}]', NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('service_role_rejects_case_provider_mismatch', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000016',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000002', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('service_role_rejects_real_fill_without_case', pg_temp.filler_expect_state('42501', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000017',
    '10000000-0000-4000-8000-000000000001', NULL,
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));

-- Service-role update/delete must hit the row guard. TRUNCATE is revoked from
-- API roles because it bypasses row-level checks entirely.
SELECT pg_temp.filler_mark('service_role_v2_update_rejected', pg_temp.filler_expect_state('42501', $$
  UPDATE public.fill_sessions SET fields_filled = 0 WHERE id = '41000000-0000-4000-8000-000000000003'
$$));
SELECT pg_temp.filler_mark('service_role_v2_delete_rejected', pg_temp.filler_expect_state('42501', $$
  DELETE FROM public.fill_sessions WHERE id = '41000000-0000-4000-8000-000000000003'
$$));
SELECT pg_temp.filler_mark('service_role_cannot_add_v2_columns_to_legacy_null_row', pg_temp.filler_expect_state('23514', $$
  UPDATE public.fill_sessions
  SET fields_attempted = 0, fields_verified = 0, fields_rejected = 0, field_outcomes = '[]'::jsonb
  WHERE id = '41000000-0000-4000-8000-000000000001'
$$));
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.filler_mark('authenticated_v2_update_has_no_rows', pg_temp.filler_expect_no_rows($$
  UPDATE public.fill_sessions SET fields_filled = 0 WHERE id = '41000000-0000-4000-8000-000000000003'
$$));
SELECT pg_temp.filler_mark('authenticated_v2_delete_has_no_rows', pg_temp.filler_expect_no_rows($$
  DELETE FROM public.fill_sessions WHERE id = '41000000-0000-4000-8000-000000000003'
$$));
SELECT pg_temp.filler_mark('api_roles_cannot_truncate_fill_history',
  NOT has_table_privilege('authenticated', 'public.fill_sessions', 'TRUNCATE')
  AND NOT has_table_privilege('anon', 'public.fill_sessions', 'TRUNCATE')
  AND NOT has_table_privilege('service_role', 'public.fill_sessions', 'TRUNCATE'));
SELECT pg_temp.filler_mark('legacy_null_and_v1_rows_remain_unchanged',
  (SELECT count(*) = 2 FROM public.fill_sessions
   WHERE id IN ('41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002')
     AND fields_attempted IS NULL AND fields_verified IS NULL AND fields_rejected IS NULL AND field_outcomes IS NULL));
SELECT pg_temp.filler_mark('same_id_retry_is_not_upserted', pg_temp.filler_expect_state('23505', $$
  SELECT pg_temp.filler_insert('41000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    0, 0, 0, 0, '[]', '[]', NULL, false, '20000000-0000-4000-8000-000000000001')
$$));

-- Audit failure rolls the fill event back with its transaction.
RESET ROLE;
CREATE FUNCTION pg_temp.filler_fail_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type = 'fill_session' THEN
    RAISE EXCEPTION USING ERRCODE = '22000', MESSAGE = 'synthetic audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER filler_outcome_test_audit_failure
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION pg_temp.filler_fail_audit();
SET ROLE authenticated;
SET request.jwt.claim.sub = '20000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT pg_temp.filler_mark('audit_failure_rejected', pg_temp.filler_expect_state('22000', $$
  SELECT pg_temp.filler_insert('42000000-0000-4000-8000-000000000018',
    '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000008',
    '30000000-0000-4000-8000-000000000001', 'payer-form:synthetic-family', 'pdf', 2,
    2, 1, 1, 1, pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false,
    '20000000-0000-4000-8000-000000000001')
$$));
SELECT pg_temp.filler_mark('audit_failure_rolls_event_back',
  NOT EXISTS (SELECT 1 FROM public.fill_sessions WHERE id = '42000000-0000-4000-8000-000000000018')
  AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'fill_session' AND entity_id = '42000000-0000-4000-8000-000000000018'));
RESET ROLE;
DROP TRIGGER filler_outcome_test_audit_failure ON public.audit_log;

-- The existing admin-only delete_case RPC remains the controlled cascade
-- exception for an immutable event ledger row.
SET ROLE authenticated;
SET request.jwt.claim.sub = '20000000-0000-4000-8000-000000000003';
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT pg_temp.filler_insert(
  '41000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000001',
  'payer-form:synthetic-family', 'pdf', 2, 2, 1, 1, 1,
  pg_temp.filler_valid_outcomes(), pg_temp.filler_valid_skipped(), NULL, false, NULL
);
SELECT public.delete_case('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000008');
SELECT pg_temp.filler_mark('admin_delete_case_cascade_remains_available',
  NOT EXISTS (SELECT 1 FROM public.credential_cases WHERE id = '40000000-0000-4000-8000-000000000008')
  AND NOT EXISTS (SELECT 1 FROM public.fill_sessions WHERE id = '41000000-0000-4000-8000-000000000008')
  AND EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'fill_session' AND entity_id = '41000000-0000-4000-8000-000000000008'));
RESET ROLE;

SELECT 'FILLER|PASS|' || name FROM filler_outcome_results WHERE passed ORDER BY name;
SELECT 'FILLER|FAIL|' || name FROM filler_outcome_results WHERE NOT passed ORDER BY name;
SELECT 'FILLER|COUNT|' || count(*)::text FROM filler_outcome_results;

-- Prove the historical authenticated UPDATE grant did not bypass RLS before
-- MINT-8 removed the unused grant. Run only in the verifier's disposable DB.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
SET LOCAL client_min_messages = warning;

INSERT INTO public.organizations (id, name)
VALUES ('50000000-0000-4000-8000-000000000001', 'MINT-8 pre-migration org');
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('60000000-0000-4000-8000-000000000001', 'mint8-pre-migration@example.test', '{}'::jsonb),
  ('60000000-0000-4000-8000-000000000002', 'mint8-forged-actor@example.test', '{}'::jsonb);
INSERT INTO public.profiles (id, full_name, email)
VALUES
  ('60000000-0000-4000-8000-000000000001', 'MINT-8 pre-migration actor', 'mint8-pre-migration@example.test'),
  ('60000000-0000-4000-8000-000000000002', 'MINT-8 forged actor', 'mint8-forged-actor@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.memberships (org_id, user_id, role)
VALUES (
  '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'specialist'
);
INSERT INTO public.audit_log (
  id, org_id, user_id, user_name, action_type, entity_type, description
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'MINT-8 pre-migration actor', 'CREATE', 'mint8_pre_migration', 'original'
);

DO $$
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '60000000-0000-4000-8000-000000000001',
    true
  );
END;
$$;
SET LOCAL ROLE authenticated;
INSERT INTO public.audit_log (
  id, org_id, user_id, user_name, action_type, entity_type, ts, created_at, description
) VALUES (
  '70000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  'Forged pre-migration name', 'CREATE', 'mint8_pre_migration_spoof',
  '2001-01-01 00:00:00+00', '2001-01-01 00:00:00+00', 'forged before MINT-8'
);
DO $$
DECLARE
  v_updated bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
     WHERE id = '70000000-0000-4000-8000-000000000002'
       AND user_id = '60000000-0000-4000-8000-000000000002'
       AND user_name = 'Forged pre-migration name'
       AND ts = '2001-01-01 00:00:00+00'::timestamptz
       AND created_at = '2001-01-01 00:00:00+00'::timestamptz
  ) THEN
    RAISE EXCEPTION 'MINT8_BASELINE_ACTOR_TIME_SPOOF_NOT_REPRODUCED';
  END IF;
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.audit_log', 'UPDATE') THEN
    RAISE EXCEPTION 'MINT8_BASELINE_UPDATE_GRANT_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename = 'audit_log' AND cmd IN ('ALL', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'MINT8_BASELINE_UNEXPECTED_UPDATE_POLICY';
  END IF;

  UPDATE public.audit_log SET description = 'tampered'
   WHERE id = '70000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'MINT8_BASELINE_RLS_UPDATE_BYPASS';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
     WHERE id = '70000000-0000-4000-8000-000000000001'
       AND description = 'original'
  ) THEN
    RAISE EXCEPTION 'MINT8_BASELINE_AUDIT_ROW_CHANGED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
     WHERE id = '70000000-0000-4000-8000-000000000002'
       AND user_id = '60000000-0000-4000-8000-000000000002'
       AND user_name = 'Forged pre-migration name'
       AND ts = '2001-01-01 00:00:00+00'::timestamptz
       AND created_at = '2001-01-01 00:00:00+00'::timestamptz
  ) THEN
    RAISE EXCEPTION 'MINT8_BASELINE_SPOOF_ROW_NOT_PERSISTED';
  END IF;
END;
$$;

SELECT 'MINT8|baseline.browser_actor_time_spoof_reproduced|PASS'
UNION ALL
SELECT 'MINT8|baseline.authenticated_update_grant_still_rls_denied|PASS'
ORDER BY 1;
ROLLBACK;

-- MINT-19 authorization, idempotency, termination, and rollback checks.
-- Run only after the disposable migration runner has applied the full schema.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE mint19_results (
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  label text UNIQUE,
  passed boolean NOT NULL
);

CREATE FUNCTION pg_temp.mint19_assert(p_label text, p_passed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $function$
BEGIN
  INSERT INTO mint19_results (label, passed) VALUES (p_label, COALESCE(p_passed, false));
END;
$function$;

CREATE FUNCTION pg_temp.mint19_try_audit_failure(
  p_org_id uuid,
  p_task_id uuid,
  p_actor_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_temp
AS $function$
DECLARE
  v_state text;
  v_message text;
BEGIN
  PERFORM public.complete_sop_task_step(
    p_org_id, p_task_id, 'only-step', p_actor_id, 'panel'
  );
  RETURN 'unexpected_success';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  RETURN v_state || '|' || v_message;
END;
$function$;

-- These identities are synthetic and are removed by the final ROLLBACK.
INSERT INTO public.organizations (id, name) VALUES
  ('19000000-0000-4000-8000-000000000001', 'MINT-19 org A'),
  ('19000000-0000-4000-8000-000000000002', 'MINT-19 org B');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('29000000-0000-4000-8000-000000000001', 'm19-a1@example.test', '{}'::jsonb),
  ('29000000-0000-4000-8000-000000000002', 'm19-a2@example.test', '{}'::jsonb),
  ('29000000-0000-4000-8000-000000000003', 'm19-billing@example.test', '{}'::jsonb),
  ('29000000-0000-4000-8000-000000000004', 'm19-b1@example.test', '{}'::jsonb);

INSERT INTO public.profiles (id, full_name, email) VALUES
  ('29000000-0000-4000-8000-000000000001', 'MINT-19 Specialist A1', 'm19-a1@example.test'),
  ('29000000-0000-4000-8000-000000000002', 'MINT-19 Specialist A2', 'm19-a2@example.test'),
  ('29000000-0000-4000-8000-000000000003', 'MINT-19 Billing', 'm19-billing@example.test'),
  ('29000000-0000-4000-8000-000000000004', 'MINT-19 Specialist B1', 'm19-b1@example.test');

INSERT INTO public.memberships (org_id, user_id, role) VALUES
  ('19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000001', 'specialist'),
  ('19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000002', 'admin'),
  ('19000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-000000000003', 'billing'),
  ('19000000-0000-4000-8000-000000000002', '29000000-0000-4000-8000-000000000004', 'specialist');

INSERT INTO public.providers (id, org_id, first_name, last_name) VALUES
  ('39000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'M19', 'Provider A1'),
  ('39000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000001', 'M19', 'Provider A2'),
  ('39000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000002', 'M19', 'Provider B1');

INSERT INTO public.payers (id, org_id, name) VALUES
  ('49000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'MINT-19 Payer A1'),
  ('49000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000001', 'MINT-19 Payer A2'),
  ('49000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000002', 'MINT-19 Payer B1');

INSERT INTO public.credential_cases (id, org_id, provider_id, payer_id, state) VALUES
  ('59000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000001', 'CO'),
  ('59000000-0000-4000-8000-000000000002', '19000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000002', '49000000-0000-4000-8000-000000000002', 'CO'),
  ('59000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000002', '39000000-0000-4000-8000-000000000003', '49000000-0000-4000-8000-000000000003', 'KS');

INSERT INTO public.tasks (id, org_id, case_id, title, status, sop_content) VALUES
  (
    '69000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000001',
    'Submit termination paperwork',
    'not_started',
    '[{"id":"first","order":1,"label":"Prepare termination","isCompleted":false},{"id":"last","order":2,"label":"Submit termination","isCompleted":false}]'::jsonb
  ),
  (
    '69000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000003',
    'Corrupt cross-org case reference',
    'not_started',
    '[{"id":"only-step","order":1,"label":"Only step","isCompleted":false}]'::jsonb
  ),
  (
    '69000000-0000-4000-8000-000000000003',
    '19000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000002',
    'Submit termination paperwork',
    'not_started',
    '[{"id":"only-step","order":1,"label":"Only step","isCompleted":false}]'::jsonb
  ),
  (
    '69000000-0000-4000-8000-000000000004',
    '19000000-0000-4000-8000-000000000001',
    '59000000-0000-4000-8000-000000000001',
    'MINT-19 stale SOP writer race',
    'not_started',
    '[{"id":"only-step","order":1,"label":"Only step","isCompleted":false}]'::jsonb
  );

CREATE TEMP TABLE mint19_stale_sop_snapshot ON COMMIT DROP AS
SELECT id, org_id, sop_content_revision, sop_content
  FROM public.tasks
 WHERE id = '69000000-0000-4000-8000-000000000004';

SELECT pg_temp.mint19_assert(
  'anonymous cannot execute completion RPC',
  NOT pg_catalog.has_function_privilege(
    'anon',
    'public.complete_sop_task_step(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  )
);

SET LOCAL request.jwt.claim.sub = '29000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.mint19_assert(
  'source is constrained',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000001',
    'other'
  ) ->> 'status')::integer = 422
);
SELECT pg_temp.mint19_assert(
  'authenticated actor cannot be forged',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000002',
    'panel'
  ) ->> 'status')::integer = 403
);
SELECT pg_temp.mint19_assert(
  'wrong organization is hidden',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000002',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000001',
    'panel'
  ) ->> 'status')::integer = 404
);
SELECT pg_temp.mint19_assert(
  'cross-org task case reference is rejected',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000002',
    'only-step',
    '29000000-0000-4000-8000-000000000001',
    'panel'
  ) ->> 'status')::integer = 409
);
RESET ROLE;

SET LOCAL request.jwt.claim.sub = '29000000-0000-4000-8000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.mint19_assert(
  'org B authenticated user cannot access org A task',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000004',
    'panel'
  ) ->> 'status')::integer = 404
);
RESET ROLE;

SET LOCAL request.jwt.claim.sub = '29000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_temp.mint19_assert(
  'billing membership cannot complete task steps',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000003',
    'panel'
  ) ->> 'status')::integer = 403
);
RESET ROLE;

SET LOCAL request.jwt.claim.sub = '29000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.mint19_assert(
  'out-of-order step returns conflict',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'last',
    '29000000-0000-4000-8000-000000000001',
    'panel'
  ) ->> 'status')::integer = 409
);
SELECT pg_temp.mint19_assert(
  'first step completes through authenticated role',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000001',
    'panel'
  ) ->> 'kind') = 'ok'
);
SELECT pg_temp.mint19_assert(
  'single-step task completes through authenticated role',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000004',
    'only-step',
    '29000000-0000-4000-8000-000000000001',
    'panel'
  ) ->> 'kind') = 'ok'
);
RESET ROLE;
SELECT pg_temp.mint19_assert(
  'RPC step completion advances the SOP content revision',
  (SELECT t.sop_content_revision = s.sop_content_revision + 1
     FROM public.tasks AS t
     JOIN mint19_stale_sop_snapshot AS s ON s.id = t.id)
);

-- Model attach/detach/remove's stale full-array payload with the revision the
-- service read before the completion RPC. Its CAS update must affect no row.
DO $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.tasks AS t
     SET sop_content = pg_catalog.jsonb_set(
       s.sop_content,
       '{0,attachments}',
       '[{"documentId":"stale-write"}]'::jsonb,
       true
     )
    FROM mint19_stale_sop_snapshot AS s
   WHERE t.id = s.id
     AND t.org_id = s.org_id
     AND t.sop_content_revision = s.sop_content_revision;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  PERFORM pg_temp.mint19_assert('stale full-array SOP write is rejected', v_updated = 0);

  WITH current_task AS (
    SELECT id, org_id, sop_content_revision, sop_content
      FROM public.tasks
     WHERE id = '69000000-0000-4000-8000-000000000004'
  )
  UPDATE public.tasks AS t
     SET sop_content = pg_catalog.jsonb_set(
       current_task.sop_content,
       '{0,attachments}',
       '[{"documentId":"retry-write"}]'::jsonb,
       true
     )
    FROM current_task
   WHERE t.id = current_task.id
     AND t.org_id = current_task.org_id
     AND t.sop_content_revision = current_task.sop_content_revision;

  PERFORM pg_temp.mint19_assert(
    'successful stale-writer retry preserves completion and its attachment',
    (SELECT t.sop_content_revision = s.sop_content_revision + 2
            AND t.sop_content -> 0 ->> 'isCompleted' = 'true'
            AND t.sop_content -> 0 -> 'attachments' -> 0 ->> 'documentId' = 'retry-write'
       FROM public.tasks AS t
       JOIN mint19_stale_sop_snapshot AS s ON s.id = t.id)
  );
END;
$function$;

-- CI creates a minimally privileged service_role. Emulate the real Supabase
-- BYPASSRLS attribute only inside this rollback-only verification transaction.
ALTER ROLE service_role BYPASSRLS;
SET LOCAL request.jwt.claim.sub = '29000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT pg_temp.mint19_assert(
  'service role retry is idempotent and does not add audit',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000002',
    'extension'
  ) ->> 'kind') = 'ok'
  AND (SELECT count(*) = 1 FROM public.audit_log
        WHERE org_id = '19000000-0000-4000-8000-000000000001'
          AND entity_id = '69000000-0000-4000-8000-000000000001')
);
SELECT pg_temp.mint19_assert(
  'second step reports all done',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'last',
    '29000000-0000-4000-8000-000000000002',
    'extension'
  ) ->> 'allDone')::boolean
);
SELECT pg_temp.mint19_assert(
  'final task is completed with a completion date',
  (SELECT t.status = 'completed' AND t.completed_date IS NOT NULL
     FROM public.tasks AS t
    WHERE t.id = '69000000-0000-4000-8000-000000000001')
);
SELECT pg_temp.mint19_assert(
  'termination date is set on the same-org case',
  (SELECT c.termination_date IS NOT NULL
     FROM public.credential_cases AS c
    WHERE c.id = '59000000-0000-4000-8000-000000000001'
      AND c.org_id = '19000000-0000-4000-8000-000000000001')
);
SELECT pg_temp.mint19_assert(
  'step attribution is the verified extension actor',
  (SELECT s.step ->> 'completedBy' = '29000000-0000-4000-8000-000000000002'
     FROM public.tasks AS t
     CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(t.sop_content) AS s(step)
    WHERE t.id = '69000000-0000-4000-8000-000000000001'
      AND s.step ->> 'id' = 'last')
);
SELECT pg_temp.mint19_assert(
  'two distinct steps produce two audit events',
  (SELECT count(*) = 2 FROM public.audit_log
    WHERE org_id = '19000000-0000-4000-8000-000000000001'
      AND entity_id = '69000000-0000-4000-8000-000000000001')
);
SELECT pg_temp.mint19_assert(
  'authenticated audit actor comes from auth.uid',
  (SELECT a.user_id = '29000000-0000-4000-8000-000000000001'
          AND a.after ->> 'source' = 'panel'
     FROM public.audit_log AS a
    WHERE a.entity_id = '69000000-0000-4000-8000-000000000001'
      AND a.after ->> 'stepId' = 'first')
);
SELECT pg_temp.mint19_assert(
  'service-role audit keeps its membership-verified actor',
  (SELECT a.user_id = '29000000-0000-4000-8000-000000000002'
          AND a.after ->> 'source' = 'extension'
     FROM public.audit_log AS a
    WHERE a.entity_id = '69000000-0000-4000-8000-000000000001'
      AND a.after ->> 'stepId' = 'last')
);
SELECT pg_temp.mint19_assert(
  'service role cannot impersonate a nonmember',
  (public.complete_sop_task_step(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000001',
    'first',
    '29000000-0000-4000-8000-000000000004',
    'extension'
  ) ->> 'status')::integer = 404
);
RESET ROLE;
ALTER ROLE service_role NOBYPASSRLS;

-- Force the audit INSERT to fail after task/case changes have been attempted.
-- The RPC's transaction boundary must roll all of them back together.
CREATE FUNCTION public.mint19_fail_test_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.entity_id = '69000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'mint19_atomic_audit_failure';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER zz_mint19_atomic_audit_failure
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.mint19_fail_test_audit();

SET LOCAL request.jwt.claim.sub = '29000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.mint19_assert(
  'audit failure rolls back task, case, and audit',
  pg_temp.mint19_try_audit_failure(
    '19000000-0000-4000-8000-000000000001',
    '69000000-0000-4000-8000-000000000003',
    '29000000-0000-4000-8000-000000000001'
  ) = 'P0001|mint19_atomic_audit_failure'
  AND (SELECT t.status = 'not_started'
              AND (t.sop_content -> 0 ->> 'isCompleted') = 'false'
              AND c.termination_date IS NULL
              AND (SELECT count(*) = 0 FROM public.audit_log a WHERE a.entity_id = t.id)
       FROM public.tasks AS t
       JOIN public.credential_cases AS c ON c.id = t.case_id AND c.org_id = t.org_id
       WHERE t.id = '69000000-0000-4000-8000-000000000003')
);
RESET ROLE;

DO $function$
DECLARE
  v_failures text;
BEGIN
  SELECT pg_catalog.string_agg(r.label, ', ' ORDER BY r.ordinal)
    INTO v_failures
    FROM pg_temp.mint19_results AS r
   WHERE NOT r.passed;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-19 SQL checks failed: %', v_failures;
  END IF;
  RAISE NOTICE 'MINT19|RESULT|PASS|checks=%', (SELECT count(*) FROM pg_temp.mint19_results);
END;
$function$;

SELECT 'MINT19|RESULT|PASS|checks=' || count(*)::text
  FROM pg_temp.mint19_results;

ROLLBACK;

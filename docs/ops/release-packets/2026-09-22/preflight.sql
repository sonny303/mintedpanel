-- Read-only production baseline gate. No fixture, Auth or Vault secret reads.
BEGIN READ ONLY;
DO $$
DECLARE expected record; actual text;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) <> '7642734024280108049' THEN
    RAISE EXCEPTION 'Wrong production database identity';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('public.store_ssn(uuid,text)', '98f11a407aa9af24c7e881d143000099'),
    ('public.reveal_ssn(uuid,text)', '70c83b1dd720ac69833d0513ceea2a83'),
    ('public.create_ssn_intake_link(uuid,text,text)', '65270729cd32b95972b3e60c10be2b43'),
    ('public.commit_import_run(uuid,jsonb)', '3ac3a4cbc57c9406d09ab0c3fab906c3')
  ) AS baseline(signature, digest) LOOP
    SELECT md5(pg_get_functiondef(to_regprocedure(expected.signature))) INTO actual;
    IF actual IS DISTINCT FROM expected.digest THEN
      RAISE EXCEPTION 'Live function drift: %; refresh review before applying', expected.signature;
    END IF;
    IF has_function_privilege('anon', to_regprocedure(expected.signature), 'EXECUTE')
       OR NOT has_function_privilege('authenticated', to_regprocedure(expected.signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected RPC grants: %', expected.signature;
    END IF;
  END LOOP;
  IF to_regclass('public.provider_ssn_vault') IS NULL
    OR to_regclass('public.provider_ssn_intake_links') IS NULL
    OR to_regclass('public.import_runs') IS NULL
    OR to_regclass('public.import_rows') IS NULL THEN
    RAISE EXCEPTION 'Missing production prerequisites';
  END IF;
END;
$$;
ROLLBACK;

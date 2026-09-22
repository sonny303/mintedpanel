-- Provider CSV ↔ Add Provider create parity. This supersedes only the body of
-- commit_import_run(uuid, jsonb): the signature, authorization, transaction,
-- idempotency, narrow conflict-update allowlist, relationships, audit, and
-- grants remain unchanged. Hosted object verification is residual until an
-- operator applies this migration; repository CI exercises the full migration
-- chain against throwaway Postgres only.

CREATE OR REPLACE FUNCTION public.commit_import_run(
  p_run_id uuid,
  p_plan jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run import_runs%ROWTYPE;
  v_org uuid;
  v_user uuid := auth.uid();
  v_user_name text;
  v_creates jsonb := COALESCE(p_plan -> 'creates', '[]'::jsonb);
  v_updates jsonb := COALESCE(p_plan -> 'updates', '[]'::jsonb);
  v_blocked jsonb := COALESCE(p_plan -> 'blocked_entries', '[]'::jsonb);
  v_skipped int := COALESCE((p_plan ->> 'skipped_count')::int, 0);
  v_plan_lines int[];
  v_staged_matches int;
  v_bad int;
  v_entry jsonb;
  v_provider jsonb;
  v_license jsonb;
  v_pid uuid;
  v_created uuid[] := '{}';
  v_updated uuid[] := '{}';
  v_gid uuid;
  v_fid uuid;
  v_first boolean;
BEGIN
  SELECT org_id INTO v_org FROM import_runs WHERE id = p_run_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Import run not found';
  END IF;
  IF NOT (v_org IN (SELECT user_org_ids())) OR NOT (user_role(v_org) = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_user_name
  FROM profiles WHERE id = v_user;

  -- Idempotency guard: lock the run; replays see 'committed' and no-op.
  SELECT * INTO v_run FROM import_runs WHERE id = p_run_id FOR UPDATE;
  IF v_run.state = 'committed' THEN
    RETURN jsonb_build_object(
      'already_committed', true,
      'created_provider_ids', to_jsonb(COALESCE(v_run.created_provider_ids, '{}'::uuid[])),
      'updated_provider_ids', to_jsonb(COALESCE(v_run.updated_provider_ids, '{}'::uuid[]))
    );
  END IF;
  IF v_run.state <> 'ready_for_review' THEN
    RAISE EXCEPTION 'Import run is not ready to commit (state %)', v_run.state;
  END IF;

  -- Plan ↔ staged-row consistency: every planned anchor line must be a
  -- distinct staged row of THIS run.
  SELECT array_agg((e ->> 'line')::int)
    INTO v_plan_lines
    FROM jsonb_array_elements(v_creates || v_updates) AS e;
  IF v_plan_lines IS NOT NULL THEN
    IF (SELECT count(*) FROM unnest(v_plan_lines) l) <> (SELECT count(DISTINCT l) FROM unnest(v_plan_lines) l) THEN
      RAISE EXCEPTION 'Commit plan references a staged line twice';
    END IF;
    SELECT count(*) INTO v_staged_matches
      FROM import_rows
      WHERE run_id = p_run_id AND row_state = 'staged' AND line = ANY (v_plan_lines);
    IF v_staged_matches <> array_length(v_plan_lines, 1) THEN
      RAISE EXCEPTION 'Commit plan does not match the staged rows';
    END IF;
  END IF;

  -- Referenced entities must belong to the run's org.
  SELECT count(*) INTO v_bad FROM (
    SELECT DISTINCT g.gid FROM (
      SELECT x::uuid AS gid FROM jsonb_array_elements(v_creates) e, LATERAL jsonb_array_elements_text(COALESCE(e -> 'group_ids', '[]'::jsonb)) x
      UNION ALL
      SELECT x::uuid FROM jsonb_array_elements(v_updates) e, LATERAL jsonb_array_elements_text(COALESCE(e -> 'add_group_ids', '[]'::jsonb)) x
    ) g
    WHERE NOT EXISTS (SELECT 1 FROM provider_groups pg WHERE pg.id = g.gid AND pg.org_id = v_org)
  ) bad;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Commit plan references a group outside this organization'; END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT DISTINCT f.fid FROM (
      SELECT x::uuid AS fid FROM jsonb_array_elements(v_creates) e, LATERAL jsonb_array_elements_text(COALESCE(e -> 'facility_ids', '[]'::jsonb)) x
      UNION ALL
      SELECT x::uuid FROM jsonb_array_elements(v_updates) e, LATERAL jsonb_array_elements_text(COALESCE(e -> 'add_facility_ids', '[]'::jsonb)) x
    ) f
    WHERE NOT EXISTS (SELECT 1 FROM facilities fa WHERE fa.id = f.fid AND fa.org_id = v_org)
  ) bad;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Commit plan references a facility outside this organization'; END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_updates) e
    WHERE NOT EXISTS (
      SELECT 1 FROM providers p
      WHERE p.id = (e ->> 'provider_id')::uuid AND p.org_id = v_org
    );
  IF v_bad > 0 THEN RAISE EXCEPTION 'Commit plan references a provider outside this organization'; END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_updates) e,
         LATERAL jsonb_array_elements(COALESCE(e -> 'license_updates', '[]'::jsonb)) lu
    WHERE NOT EXISTS (
      SELECT 1 FROM state_licenses sl
      WHERE sl.id = (lu ->> 'id')::uuid
        AND sl.org_id = v_org
        AND sl.provider_id = (e ->> 'provider_id')::uuid
    );
  IF v_bad > 0 THEN RAISE EXCEPTION 'Commit plan references a license outside this organization'; END IF;

  -- Creates: one folded entry per new provider. Optional scalar fields mirror
  -- Add Provider. status remains absent so the providers default stays
  -- 'onboarding'. New-grad clearing is repeated here as a defense-in-depth
  -- guarantee even if a caller bypasses the client mapper.
  FOR v_entry IN SELECT e FROM jsonb_array_elements(v_creates) e
  LOOP
    v_provider := v_entry -> 'provider';

    INSERT INTO providers (
      org_id, first_name, middle_initial, last_name, credentials, email, phone,
      npi, caqh_id, caqh_last_attested_date, is_new_grad, specialty,
      taxonomy_code, ssn_last4, date_of_birth, start_date, degree, school_name,
      graduation_date, group_id, verification_state
    ) VALUES (
      v_org,
      v_provider ->> 'first_name',
      v_provider ->> 'middle_initial',
      v_provider ->> 'last_name',
      v_provider ->> 'credentials',
      v_provider ->> 'email',
      v_provider ->> 'phone',
      v_provider ->> 'npi',
      CASE
        WHEN COALESCE((v_provider ->> 'is_new_grad')::boolean, false) THEN NULL
        ELSE v_provider ->> 'caqh_id'
      END,
      CASE
        WHEN COALESCE((v_provider ->> 'is_new_grad')::boolean, false) THEN NULL
        ELSE (v_provider ->> 'caqh_last_attested_date')::date
      END,
      COALESCE((v_provider ->> 'is_new_grad')::boolean, false),
      v_provider ->> 'specialty',
      v_provider ->> 'taxonomy_code',
      v_provider ->> 'ssn_last4',
      (v_provider ->> 'date_of_birth')::date,
      (v_provider ->> 'start_date')::date,
      v_provider ->> 'degree',
      v_provider ->> 'school_name',
      (v_provider ->> 'graduation_date')::date,
      (SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(v_entry -> 'group_ids', '[]'::jsonb)) x LIMIT 1),
      'pending_verification'
    ) RETURNING id INTO v_pid;
    v_created := v_created || v_pid;

    v_first := true;
    FOR v_gid IN
      SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(v_entry -> 'group_ids', '[]'::jsonb)) x
    LOOP
      INSERT INTO provider_group_assignments (org_id, provider_id, group_id, is_primary)
      VALUES (v_org, v_pid, v_gid, v_first)
      ON CONFLICT (provider_id, group_id) DO NOTHING;
      v_first := false;
    END LOOP;

    FOR v_fid IN
      SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(v_entry -> 'facility_ids', '[]'::jsonb)) x
    LOOP
      INSERT INTO provider_facility_assignments (org_id, provider_id, facility_id, is_primary, start_date)
      VALUES (v_org, v_pid, v_fid, false, CURRENT_DATE)
      ON CONFLICT (provider_id, facility_id) DO NOTHING;
    END LOOP;

    FOR v_license IN
      SELECT l FROM jsonb_array_elements(COALESCE(v_entry -> 'licenses', '[]'::jsonb)) l
    LOOP
      INSERT INTO state_licenses (
        org_id, provider_id, state, license_number, license_type, issue_date,
        expiration_date, status, verified_status
      ) VALUES (
        v_org, v_pid,
        upper(v_license ->> 'state'),
        v_license ->> 'license_number',
        v_license ->> 'license_type',
        (v_license ->> 'issue_date')::date,
        (v_license ->> 'expiration_date')::date,
        'active', 'unverified'
      );
    END LOOP;

    INSERT INTO audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
    VALUES (
      v_org, v_user, v_user_name, 'CREATE', 'provider', v_pid,
      jsonb_build_object('id', v_pid, 'importRunId', p_run_id, 'line', (v_entry ->> 'line')::int, 'verificationState', 'pending_verification'),
      'Provider created from roster import (pending verification)'
    );
  END LOOP;

  -- Updates remain narrow: only the pre-existing conflict-resolved provider
  -- fields can change. Assignments and new-state licenses stay additive.
  FOR v_entry IN SELECT e FROM jsonb_array_elements(v_updates) e
  LOOP
    v_pid := (v_entry ->> 'provider_id')::uuid;
    IF NOT (v_pid = ANY (v_updated)) THEN
      v_updated := v_updated || v_pid;
    END IF;

    IF v_entry -> 'set' IS NOT NULL AND v_entry -> 'set' <> '{}'::jsonb AND v_entry -> 'set' <> 'null'::jsonb THEN
      UPDATE providers SET
        first_name = CASE WHEN v_entry -> 'set' ? 'first_name' THEN v_entry -> 'set' ->> 'first_name' ELSE first_name END,
        last_name  = CASE WHEN v_entry -> 'set' ? 'last_name'  THEN v_entry -> 'set' ->> 'last_name'  ELSE last_name  END,
        npi        = CASE WHEN v_entry -> 'set' ? 'npi'        THEN v_entry -> 'set' ->> 'npi'        ELSE npi        END,
        specialty  = CASE WHEN v_entry -> 'set' ? 'specialty'  THEN v_entry -> 'set' ->> 'specialty'  ELSE specialty  END,
        updated_at = now()
      WHERE id = v_pid AND org_id = v_org;
    END IF;

    FOR v_gid IN
      SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(v_entry -> 'add_group_ids', '[]'::jsonb)) x
    LOOP
      INSERT INTO provider_group_assignments (org_id, provider_id, group_id, is_primary)
      VALUES (v_org, v_pid, v_gid, false)
      ON CONFLICT (provider_id, group_id) DO NOTHING;
    END LOOP;

    FOR v_fid IN
      SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(v_entry -> 'add_facility_ids', '[]'::jsonb)) x
    LOOP
      INSERT INTO provider_facility_assignments (org_id, provider_id, facility_id, is_primary, start_date)
      VALUES (v_org, v_pid, v_fid, false, CURRENT_DATE)
      ON CONFLICT (provider_id, facility_id) DO NOTHING;
    END LOOP;

    FOR v_license IN
      SELECT l FROM jsonb_array_elements(COALESCE(v_entry -> 'license_inserts', '[]'::jsonb)) l
    LOOP
      INSERT INTO state_licenses (
        org_id, provider_id, state, license_number, license_type, issue_date,
        expiration_date, status, verified_status
      ) VALUES (
        v_org, v_pid,
        upper(v_license ->> 'state'),
        v_license ->> 'license_number',
        v_license ->> 'license_type',
        (v_license ->> 'issue_date')::date,
        (v_license ->> 'expiration_date')::date,
        'active', 'unverified'
      );
    END LOOP;

    FOR v_license IN
      SELECT l FROM jsonb_array_elements(COALESCE(v_entry -> 'license_updates', '[]'::jsonb)) l
    LOOP
      -- An imported overwrite invalidates any prior primary-source
      -- verification. license_type deliberately remains insert-only.
      UPDATE state_licenses SET
        license_number = COALESCE(v_license ->> 'license_number', license_number),
        issue_date = COALESCE((v_license ->> 'issue_date')::date, issue_date),
        expiration_date = COALESCE((v_license ->> 'expiration_date')::date, expiration_date),
        verified_status = 'unverified',
        verified_at = NULL,
        verified_by = NULL,
        verification_source_url = NULL
      WHERE id = (v_license ->> 'id')::uuid AND org_id = v_org AND provider_id = v_pid;
    END LOOP;

    INSERT INTO audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
    VALUES (
      v_org, v_user, v_user_name, 'UPDATE', 'provider', v_pid,
      jsonb_build_object(
        'id', v_pid, 'importRunId', p_run_id, 'line', (v_entry ->> 'line')::int,
        'resolvedFields', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(COALESCE(NULLIF(v_entry -> 'set', 'null'::jsonb), '{}'::jsonb)) k),
        'addedGroups', jsonb_array_length(COALESCE(v_entry -> 'add_group_ids', '[]'::jsonb)),
        'addedFacilities', jsonb_array_length(COALESCE(v_entry -> 'add_facility_ids', '[]'::jsonb))
      ),
      'Provider updated from roster import'
    );
  END LOOP;

  INSERT INTO audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
  VALUES (
    v_org, v_user, v_user_name, 'UPDATE', 'import_run', p_run_id,
    jsonb_build_object(
      'id', p_run_id,
      'created', COALESCE(array_length(v_created, 1), 0),
      'updated', COALESCE(array_length(v_updated, 1), 0),
      'skipped', v_skipped,
      'blocked', jsonb_array_length(v_blocked)
    ),
    'Roster import run committed'
  );

  UPDATE import_runs SET
    state = 'committed',
    committed_at = now(),
    created_provider_ids = v_created,
    updated_provider_ids = v_updated,
    error_report = CASE
      WHEN jsonb_array_length(v_blocked) > 0
        THEN COALESCE(error_report, '[]'::jsonb) || v_blocked
      ELSE error_report
    END,
    updated_at = now()
  WHERE id = p_run_id;

  DELETE FROM import_rows WHERE run_id = p_run_id;

  RETURN jsonb_build_object(
    'already_committed', false,
    'created', COALESCE(array_length(v_created, 1), 0),
    'updated', COALESCE(array_length(v_updated, 1), 0),
    'created_provider_ids', to_jsonb(v_created),
    'updated_provider_ids', to_jsonb(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_import_run(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_import_run(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.commit_import_run(uuid, jsonb) TO authenticated;

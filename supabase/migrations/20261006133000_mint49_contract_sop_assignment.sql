-- MINT-49: a group contract owns one pinned, immutable Contract SOP version.
-- Provider and facility stay launch inputs; this creates no case or task rows.

-- Composite keys let receipts enforce same-org ownership at the database
-- boundary, even when a service_role caller bypasses row-level policies.
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_org_id_id_key UNIQUE (org_id, id);

CREATE TABLE public.contract_sop_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL UNIQUE REFERENCES public.contracts(id) ON DELETE RESTRICT,
  sop_template_id uuid NOT NULL,
  sop_version integer NOT NULL CHECK (sop_version > 0),
  context_version integer NOT NULL DEFAULT 1 CHECK (context_version > 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  updated_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_sop_assignments_contract_scope_fkey
    FOREIGN KEY (org_id, contract_id)
    REFERENCES public.contracts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT contract_sop_assignments_version_fkey
    FOREIGN KEY (sop_template_id, sop_version)
    REFERENCES public.sop_template_versions(template_id, version) ON DELETE RESTRICT
);

CREATE INDEX contract_sop_assignments_org_idx
  ON public.contract_sop_assignments (org_id, contract_id);

ALTER TABLE public.contract_sop_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_sop_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contract_sop_assignments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.contract_sop_assignments TO service_role;
CREATE POLICY contract_sop_assignments_select
  ON public.contract_sop_assignments FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

COMMENT ON TABLE public.contract_sop_assignments IS
  'One current Contract SOP assignment per group/payer/state contract; provider and facility are launch inputs.';
COMMENT ON COLUMN public.contract_sop_assignments.context_version IS
  'Optimistic concurrency version for assignment changes and Contract launch context.';

ALTER TABLE public.fill_sessions
  ALTER COLUMN case_id DROP NOT NULL,
  ADD COLUMN contract_id uuid,
  ADD COLUMN contract_sop_assignment_id uuid,
  ADD COLUMN sop_template_id uuid,
  ADD COLUMN sop_version integer,
  ADD COLUMN task_index integer,
  ADD COLUMN step_index integer,
  ADD COLUMN facility_id uuid,
  ADD COLUMN portal_id uuid,
  ADD COLUMN context_version integer,
  ADD COLUMN launch_receipt_id uuid,
  ADD COLUMN mapping_generation integer,
  ADD COLUMN effective_mapping_fingerprint text;

ALTER TABLE public.fill_sessions
  ADD CONSTRAINT fill_sessions_contract_owner_fkey
    FOREIGN KEY (org_id, contract_id)
    REFERENCES public.contracts(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fill_sessions_contract_assignment_fkey
    FOREIGN KEY (contract_sop_assignment_id)
    REFERENCES public.contract_sop_assignments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fill_sessions_facility_fkey
    FOREIGN KEY (org_id, facility_id) REFERENCES public.facilities(org_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fill_sessions_portal_id_fkey
    FOREIGN KEY (portal_id) REFERENCES public.portals(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fill_sessions_contract_context_check CHECK (
    (
      case_id IS NULL
      AND contract_id IS NULL
      AND contract_sop_assignment_id IS NULL
      AND sop_template_id IS NULL
      AND sop_version IS NULL
      AND task_index IS NULL
      AND step_index IS NULL
      AND facility_id IS NULL
      AND portal_id IS NULL
      AND context_version IS NULL
      AND launch_receipt_id IS NULL
      AND mapping_generation IS NULL
      AND effective_mapping_fingerprint IS NULL
    )
    OR (
      case_id IS NOT NULL
      AND contract_id IS NULL
      AND contract_sop_assignment_id IS NULL
      AND (
        (
          sop_template_id IS NULL
          AND sop_version IS NULL
          AND task_index IS NULL
          AND step_index IS NULL
          AND facility_id IS NULL
          AND portal_id IS NULL
          AND context_version IS NULL
          AND launch_receipt_id IS NULL
          AND mapping_generation IS NULL
          AND effective_mapping_fingerprint IS NULL
        )
        OR (
          sop_template_id IS NOT NULL
          AND sop_version IS NOT NULL
          AND sop_version > 0
          AND task_index IS NOT NULL
          AND task_index >= 0
          AND step_index IS NOT NULL
          AND step_index >= 0
          AND context_version IS NOT NULL
          AND context_version > 0
          AND portal_id IS NULL
          AND launch_receipt_id IS NOT NULL
          AND mapping_generation IS NOT NULL
          AND mapping_generation > 0
          AND effective_mapping_fingerprint IS NOT NULL
          AND nullif(btrim(effective_mapping_fingerprint), '') IS NOT NULL
          AND provider_id IS NOT NULL
          AND fill_mode = 'web'
          AND is_test = false
          AND event_schema_version = 2
        )
      )
    )
    OR (
      contract_id IS NOT NULL
      AND case_id IS NULL
      AND contract_sop_assignment_id IS NOT NULL
      AND sop_template_id IS NOT NULL
      AND sop_version IS NOT NULL
      AND sop_version > 0
      AND task_index IS NOT NULL
      AND task_index >= 0
      AND step_index IS NOT NULL
      AND step_index >= 0
      AND context_version IS NOT NULL
      AND context_version > 0
      AND portal_id IS NOT NULL
      AND launch_receipt_id IS NOT NULL
      AND mapping_generation IS NOT NULL
      AND mapping_generation > 0
      AND effective_mapping_fingerprint IS NOT NULL
      AND nullif(btrim(effective_mapping_fingerprint), '') IS NOT NULL
      AND provider_id IS NOT NULL
      AND fill_mode = 'web'
      AND is_test = false
      AND event_schema_version = 2
    )
  );

CREATE INDEX fill_sessions_contract_activity_idx
  ON public.fill_sessions (org_id, contract_id, started_at DESC)
  WHERE contract_id IS NOT NULL AND NOT is_test;

COMMENT ON COLUMN public.fill_sessions.contract_id IS
  'Contract owner for a real MINT-49 fill receipt; case_id stays NULL for this owner.';
COMMENT ON COLUMN public.fill_sessions.effective_mapping_fingerprint IS
  'Opaque canonical effective mapping fingerprint supplied by the exact-key resolver.';
COMMENT ON COLUMN public.fill_sessions.portal_id IS
  'Exact org-over-global portal configuration selected by the canonical resolver for a Contract receipt.';

-- This RPC is the only authenticated write path. The contract row lock
-- serializes first assignment and replacement; replacement is forbidden once
-- a real fill receipt exists. The request names a specific template/version,
-- so the operator explicitly resolves any compatible-template ambiguity.
CREATE OR REPLACE FUNCTION public.assign_contract_sop(
  p_contract_id uuid,
  p_sop_template_id uuid,
  p_sop_version integer,
  p_expected_context_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, app_authz
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_contract public.contracts%ROWTYPE;
  v_template public.sop_templates%ROWTYPE;
  v_version public.sop_template_versions%ROWTYPE;
  v_assignment public.contract_sop_assignments%ROWTYPE;
  v_old_assignment public.contract_sop_assignments%ROWTYPE;
  v_user_name text;
BEGIN
  IF v_actor IS NULL
     OR coalesce(auth.role(), '') <> 'authenticated'
     OR app_authz.is_restricted_external() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'contract_sop_not_authorized';
  END IF;

  SELECT * INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_contract.group_id IS NULL
     OR v_contract.payer_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.provider_groups group_row
       WHERE group_row.id = v_contract.group_id
         AND group_row.org_id = v_contract.org_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.payers payer
       WHERE payer.id = v_contract.payer_id
         AND (
           payer.org_id = v_contract.org_id
           OR (
             payer.org_id IS NULL
             AND EXISTS (
               SELECT 1 FROM public.org_payer_assignments payer_assignment
               WHERE payer_assignment.org_id = v_contract.org_id
                 AND payer_assignment.payer_id = payer.id
                 AND payer_assignment.archived_at IS NULL
             )
           )
         )
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.memberships membership
       WHERE membership.org_id = v_contract.org_id
         AND membership.user_id = v_actor
         AND membership.role IN ('specialist', 'admin')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'contract_sop_not_authorized';
  END IF;

  SELECT * INTO v_assignment
  FROM public.contract_sop_assignments
  WHERE contract_id = v_contract.id
  FOR UPDATE;

  IF FOUND THEN
    v_old_assignment := v_assignment;
  END IF;

  -- A retry after a successful first assignment can still carry the original
  -- create context (zero/null). Return the exact pinned assignment before the
  -- compare-and-swap check; changed assignments still require the current
  -- context version below.
  IF v_assignment.id IS NOT NULL
     AND v_assignment.sop_template_id = p_sop_template_id
     AND v_assignment.sop_version = p_sop_version THEN
    RETURN to_jsonb(v_assignment);
  END IF;

  IF FOUND THEN
    IF p_expected_context_version IS NULL
       OR p_expected_context_version IS DISTINCT FROM v_assignment.context_version THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'contract_sop_assignment_conflict';
    END IF;
  ELSIF coalesce(p_expected_context_version, 0) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'contract_sop_assignment_conflict';
  END IF;

  SELECT * INTO v_template
  FROM public.sop_templates template
  WHERE template.id = p_sop_template_id
    AND template.archived = false
    AND template.case_type = 'contract'
    AND template.payer_id = v_contract.payer_id
    AND (template.group_id IS NULL OR template.group_id = v_contract.group_id)
    AND (
      v_contract.state = ANY(coalesce(template.states, ARRAY[template.state]))
      OR coalesce(template.states, ARRAY[template.state]) = ARRAY['All']::text[]
    )
    AND template.current_version = p_sop_version
    AND (
      template.org_id = v_contract.org_id
      OR (
        template.org_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.org_payer_assignments opa
          WHERE opa.org_id = v_contract.org_id
            AND opa.payer_id = template.payer_id
        )
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contract_sop_template_ineligible';
  END IF;

  SELECT * INTO v_version
  FROM public.sop_template_versions version_row
  WHERE version_row.template_id = v_template.id
    AND version_row.version = p_sop_version
    AND version_row.case_type = 'contract';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contract_sop_template_ineligible';
  END IF;

  IF v_assignment.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fill_sessions session
    WHERE session.org_id = v_contract.org_id
      AND session.contract_id = v_contract.id
      AND NOT coalesce(session.is_test, false)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'contract_sop_replacement_after_activity';
  END IF;

  SELECT coalesce(profile.full_name, profile.email) INTO v_user_name
  FROM public.profiles profile WHERE profile.id = v_actor;

  IF v_assignment.id IS NULL THEN
    INSERT INTO public.contract_sop_assignments (
      org_id, contract_id, sop_template_id, sop_version, context_version,
      created_by, updated_by
    ) VALUES (
      v_contract.org_id, v_contract.id, v_template.id, v_version.version, 1,
      v_actor, v_actor
    ) RETURNING * INTO v_assignment;

    INSERT INTO public.audit_log (
      org_id, user_id, user_name, action_type, entity_type, entity_id,
      description, after
    ) VALUES (
      v_contract.org_id, v_actor, v_user_name, 'CREATE',
      'contract_sop_assignment', v_assignment.id,
      'Assigned Contract SOP version',
      jsonb_build_object(
        'contract_id', v_contract.id,
        'sop_template_id', v_template.id,
        'sop_version', v_version.version,
        'context_version', v_assignment.context_version
      )
    );
  ELSE
    UPDATE public.contract_sop_assignments
    SET sop_template_id = v_template.id,
        sop_version = v_version.version,
        context_version = context_version + 1,
        updated_by = v_actor,
        updated_at = now()
    WHERE id = v_assignment.id
    RETURNING * INTO v_assignment;

    INSERT INTO public.audit_log (
      org_id, user_id, user_name, action_type, entity_type, entity_id,
      description, before, after
    ) VALUES (
      v_contract.org_id, v_actor, v_user_name, 'UPDATE',
      'contract_sop_assignment', v_assignment.id,
      'Replaced Contract SOP version before recorded filling',
      jsonb_build_object(
        'sop_template_id', v_old_assignment.sop_template_id,
        'sop_version', v_old_assignment.sop_version,
        'context_version', v_old_assignment.context_version
      ),
      jsonb_build_object(
        'contract_id', v_contract.id,
        'sop_template_id', v_template.id,
        'sop_version', v_version.version,
        'context_version', v_assignment.context_version
      )
    );
  END IF;

  RETURN to_jsonb(v_assignment);
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_contract_sop(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_contract_sop(uuid, uuid, integer, integer)
  TO authenticated;

-- Extend the existing V2 validator's final owner check without duplicating or
-- weakening its field-outcome, actor, membership, provider, and case checks.
-- Exact-source replacement deliberately fails the migration if the reviewed
-- MINT-45 branch changes, so a new validator revision gets an explicit review.
DO $migration$
DECLARE
  v_definition text;
  v_old_owner_check constant text := $old$
  IF NEW.case_id IS NULL THEN
    IF NOT COALESCE(NEW.is_test, false) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'a real fill outcome requires a case';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.credential_cases AS credential_case
    WHERE credential_case.id = NEW.case_id
      AND credential_case.org_id = NEW.org_id
      AND credential_case.provider_id IS NOT DISTINCT FROM NEW.provider_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome case is outside the provider organization';
  END IF;
$old$;
  v_new_owner_check constant text := $new$
  IF NEW.contract_id IS NOT NULL THEN
    IF NEW.case_id IS NOT NULL OR COALESCE(NEW.is_test, false)
       OR NOT EXISTS (
         SELECT 1
         FROM public.contracts AS contract_row
         JOIN public.contract_sop_assignments AS assignment
           ON assignment.id = NEW.contract_sop_assignment_id
          AND assignment.org_id = contract_row.org_id
          AND assignment.contract_id = contract_row.id
          AND assignment.sop_template_id = NEW.sop_template_id
          AND assignment.sop_version = NEW.sop_version
          AND assignment.context_version = NEW.context_version
         JOIN public.sop_templates AS template
           ON template.id = assignment.sop_template_id
         JOIN public.sop_template_versions AS version_row
           ON version_row.template_id = assignment.sop_template_id
          AND version_row.version = assignment.sop_version
         JOIN public.portals AS portal
           ON portal.id = NEW.portal_id
          AND lower(btrim(portal.portal_key)) = lower(btrim(NEW.portal_key))
          AND (portal.org_id = contract_row.org_id OR portal.org_id IS NULL)
          AND portal.case_type = 'contract'
          AND portal.requires_explicit_selection
          AND portal.payer_id = contract_row.payer_id
          AND portal.mapping_generation = NEW.mapping_generation
          AND (
            portal.org_id = contract_row.org_id
            OR NOT EXISTS (
              SELECT 1 FROM public.portals AS org_portal
              WHERE org_portal.org_id = contract_row.org_id
                AND lower(btrim(org_portal.portal_key)) = lower(btrim(portal.portal_key))
            )
          )
         JOIN public.providers AS provider
           ON provider.id = NEW.provider_id
          AND provider.org_id = contract_row.org_id
          AND provider.status <> 'terminated'
         JOIN public.provider_group_assignments AS provider_group
           ON provider_group.provider_id = provider.id
          AND provider_group.org_id = contract_row.org_id
          AND provider_group.group_id = contract_row.group_id
          AND (provider_group.start_date IS NULL OR provider_group.start_date <= current_date)
          AND (provider_group.end_date IS NULL OR provider_group.end_date >= current_date)
         JOIN public.provider_groups AS group_row
           ON group_row.id = contract_row.group_id
          AND group_row.org_id = contract_row.org_id
         WHERE contract_row.id = NEW.contract_id
           AND contract_row.org_id = NEW.org_id
           AND contract_row.group_id IS NOT NULL
           AND contract_row.payer_id IS NOT NULL
           AND template.case_type = 'contract'
           AND template.payer_id = contract_row.payer_id
           AND (template.group_id IS NULL OR template.group_id = contract_row.group_id)
           AND (template.org_id = contract_row.org_id OR template.org_id IS NULL)
           AND version_row.case_type = 'contract'
           AND NEW.task_index < jsonb_array_length(version_row.task_definitions)
           AND NEW.step_index < jsonb_array_length(
             version_row.task_definitions->NEW.task_index->'steps'
           )
           AND version_row.task_definitions->NEW.task_index->'steps'->NEW.step_index->>'stepType' = 'online_form'
           AND lower(btrim(version_row.task_definitions->NEW.task_index->'steps'->NEW.step_index->>'portalKey')) = lower(btrim(NEW.portal_key))
           AND (
             NEW.facility_id IS NULL
             OR EXISTS (
               SELECT 1 FROM public.facilities facility
               WHERE facility.id = NEW.facility_id
                 AND facility.org_id = contract_row.org_id
                 AND facility.group_id = contract_row.group_id
                 AND upper(facility.state) = upper(contract_row.state)
                 AND facility.is_active
                 AND NOT facility.reference_only
             )
           )
         FOR SHARE OF assignment
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'contract fill owner context is invalid';
    END IF;
  ELSIF NEW.case_id IS NULL THEN
    IF NOT COALESCE(NEW.is_test, false) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'a real fill outcome requires a case';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.credential_cases AS credential_case
    WHERE credential_case.id = NEW.case_id
      AND credential_case.org_id = NEW.org_id
      AND credential_case.provider_id IS NOT DISTINCT FROM NEW.provider_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome case is outside the provider organization';
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef('public._fill_sessions_validate_v2()'::regprocedure)
  INTO v_definition;

  IF position(v_old_owner_check IN v_definition) = 0 THEN
    RAISE EXCEPTION 'MINT-49 expected owner-check source in _fill_sessions_validate_v2';
  END IF;

  EXECUTE replace(v_definition, v_old_owner_check, v_new_owner_check);
END;
$migration$;

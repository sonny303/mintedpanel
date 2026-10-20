-- 2026-10-20 — provider_onboarding_report RPC. Returns the data shape the
-- Provider Onboarding report card consumes.
--
-- The target (2 business days median for Ready -> first payer application)
-- and the measured-only provider pace columns are reported, not enforced. The
-- business-day calendar math is a TODO (the formulas referenced as
-- Stage 2 §2.4 in the handoff are not in this repo's current schema).
--
-- Additive + idempotent.

CREATE OR REPLACE FUNCTION public.provider_onboarding_report(
  p_org_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_target_business_days int DEFAULT 2
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  v_role := public.user_role(p_org_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized for this org';
  END IF;

  -- Owner + coordinator + admin can see the report; billing cannot (per Q6).
  IF v_role = 'billing' THEN
    RAISE EXCEPTION 'Billing users cannot view the Provider Onboarding report';
  END IF;

  RETURN jsonb_build_object(
    'target_days', p_target_business_days,
    'current_median_business_days', NULL::numeric,  -- TODO: compute from audit_log rows
    'hires',
    coalesce((
      SELECT jsonb_agg(row_to_json(h))
      FROM (
        SELECT
          p.id AS provider_id,
          p.status,
          p.verification_state,
          p.group_id,
          -- ready_at: the onboarding.admitted audit row's created_at for this provider.
          (
            SELECT al.created_at
            FROM public.audit_log al
            WHERE al.org_id = p_org_id
              AND al.entity_type = 'onboarding'
              AND al.entity_id = p.id
              AND al.description LIKE 'onboarding.admitted%'
            ORDER BY al.created_at DESC LIMIT 1
          ) AS ready_at,
          -- first_application_at: the first_credential_application audit row.
          (
            SELECT al.created_at
            FROM public.audit_log al
            WHERE al.org_id = p_org_id
              AND al.entity_type = 'onboarding'
              AND al.entity_id = p.id
              AND al.description LIKE 'first_credential_application%'
            ORDER BY al.created_at DESC LIMIT 1
          ) AS first_application_at,
          NULL::numeric AS target_delta_business_days
        FROM public.providers p
        WHERE p.org_id = p_org_id
          AND (p_group_id IS NULL OR p.group_id = p_group_id)
          AND p.status = 'onboarding'
        ORDER BY p.created_at
      ) h
    ), '[]'::jsonb),
    'needs_a_human',
    coalesce((
      SELECT jsonb_agg(row_to_json(n))
      FROM (
        SELECT
          al.entity_id AS provider_id,
          CASE
            WHEN al.description LIKE '%help%' THEN 'help_request'
            WHEN al.description LIKE '%told not needed%' OR al.description LIKE '%told_not_needed%' THEN 'told_not_needed'
            WHEN al.description LIKE '%duplicate%' THEN 'duplicate'
            ELSE 'help_request'
          END AS reason,
          al.created_at AS opened_at
        FROM public.audit_log al
        WHERE al.org_id = p_org_id
          AND al.entity_type = 'provider'
          AND al.created_at > now() - interval '30 days'
          AND (al.description LIKE '%help%' OR al.description LIKE '%told not needed%'
               OR al.description LIKE '%told_not_needed%' OR al.description LIKE '%duplicate%')
        ORDER BY al.created_at DESC
        LIMIT 100
      ) n
    ), '[]'::jsonb),
    'provider_pace_measured_only', jsonb_build_object(
      'invitation_to_first_signin_p50_hours', NULL::numeric,
      'invitation_to_submit_p50_hours', NULL::numeric
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.provider_onboarding_report(uuid, uuid, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_report(uuid, uuid, uuid, int) TO authenticated;
-- E6.14: Transparent Enrollment Explorer high-density matrix query RPC.
-- Supports both internal staff and verified client audiences.
-- Enforces client group grants, excludes test clinicians for clients, and strips staff notes.

CREATE OR REPLACE FUNCTION public.get_enrollment_catalog(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_audience text,
  p_group_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_products jsonb;
  v_targets jsonb;
  v_facilities jsonb;
  v_groups jsonb;
  v_payers jsonb;
  v_context jsonb;
  v_client_group_ids uuid[];
BEGIN
  IF p_actor_user_id IS NULL OR p_org_id IS NULL OR p_audience IS NULL
     OR p_audience NOT IN ('staff', 'client') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;

  v_context := public.resolve_enrollment_context(p_actor_user_id, p_audience, p_org_id);

  IF p_audience = 'client' THEN
    SELECT COALESCE(array_agg((client_group ->> 'groupId')::uuid), ARRAY[]::uuid[])
      INTO v_client_group_ids
    FROM jsonb_array_elements(v_context -> 'clientOrgs') client_org
    CROSS JOIN LATERAL jsonb_array_elements(client_org -> 'groups') client_group
    WHERE client_org ->> 'orgId' = p_org_id::text;

    IF p_group_id IS NOT NULL AND NOT (p_group_id = ANY(v_client_group_ids)) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
    END IF;
  ELSE
    PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
    IF p_group_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.provider_groups WHERE id = p_group_id AND org_id = p_org_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
    END IF;
  END IF;

  -- Active Products
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', product.id, 'payerId', payer.id, 'payerName', payer.name,
    'productKey', product.product_key, 'displayName', product.display_name,
    'isActive', product.is_active
  ) ORDER BY payer.name, product.display_name, product.product_key), '[]'::jsonb)
    INTO v_products
  FROM private.payer_products product
  JOIN public.payers payer ON payer.id = product.payer_id
    AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
  WHERE payer.is_active IS DISTINCT FROM false;

  -- Targets scoped by group
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'targetId', target.id, 'groupId', target.group_id, 'payerProductId', target.payer_product_id,
    'payerId', target.payer_id, 'state', target.state, 'isActive', target.is_active
  ) ORDER BY target.group_id, target.state, target.payer_product_id), '[]'::jsonb)
    INTO v_targets
  FROM private.group_product_targets target
  WHERE target.org_id = p_org_id
    AND (p_group_id IS NULL OR target.group_id = p_group_id)
    AND (p_audience = 'staff' OR target.group_id = ANY(v_client_group_ids));

  -- Facilities in org
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'state', f.state
  ) ORDER BY f.name), '[]'::jsonb)
    INTO v_facilities
  FROM public.facilities f
  WHERE f.org_id = p_org_id;

  -- Provider Groups (all org groups for staff, granted groups for client)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pg.id, 'name', pg.name
  ) ORDER BY pg.name), '[]'::jsonb)
    INTO v_groups
  FROM public.provider_groups pg
  WHERE pg.org_id = p_org_id
    AND (p_audience = 'staff' OR pg.id = ANY(v_client_group_ids));

  -- Active Payers
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name
  ) ORDER BY p.name), '[]'::jsonb)
    INTO v_payers
  FROM public.payers p
  WHERE (p.org_id IS NULL OR p.org_id = p_org_id)
    AND p.is_active IS DISTINCT FROM false;

  RETURN jsonb_build_object(
    'products', v_products,
    'targets', v_targets,
    'facilities', v_facilities,
    'groups', v_groups,
    'payers', v_payers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_explorer_page(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_audience text,
  p_group_id uuid DEFAULT NULL,
  p_facility_id uuid DEFAULT NULL,
  p_discipline text DEFAULT NULL,
  p_status_bucket text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_context jsonb;
  v_client_group_ids uuid[];
  v_authorized_group_ids uuid[];
  v_search_pattern text;
  v_clinicians jsonb;
  v_products jsonb;
  v_cells jsonb;
  v_stats jsonb;
  v_total_clinicians integer := 0;
  v_active_enrollments integer := 0;
  v_pending_payer integer := 0;
  v_actionable_blockers integer := 0;
BEGIN
  IF p_actor_user_id IS NULL OR p_org_id IS NULL OR p_audience IS NULL
     OR p_audience NOT IN ('staff', 'client') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;

  v_context := public.resolve_enrollment_context(p_actor_user_id, p_audience, p_org_id);

  IF p_audience = 'client' THEN
    SELECT COALESCE(array_agg((client_group ->> 'groupId')::uuid), ARRAY[]::uuid[])
      INTO v_client_group_ids
    FROM jsonb_array_elements(v_context -> 'clientOrgs') client_org
    CROSS JOIN LATERAL jsonb_array_elements(client_org -> 'groups') client_group
    WHERE client_org ->> 'orgId' = p_org_id::text;

    IF p_group_id IS NOT NULL THEN
      IF NOT (p_group_id = ANY(v_client_group_ids)) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
      END IF;
      v_authorized_group_ids := ARRAY[p_group_id];
    ELSE
      v_authorized_group_ids := v_client_group_ids;
    END IF;
  ELSE
    PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
    IF p_group_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.provider_groups WHERE id = p_group_id AND org_id = p_org_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
      END IF;
      v_authorized_group_ids := ARRAY[p_group_id];
    ELSE
      SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_authorized_group_ids
      FROM public.provider_groups WHERE org_id = p_org_id;
    END IF;
  END IF;

  IF p_search IS NOT NULL AND length(btrim(p_search)) > 0 THEN
    v_search_pattern := '%' || btrim(p_search) || '%';
  END IF;

  -- 1. Bounded Payer Products from Targets for authorized groups
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', p.id,
    'payerId', payer.id,
    'payerName', payer.name,
    'productKey', p.product_key,
    'displayName', p.display_name
  ) ORDER BY payer.name, p.display_name), '[]'::jsonb)
    INTO v_products
  FROM (
    SELECT DISTINCT target.payer_product_id
    FROM private.group_product_targets target
    WHERE target.org_id = p_org_id
      AND target.group_id = ANY(v_authorized_group_ids)
      AND target.is_active = true
  ) active_target
  JOIN private.payer_products p ON p.id = active_target.payer_product_id
  JOIN public.payers payer ON payer.id = p.payer_id;

  -- 2. Clinicians matching group, facility, discipline, and search query
  WITH candidate_providers AS (
    SELECT DISTINCT
      prov.id,
      prov.first_name,
      prov.last_name,
      prov.npi,
      prov.taxonomy_code,
      CASE
        WHEN prov.taxonomy_code LIKE '2251%' THEN 'PT'
        WHEN prov.taxonomy_code LIKE '2252%' THEN 'PTA'
        WHEN prov.taxonomy_code LIKE '225X%' THEN 'OT'
        WHEN prov.taxonomy_code LIKE '224Z%' THEN 'OTA'
        WHEN prov.taxonomy_code LIKE '235Z%' OR prov.taxonomy_code LIKE '2355%' THEN 'SLP'
        WHEN prov.taxonomy_code = '133V00000X' THEN 'Other'
        ELSE 'Unknown'
      END AS discipline
    FROM public.providers prov
    JOIN public.provider_group_assignments pga
      ON pga.provider_id = prov.id AND pga.org_id = p_org_id AND pga.group_id = ANY(v_authorized_group_ids)
    LEFT JOIN public.provider_facility_assignments pfa
      ON pfa.provider_id = prov.id AND pfa.org_id = p_org_id
    WHERE prov.org_id = p_org_id
      AND (p_audience = 'staff' OR COALESCE(prov.is_test_provider, false) = false)
      AND (p_facility_id IS NULL OR pfa.facility_id = p_facility_id)
      AND (
        v_search_pattern IS NULL
        OR prov.first_name ILIKE v_search_pattern
        OR prov.last_name ILIKE v_search_pattern
        OR prov.npi ILIKE v_search_pattern
      )
  ),
  filtered_providers AS (
    SELECT *
    FROM candidate_providers cp
    WHERE (p_discipline IS NULL OR p_discipline = 'all' OR cp.discipline = p_discipline)
  )
  SELECT
    count(*),
    COALESCE(jsonb_agg(jsonb_build_object(
      'providerId', fp.id,
      'firstName', fp.first_name,
      'lastName', fp.last_name,
      'npi', fp.npi,
      'taxonomyCode', fp.taxonomy_code,
      'discipline', fp.discipline,
      'groupIds', COALESCE((
        SELECT jsonb_agg(pga.group_id::text)
        FROM public.provider_group_assignments pga
        WHERE pga.provider_id = fp.id AND pga.org_id = p_org_id AND pga.group_id = ANY(v_authorized_group_ids)
      ), '[]'::jsonb),
      'facilityIds', COALESCE((
        SELECT jsonb_agg(pfa.facility_id::text)
        FROM public.provider_facility_assignments pfa
        WHERE pfa.provider_id = fp.id AND pfa.org_id = p_org_id
      ), '[]'::jsonb)
    ) ORDER BY fp.last_name, fp.first_name, fp.id), '[]'::jsonb)
  INTO v_total_clinicians, v_clinicians
  FROM filtered_providers fp;

  -- 3. Scopes, revisions, and cell evaluations
  WITH relevant_scopes AS (
    SELECT
      s.id AS scope_id,
      s.provider_id,
      s.payer_product_id,
      s.facility_id,
      s.group_id,
      rev.id AS revision_id,
      rev.status AS revision_status,
      rev.action_owner AS revision_owner,
      rev.client_safe_blocker AS revision_blocker,
      rev.effective_date AS revision_effective_date,
      rev.payer_reference,
      pub.id AS publication_id,
      pub.published_status,
      pub.action_owner AS published_owner,
      pub.client_safe_blocker AS published_blocker,
      pub.published_at,
      NOT private.e613_revision_sources_valid(s.id, rev.id) AS is_stale,
      (SELECT count(*) FROM private.enrollment_proof_publications proof
        WHERE proof.scope_id = s.id AND proof.revision_id = rev.id
          AND NOT EXISTS (SELECT 1 FROM private.publication_events pe
            WHERE pe.proof_publication_id = proof.id AND pe.event_type = 'publication_revoked')
      ) AS proof_count
    FROM private.enrollment_scopes s
    JOIN private.enrollment_scope_revisions rev ON rev.id = s.current_revision_id
    LEFT JOIN LATERAL (
      SELECT * FROM private.enrollment_summary_publications s_pub
      WHERE s_pub.scope_id = s.id AND s_pub.org_id = p_org_id
        AND NOT EXISTS (SELECT 1 FROM private.publication_events pe
          WHERE pe.summary_publication_id = s_pub.id AND pe.event_type = 'publication_revoked')
      ORDER BY s_pub.published_at DESC LIMIT 1
    ) pub ON true
    WHERE s.org_id = p_org_id
      AND s.group_id = ANY(v_authorized_group_ids)
      AND (p_audience = 'staff' OR pub.id IS NOT NULL)
  ),
  evaluated_cells AS (
    SELECT
      rs.scope_id,
      rs.provider_id,
      rs.payer_product_id,
      rs.facility_id,
      CASE
        WHEN p_audience = 'client' AND (rs.is_stale OR (rs.published_status = 'approved' AND rs.proof_count = 0))
          THEN 'needs_verification'
        WHEN p_audience = 'client' THEN rs.published_status
        ELSE rs.revision_status
      END AS final_status,
      CASE
        WHEN p_audience = 'client' THEN rs.published_owner
        ELSE rs.revision_owner
      END AS final_owner,
      CASE
        WHEN p_audience = 'client' AND (rs.is_stale OR rs.proof_count = 0) THEN NULL
        ELSE rs.revision_effective_date
      END AS final_effective_date,
      CASE
        WHEN p_audience = 'client' THEN rs.published_blocker
        ELSE rs.revision_blocker
      END AS final_blocker,
      rs.payer_reference,
      rs.proof_count,
      rs.published_at,
      COUNT(*) OVER (PARTITION BY rs.provider_id, rs.payer_product_id) AS facility_count,
      ROW_NUMBER() OVER (PARTITION BY rs.provider_id, rs.payer_product_id ORDER BY rs.facility_id) AS row_num
    FROM relevant_scopes rs
  )
  SELECT
    jsonb_object_agg(
      ec.provider_id || ':' || ec.payer_product_id,
      jsonb_build_object(
        'scopeId', ec.scope_id,
        'providerId', ec.provider_id,
        'payerProductId', ec.payer_product_id,
        'facilityId', ec.facility_id,
        'status', ec.final_status,
        'actionOwner', ec.final_owner,
        'effectiveDate', ec.final_effective_date,
        'clientSafeBlocker', ec.final_blocker,
        'payerReference', ec.payer_reference,
        'facilityCount', ec.facility_count,
        'proofCount', ec.proof_count,
        'reviewedAt', ec.published_at
      )
    ),
    COUNT(*) FILTER (WHERE ec.final_status = 'approved'),
    COUNT(*) FILTER (WHERE ec.final_owner = 'Payer' OR ec.final_status IN ('submitted', 'in_review')),
    COUNT(*) FILTER (WHERE ec.final_status = 'action_required' OR ec.final_owner = 'Client' OR ec.final_blocker IS NOT NULL)
  INTO v_cells, v_active_enrollments, v_pending_payer, v_actionable_blockers
  FROM evaluated_cells ec
  WHERE ec.row_num = 1;

  v_stats := jsonb_build_object(
    'totalClinicians', v_total_clinicians,
    'activeEnrollments', v_active_enrollments,
    'pendingPayerAction', v_pending_payer,
    'actionableClientBlockers', v_actionable_blockers
  );

  RETURN jsonb_build_object(
    'clinicians', COALESCE(v_clinicians, '[]'::jsonb),
    'products', COALESCE(v_products, '[]'::jsonb),
    'cells', COALESCE(v_cells, '{}'::jsonb),
    'stats', v_stats,
    'totalClinicians', v_total_clinicians,
    'page', p_page,
    'limit', p_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_enrollment_catalog(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_enrollment_explorer_page(uuid, uuid, text, uuid, uuid, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_enrollment_catalog(uuid, uuid, text, uuid),
  public.get_enrollment_explorer_page(uuid, uuid, text, uuid, uuid, text, text, text, integer, integer)
  TO service_role;

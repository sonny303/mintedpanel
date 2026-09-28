-- E6.14 report reads are service-only, recomputed from the live authorized
-- database snapshot. No report snapshot or export artifact is persisted.

CREATE OR REPLACE FUNCTION private.e614_revision_source_material(p_revisions jsonb)
RETURNS TABLE(
  scope_id uuid,
  revision_id uuid,
  source_valid boolean,
  source_material_digest text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog, private'
AS $$
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT request.scope_id, request.revision_id
    FROM jsonb_to_recordset(COALESCE(p_revisions, '[]'::jsonb))
      AS request(scope_id uuid, revision_id uuid)
    WHERE request.scope_id IS NOT NULL AND request.revision_id IS NOT NULL
  ), links AS MATERIALIZED (
    SELECT request.scope_id, request.revision_id,
      source.source_kind, source.source_id, source.source_fingerprint
    FROM requested request
    LEFT JOIN private.enrollment_scope_sources source
      ON source.scope_id = request.scope_id AND source.revision_id = request.revision_id
  ), source_refs AS MATERIALIZED (
    SELECT DISTINCT source_kind, source_id
    FROM links WHERE source_kind IS NOT NULL
  ), current_sources AS MATERIALIZED (
    SELECT reference.source_kind, reference.source_id,
      private.e613_source_snapshot(reference.source_kind, reference.source_id) AS snapshot
    FROM source_refs reference
  ), current_fingerprints AS MATERIALIZED (
    SELECT source_kind, source_id, snapshot,
      CASE WHEN snapshot IS NULL THEN NULL
        ELSE private.e613_source_fingerprint(snapshot) END AS fingerprint
    FROM current_sources
  ), validity AS MATERIALIZED (
    SELECT batch.scope_id, batch.revision_id, batch.source_valid
    FROM private.e613_revision_source_batch(COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_id', request.scope_id,
        'revision_id', request.revision_id)) FROM requested request
    ), '[]'::jsonb)) batch
  ), material AS (
    SELECT link.scope_id, link.revision_id,
      COALESCE(jsonb_agg(jsonb_build_object(
        'sourceKind', link.source_kind,
        'sourceId', link.source_id,
        'storedFingerprint', link.source_fingerprint,
        'present', current.snapshot IS NOT NULL,
        'currentFingerprint', current.fingerprint,
        'expiredAt', current.snapshot -> 'expired_at',
        'canonicalSnapshot', current.snapshot
        ) ORDER BY link.source_kind, link.source_id)
        FILTER (WHERE link.source_kind IS NOT NULL), '[]'::jsonb) AS reference_material
    FROM links link
    LEFT JOIN current_fingerprints current
      ON current.source_kind = link.source_kind AND current.source_id = link.source_id
    GROUP BY link.scope_id, link.revision_id
  )
  SELECT request.scope_id, request.revision_id,
    COALESCE(validity.source_valid, true),
    encode(sha256(convert_to(COALESCE(material.reference_material, '[]'::jsonb)::text, 'UTF8')), 'hex')
  FROM requested request
  LEFT JOIN validity USING (scope_id, revision_id)
  LEFT JOIN material USING (scope_id, revision_id)
$$;

CREATE OR REPLACE FUNCTION private.e614_report_snapshot(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_audience text,
  p_filters jsonb,
  p_known_codes text[],
  p_discipline_codes text[],
  p_cursor jsonb,
  p_mode text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog, public, private, auth'
AS $$
DECLARE
  v_context jsonb;
  v_group_ids uuid[] := '{}'::uuid[];
  v_group_id uuid;
  v_filter_group_id uuid;
  v_has_grants boolean := true;
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_org_id IS NULL OR p_audience IS NULL
     OR p_audience NOT IN ('staff', 'client') OR p_filters IS NULL
     OR jsonb_typeof(p_filters) IS DISTINCT FROM 'object' OR p_mode IS NULL
     OR p_mode NOT IN ('page', 'export')
     OR (p_cursor IS NOT NULL AND jsonb_typeof(p_cursor) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;

  -- Resolve and validate authority before consulting any caller filters.
  BEGIN
    v_context := public.resolve_enrollment_context(p_actor_user_id, p_audience, p_org_id);
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END;
  IF v_context ->> 'audience' IS DISTINCT FROM p_audience
     OR v_context ->> 'selectedOrgId' IS DISTINCT FROM p_org_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;

  IF p_audience = 'staff' THEN
    PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
  ELSE
    SELECT COALESCE(array_agg((group_item ->> 'groupId')::uuid ORDER BY group_item ->> 'groupId'), '{}'::uuid[])
      INTO v_group_ids
      FROM jsonb_array_elements(COALESCE((
        SELECT client_org -> 'groups'
        FROM jsonb_array_elements(v_context -> 'clientOrgs') client_org
        WHERE client_org ->> 'orgId' = p_org_id::text
        LIMIT 1
      ), '[]'::jsonb)) group_item;
    v_has_grants := cardinality(v_group_ids) > 0;
    IF v_has_grants THEN
      PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, v_group_ids[1]);
    END IF;
  END IF;

  v_filter_group_id := NULLIF(p_filters ->> 'groupId', '')::uuid;
  IF v_filter_group_id IS NOT NULL THEN
    IF p_audience = 'client' AND NOT (v_filter_group_id = ANY(v_group_ids)) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
    END IF;
    IF p_audience = 'staff' THEN
      PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
    ELSE
      PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, v_filter_group_id);
    END IF;
  END IF;

  IF p_audience = 'client' AND NOT v_has_grants THEN
    RETURN jsonb_build_object(
      'accessState', 'no_grants', 'snapshotDigest', encode(sha256(convert_to('e614:no-grants', 'UTF8')), 'hex'),
      'sections', '[]'::jsonb, 'providers', '[]'::jsonb, 'records', '[]'::jsonb,
      'providerCount', 0, 'rowCount', 0, 'tooLarge', false, 'hasMore', false, 'nextCursorKey', NULL,
      'filterChoices', jsonb_build_object('groups', '[]'::jsonb, 'states', '[]'::jsonb,
        'facilities', '[]'::jsonb, 'products', '[]'::jsonb,
        'disciplines', jsonb_build_array('PT','PTA','OT','OTA','SLP','Other','Unknown'),
        'statuses', jsonb_build_array('not_started','in_progress','submitted','in_review',
          'action_required','approved','denied','not_pursuing','terminated','needs_verification'))
    );
  END IF;

  WITH authorized_groups AS MATERIALIZED (
    SELECT group_row.id, group_row.org_id, group_row.name, group_row.is_active
    FROM public.provider_groups group_row
    WHERE group_row.org_id = p_org_id
      AND (p_audience = 'staff' OR group_row.id = ANY(v_group_ids))
      AND (v_filter_group_id IS NULL OR group_row.id = v_filter_group_id)
  ), scope_candidates AS MATERIALIZED (
    SELECT scope.id AS scope_id, scope.org_id, scope.provider_id, scope.group_id,
      scope.payer_product_id, scope.payer_id, scope.facility_id, scope.state,
      revision.id AS revision_id, revision.cycle_no, revision.revision_no,
      revision.status AS revision_status, revision.intake_date, revision.complete_to_submit_date,
      revision.submitted_date, revision.payer_acknowledged_date, revision.approved_date,
      revision.effective_date, revision.termination_date, revision.payer_reference,
      revision.client_safe_blocker, revision.action_owner, revision.retro_status,
      revision.retro_days, revision.retro_date, revision.retro_basis, revision.observed_at,
      revision.created_at AS revision_created_at,
      (revision.id = scope.current_revision_id) AS is_current,
      summary.id AS summary_id, summary.published_status, summary.client_safe_blocker AS summary_blocker,
      summary.action_owner AS summary_owner, summary.published_at,
      summary.revision_id AS summary_revision_id,
      EXISTS (SELECT 1 FROM private.publication_events event
        WHERE event.summary_publication_id = summary.id AND event.event_type = 'publication_revoked') AS summary_revoked,
      COALESCE(proof_info.supported_fields, '{}'::text[]) AS supported_fields,
      proof_info.active_proofs,
      proof_info.proof_material,
      to_jsonb(revision) - ARRAY['org_id','scope_id','created_by','staff_note'] AS safe_revision_material,
      group_row.name AS group_name, product.display_name AS product_name,
      payer.name AS payer_name, facility.name AS facility_name,
      provider.first_name, provider.last_name, provider.npi, provider.taxonomy_code,
      provider.status AS provider_status, provider.reference_only, provider.verification_state,
      COALESCE(provider.is_test_provider, false) AS is_test_provider
    FROM private.enrollment_scopes scope
    JOIN authorized_groups group_row ON group_row.id = scope.group_id
    JOIN private.enrollment_scope_revisions revision
      ON revision.scope_id = scope.id AND revision.org_id = scope.org_id
    LEFT JOIN LATERAL (
      SELECT publication.* FROM private.enrollment_summary_publications publication
      WHERE publication.scope_id = scope.id
        AND (COALESCE((p_filters ->> 'historical')::boolean, false)
          OR NOT EXISTS (SELECT 1 FROM private.publication_events event
            WHERE event.summary_publication_id = publication.id
              AND event.event_type = 'publication_revoked'))
      ORDER BY CASE WHEN EXISTS (SELECT 1
          FROM private.enrollment_summary_publications active_publication
          WHERE active_publication.scope_id = scope.id
            AND NOT EXISTS (SELECT 1 FROM private.publication_events revoked
              WHERE revoked.summary_publication_id = active_publication.id
                AND revoked.event_type = 'publication_revoked'))
          AND NOT EXISTS (SELECT 1 FROM private.publication_events event
            WHERE event.summary_publication_id = publication.id
              AND event.event_type = 'publication_revoked') THEN 0 ELSE 1 END,
        publication.published_at DESC, publication.id DESC LIMIT 1
    ) summary ON true
    LEFT JOIN LATERAL (
      WITH valid_proofs AS MATERIALIZED (
        SELECT proof.*, document.expiration_date, document.file_name
        FROM private.enrollment_proof_publications proof
        JOIN public.provider_documents document ON document.id = proof.document_version_id
        WHERE proof.scope_id = scope.id AND proof.revision_id = revision.id
          AND NOT EXISTS (SELECT 1 FROM private.publication_events event
            WHERE event.proof_publication_id = proof.id AND event.event_type = 'publication_revoked')
          AND (document.expiration_date IS NULL OR document.expiration_date >= CURRENT_DATE)
          AND (proof.evidence_kind <> 'license_psv' OR document.expiration_date >= CURRENT_DATE)
          AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
            WHERE successor.supersedes_document_id = document.id)
      )
      SELECT COALESCE((SELECT array_agg(DISTINCT field.field ORDER BY field.field)
        FROM valid_proofs proof
        CROSS JOIN LATERAL unnest(proof.supported_fields) field(field)), '{}'::text[]) AS supported_fields,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'publicationId', proof.id, 'documentVersionId', proof.document_version_id,
          'evidenceKind', proof.evidence_kind, 'supportedFields', proof.supported_fields,
          'publishedAt', proof.published_at, 'expirationDate', proof.expiration_date,
          'fileName', proof.file_name
        ) ORDER BY proof.published_at DESC, proof.id DESC) FROM valid_proofs proof), '[]'::jsonb) AS active_proofs,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'publicationId', proof.id, 'documentVersionId', proof.document_version_id,
          'evidenceKind', proof.evidence_kind, 'supportedFields', proof.supported_fields,
          'sha256', proof.sha256, 'publishedAt', proof.published_at,
          'expirationDate', proof.expiration_date
        ) ORDER BY proof.published_at DESC, proof.id DESC) FROM valid_proofs proof), '[]'::jsonb) AS proof_material
    ) proof_info ON true
    JOIN public.providers provider ON provider.id = scope.provider_id AND provider.org_id = scope.org_id
    JOIN private.payer_products product ON product.id = scope.payer_product_id AND product.payer_id = scope.payer_id
    JOIN public.payers payer ON payer.id = scope.payer_id
      AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
    JOIN public.facilities facility ON facility.id = scope.facility_id AND facility.org_id = scope.org_id
    WHERE scope.org_id = p_org_id
      AND (NULLIF(p_filters ->> 'state', '') IS NULL OR scope.state = upper(p_filters ->> 'state'))
      AND (NULLIF(p_filters ->> 'facilityId', '') IS NULL OR scope.facility_id = (p_filters ->> 'facilityId')::uuid)
      AND (NULLIF(p_filters ->> 'productId', '') IS NULL OR scope.payer_product_id = (p_filters ->> 'productId')::uuid)
      AND (p_audience = 'staff' OR NOT COALESCE(provider.is_test_provider, false))
      AND revision.id = scope.current_revision_id
      AND (p_audience = 'staff' OR summary.id IS NOT NULL)
      AND (p_audience = 'staff' OR NOT COALESCE(
        EXISTS (SELECT 1 FROM private.publication_events event
          WHERE event.summary_publication_id = summary.id AND event.event_type = 'publication_revoked'), false)
        OR COALESCE((p_filters ->> 'historical')::boolean, false))
  ), source_batch AS MATERIALIZED (
    SELECT * FROM private.e614_revision_source_material(COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_id', source_candidate.scope_id,
        'revision_id', source_candidate.revision_id))
      FROM (SELECT DISTINCT scope_id, revision_id FROM scope_candidates) source_candidate
    ), '[]'::jsonb))
  ), scope_rows AS MATERIALIZED (
    SELECT candidate.*,
      COALESCE(source.source_valid, true) AS source_valid,
      COALESCE(source.source_material_digest,
        encode(sha256(convert_to('[]', 'UTF8')), 'hex')) AS source_material_digest
    FROM scope_candidates candidate
    LEFT JOIN source_batch source
      ON source.scope_id = candidate.scope_id AND source.revision_id = candidate.revision_id
  ), projections AS MATERIALIZED (
    SELECT candidate.*,
      CASE
        WHEN p_audience = 'staff' AND candidate.is_current
          AND (candidate.summary_id IS NULL
            OR candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id) THEN 'draft'
        WHEN candidate.summary_id IS NULL THEN 'draft'
        WHEN candidate.summary_revoked THEN 'retracted'
        WHEN NOT candidate.is_current THEN 'superseded'
        WHEN candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id
          AND COALESCE((p_filters ->> 'historical')::boolean, false) THEN 'superseded'
        WHEN candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id THEN 'stale'
        WHEN NOT candidate.source_valid THEN 'stale'
        WHEN candidate.revision_status = 'approved' AND NOT (
          'enrollment_status' = ANY(candidate.supported_fields)
          AND 'product_id' = ANY(candidate.supported_fields)
          AND 'facility_id' = ANY(candidate.supported_fields)) THEN 'stale'
        WHEN candidate.effective_date IS NOT NULL
          AND NOT ('effective_date' = ANY(candidate.supported_fields)) THEN 'stale'
        WHEN candidate.retro_status <> 'unknown'
          AND NOT ('retro_status' = ANY(candidate.supported_fields)) THEN 'stale'
        WHEN candidate.retro_status = 'documented' AND candidate.retro_days IS NOT NULL
          AND NOT ('retro_days' = ANY(candidate.supported_fields)) THEN 'stale'
        WHEN candidate.retro_status = 'documented' AND candidate.retro_date IS NOT NULL
          AND NOT ('retro_date' = ANY(candidate.supported_fields)) THEN 'stale'
        ELSE 'published'
      END AS publication_state,
      CASE
        WHEN p_audience = 'staff' AND candidate.is_current
          AND (candidate.summary_id IS NULL
            OR candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id)
          THEN candidate.revision_status
        WHEN NOT candidate.source_valid
          OR (candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id
            AND NOT COALESCE((p_filters ->> 'historical')::boolean, false))
          OR (candidate.revision_status = 'approved' AND NOT (
            'enrollment_status' = ANY(candidate.supported_fields)
            AND 'product_id' = ANY(candidate.supported_fields)
            AND 'facility_id' = ANY(candidate.supported_fields)))
          OR (candidate.effective_date IS NOT NULL AND NOT ('effective_date' = ANY(candidate.supported_fields)))
          OR (candidate.retro_status <> 'unknown' AND NOT ('retro_status' = ANY(candidate.supported_fields)))
          OR (candidate.retro_status = 'documented' AND candidate.retro_days IS NOT NULL
            AND NOT ('retro_days' = ANY(candidate.supported_fields)))
          OR (candidate.retro_status = 'documented' AND candidate.retro_date IS NOT NULL
            AND NOT ('retro_date' = ANY(candidate.supported_fields)))
          THEN 'needs_verification'
        WHEN candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id
          THEN candidate.published_status
        ELSE COALESCE(candidate.published_status, candidate.revision_status)
      END AS projected_status,
      jsonb_build_object(
        'scopeId', candidate.scope_id, 'revisionId', candidate.revision_id,
        'current', candidate.is_current, 'sourceValid', candidate.source_valid,
        'sourceMaterialDigest', candidate.source_material_digest,
        'sourceLinks', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'sourceKind', source.source_kind, 'sourceId', source.source_id,
          'storedFingerprint', source.source_fingerprint,
          'sourceSnapshot', source.source_snapshot
        ) ORDER BY source.source_kind, source.source_id), '[]'::jsonb)
          FROM private.enrollment_scope_sources source
          WHERE source.scope_id = candidate.scope_id AND source.revision_id = candidate.revision_id),
        'revision', candidate.safe_revision_material,
        'summary', jsonb_build_object('id', candidate.summary_id,
          'revisionId', candidate.summary_revision_id,
          'status', candidate.published_status, 'revoked', candidate.summary_revoked,
          'publishedAt', candidate.published_at),
        'proofs', COALESCE(candidate.proof_material, '[]'::jsonb),
        'publicationState', CASE
          WHEN p_audience = 'staff' AND candidate.is_current
            AND (candidate.summary_id IS NULL
              OR candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id) THEN 'draft'
          WHEN candidate.summary_id IS NULL THEN 'draft'
          WHEN candidate.summary_revoked THEN 'retracted'
          WHEN NOT candidate.is_current THEN 'superseded'
          WHEN NOT candidate.source_valid THEN 'stale'
          WHEN candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id
            AND COALESCE((p_filters ->> 'historical')::boolean, false) THEN 'superseded'
          WHEN candidate.summary_revision_id IS DISTINCT FROM candidate.revision_id THEN 'stale'
          ELSE 'published' END,
        'labels', jsonb_build_array(candidate.group_name, candidate.payer_name,
          candidate.product_name, candidate.state, candidate.facility_name)
      ) AS digest_material
    FROM scope_rows candidate
  ), section_coordinates AS MATERIALIZED (
    SELECT target.group_id, target.state
    FROM private.group_product_targets target
    JOIN authorized_groups group_row ON group_row.id = target.group_id AND group_row.org_id = target.org_id
    JOIN private.payer_products product ON product.id = target.payer_product_id AND product.payer_id = target.payer_id
    JOIN public.payers payer ON payer.id = target.payer_id AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
    WHERE target.org_id = p_org_id AND target.is_active AND product.is_active
      AND (NULLIF(p_filters ->> 'state', '') IS NULL OR target.state = upper(p_filters ->> 'state'))
      AND (NULLIF(p_filters ->> 'productId', '') IS NULL OR target.payer_product_id = (p_filters ->> 'productId')::uuid)
    UNION
    SELECT projection.group_id, projection.state
    FROM projections projection
    WHERE (projection.summary_id IS NOT NULL OR (p_audience = 'staff' AND projection.is_current))
      AND (p_audience = 'staff' OR NOT projection.summary_revoked
        OR COALESCE((p_filters ->> 'historical')::boolean, false))
  ), section_columns AS MATERIALIZED (
    SELECT section.group_id, section.state, product.id AS product_id,
      payer.name AS payer_name, product.display_name AS product_name
    FROM section_coordinates section
    JOIN authorized_groups group_row ON group_row.id = section.group_id
    JOIN private.group_product_targets target
      ON target.org_id = p_org_id AND target.group_id = section.group_id
       AND target.state = section.state AND target.is_active
    JOIN private.payer_products product ON product.id = target.payer_product_id AND product.payer_id = target.payer_id
    JOIN public.payers payer ON payer.id = target.payer_id
      AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
    WHERE target.is_active AND product.is_active
      AND (NULLIF(p_filters ->> 'productId', '') IS NULL OR product.id = (p_filters ->> 'productId')::uuid)
    UNION
    SELECT projection.group_id, projection.state, projection.payer_product_id,
      projection.payer_name, projection.product_name
    FROM projections projection
    WHERE (projection.summary_id IS NOT NULL OR (p_audience = 'staff' AND projection.is_current))
      AND (p_audience = 'staff' OR NOT projection.summary_revoked
        OR COALESCE((p_filters ->> 'historical')::boolean, false))
      AND (NULLIF(p_filters ->> 'productId', '') IS NULL OR projection.payer_product_id = (p_filters ->> 'productId')::uuid)
  ), section_json AS MATERIALIZED (
    SELECT section.group_id, section.state,
      section.group_id::text || ':' || section.state AS section_key,
      group_row.name AS group_name,
      COALESCE(jsonb_agg(jsonb_build_object(
        'key', section.group_id::text || ':' || section.state || ':' || product_column.product_id::text,
        'productId', product_column.product_id, 'payerLabel', product_column.payer_name,
        'productLabel', product_column.product_name
      ) ORDER BY lower(product_column.payer_name), lower(product_column.product_name), product_column.product_id), '[]'::jsonb) AS columns
    FROM (SELECT DISTINCT group_id, state FROM section_columns) section
    JOIN authorized_groups group_row ON group_row.id = section.group_id
    JOIN section_columns product_column ON product_column.group_id = section.group_id
      AND product_column.state = section.state
    GROUP BY section.group_id, section.state, group_row.name
  ), sections_result AS MATERIALIZED (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', section.section_key, 'groupId', section.group_id, 'groupLabel', section.group_name,
      'state', section.state, 'columns', section.columns
    ) ORDER BY lower(section.group_name), section.state, section.group_id), '[]'::jsonb) AS value
    FROM section_json section
  ), active_cohort AS MATERIALIZED (
    SELECT DISTINCT provider.id AS provider_id, assignment.group_id
    FROM public.providers provider
    JOIN public.provider_group_assignments assignment
      ON assignment.provider_id = provider.id AND assignment.org_id = p_org_id
       AND (assignment.start_date IS NULL OR assignment.start_date <= CURRENT_DATE)
       AND (assignment.end_date IS NULL OR assignment.end_date >= CURRENT_DATE)
    JOIN authorized_groups group_row ON group_row.id = assignment.group_id
    WHERE provider.org_id = p_org_id AND provider.status = 'active'
      AND provider.verification_state = 'verified' AND NOT provider.reference_only
      AND NOT COALESCE(provider.is_test_provider, false)
      AND (NULLIF(p_filters ->> 'facilityId', '') IS NULL OR EXISTS (
        SELECT 1 FROM public.provider_facility_assignments pfa
        JOIN public.facilities facility ON facility.id = pfa.facility_id AND facility.org_id = pfa.org_id
        WHERE pfa.org_id = p_org_id AND pfa.provider_id = provider.id
          AND pfa.facility_id = (p_filters ->> 'facilityId')::uuid
          AND (pfa.start_date IS NULL OR pfa.start_date <= CURRENT_DATE)
          AND facility.group_id = assignment.group_id
          AND (NULLIF(p_filters ->> 'state', '') IS NULL OR facility.state = upper(p_filters ->> 'state'))
      ) OR EXISTS (SELECT 1 FROM projections projection
        WHERE projection.provider_id = provider.id AND projection.group_id = assignment.group_id
          AND projection.facility_id = (p_filters ->> 'facilityId')::uuid))
  ), cohort_sections AS MATERIALIZED (
    SELECT cohort.provider_id, section.group_id, section.state
    FROM active_cohort cohort
    JOIN section_json section ON section.group_id = cohort.group_id
    WHERE (NULLIF(p_filters ->> 'state', '') IS NULL OR section.state = upper(p_filters ->> 'state'))
      AND (NULLIF(p_filters ->> 'facilityId', '') IS NULL OR EXISTS (
        SELECT 1 FROM public.provider_facility_assignments pfa
        JOIN public.facilities facility ON facility.id = pfa.facility_id AND facility.org_id = pfa.org_id
        WHERE pfa.org_id = p_org_id AND pfa.provider_id = cohort.provider_id
          AND pfa.facility_id = (p_filters ->> 'facilityId')::uuid
          AND (pfa.start_date IS NULL OR pfa.start_date <= CURRENT_DATE)
          AND facility.group_id = section.group_id AND facility.state = section.state
      ) OR EXISTS (SELECT 1 FROM projections projection
        WHERE projection.provider_id = cohort.provider_id
          AND projection.group_id = section.group_id AND projection.state = section.state
          AND projection.facility_id = (p_filters ->> 'facilityId')::uuid))
    UNION
    SELECT projection.provider_id, projection.group_id, projection.state
    FROM projections projection
    WHERE (p_audience = 'staff' OR NOT projection.is_test_provider)
  ), provider_sections AS MATERIALIZED (
    SELECT DISTINCT cohort.provider_id, cohort.group_id, cohort.state,
      cohort.group_id::text || ':' || cohort.state AS section_key
    FROM cohort_sections cohort
  ), candidate_providers AS MATERIALIZED (
    SELECT provider.id AS provider_id, provider.first_name, provider.last_name, provider.npi,
      provider.taxonomy_code, provider.status, provider.reference_only, provider.verification_state,
      COALESCE(provider.is_test_provider, false) AS is_test_provider,
      COALESCE(jsonb_agg(DISTINCT provider_section.section_key ORDER BY provider_section.section_key)
        FILTER (WHERE provider_section.section_key IS NOT NULL), '[]'::jsonb) AS section_keys
    FROM public.providers provider
    LEFT JOIN provider_sections provider_section ON provider_section.provider_id = provider.id
    WHERE provider.org_id = p_org_id
      AND (p_audience = 'staff' OR NOT COALESCE(provider.is_test_provider, false))
      AND (provider_section.provider_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM active_cohort cohort WHERE cohort.provider_id = provider.id))
      AND (NULLIF(p_filters ->> 'state', '') IS NULL OR EXISTS (
        SELECT 1 FROM cohort_sections section
        WHERE section.provider_id = provider.id AND section.state = upper(p_filters ->> 'state')))
      AND (NULLIF(p_filters ->> 'productId', '') IS NULL OR
        EXISTS (SELECT 1 FROM projections projection
          WHERE projection.provider_id = provider.id
            AND projection.payer_product_id = (p_filters ->> 'productId')::uuid)
        OR EXISTS (
          SELECT 1 FROM section_columns product_column
          JOIN active_cohort cohort ON cohort.group_id = product_column.group_id
            AND cohort.provider_id = provider.id
          WHERE product_column.product_id = (p_filters ->> 'productId')::uuid))
    GROUP BY provider.id
  ),
  selected_providers AS MATERIALIZED (
    SELECT candidate.*
    FROM candidate_providers candidate
    WHERE (
      NULLIF(p_filters ->> 'discipline', '') IS NULL
      OR (p_filters ->> 'discipline' = 'Unknown' AND (
        NULLIF(upper(btrim(candidate.taxonomy_code)), '') IS NULL
        OR NOT (upper(btrim(candidate.taxonomy_code)) = ANY(COALESCE(p_known_codes, '{}'::text[])))
      ))
      OR (p_filters ->> 'discipline' <> 'Unknown' AND
        upper(btrim(candidate.taxonomy_code)) = ANY(COALESCE(p_discipline_codes, '{}'::text[])))
    )
      AND (NULLIF(p_filters ->> 'search', '') IS NULL OR
        concat_ws(' ', candidate.first_name, candidate.last_name, candidate.npi) ILIKE '%' || (p_filters ->> 'search') || '%')
      AND (NULLIF(p_filters ->> 'status', '') IS NULL OR EXISTS (
        SELECT 1 FROM projections projection
        WHERE projection.provider_id = candidate.provider_id
          AND p_filters ->> 'status' = projection.projected_status
      ))
  ), facility_choices AS MATERIALIZED (
    SELECT DISTINCT facility.id, facility.name, facility.group_id, facility.state
    FROM public.facilities facility
    JOIN authorized_groups group_row ON group_row.id = facility.group_id
    WHERE facility.org_id = p_org_id AND (facility.is_active OR EXISTS (
      SELECT 1 FROM projections projection WHERE projection.facility_id = facility.id))
  ), product_choices AS MATERIALIZED (
    SELECT DISTINCT product_column.product_id, product_column.payer_name, product_column.product_name
    FROM section_columns product_column
  ), filter_choices AS MATERIALIZED (
    SELECT jsonb_build_object(
      'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', group_row.id, 'label', group_row.name)
        ORDER BY lower(group_row.name), group_row.id) FROM authorized_groups group_row), '[]'::jsonb),
      'states', COALESCE((SELECT jsonb_agg(DISTINCT section.state ORDER BY section.state)
        FROM section_json section), '[]'::jsonb),
      'facilities', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', facility.id, 'label', facility.name, 'groupId', facility.group_id, 'state', facility.state)
        ORDER BY lower(facility.name), facility.group_id, facility.state, facility.id)
        FROM facility_choices facility), '[]'::jsonb),
      'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', product.product_id, 'payerLabel', product.payer_name, 'label', product.product_name)
        ORDER BY lower(product.payer_name), lower(product.product_name), product.product_id)
        FROM product_choices product), '[]'::jsonb),
      'disciplines', jsonb_build_array('PT','PTA','OT','OTA','SLP','Other','Unknown'),
      'statuses', jsonb_build_array('not_started','in_progress','submitted','in_review',
        'action_required','approved','denied','not_pursuing','terminated','needs_verification')
    ) AS value
  ), provider_material AS MATERIALIZED (
    SELECT selected.provider_id, selected.first_name, selected.last_name,
      jsonb_build_object('providerId', selected.provider_id, 'firstName', selected.first_name,
        'lastName', selected.last_name, 'npi', selected.npi, 'taxonomyCode', selected.taxonomy_code,
        'status', selected.status, 'referenceOnly', selected.reference_only,
        'verificationState', selected.verification_state, 'isTestProvider', selected.is_test_provider,
        'sectionKeys', selected.section_keys,
        'groupAssignments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'assignmentId', assignment.id, 'groupId', assignment.group_id,
          'startDate', assignment.start_date,
          'isPrimary', assignment.is_primary
        ) ORDER BY assignment.group_id, assignment.id)
          FROM public.provider_group_assignments assignment
          JOIN authorized_groups group_row ON group_row.id = assignment.group_id
          WHERE assignment.org_id = p_org_id AND assignment.provider_id = selected.provider_id), '[]'::jsonb),
        'facilityAssignments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'assignmentId', assignment.id, 'facilityId', facility.id,
          'facilityName', facility.name, 'groupId', facility.group_id,
          'state', facility.state, 'active', facility.is_active,
          'startDate', assignment.start_date, 'isPrimary', assignment.is_primary
        ) ORDER BY facility.group_id, facility.state, facility.id, assignment.id)
          FROM public.provider_facility_assignments assignment
          JOIN public.facilities facility ON facility.id = assignment.facility_id
            AND facility.org_id = assignment.org_id
          JOIN authorized_groups group_row ON group_row.id = facility.group_id
          WHERE assignment.org_id = p_org_id AND assignment.provider_id = selected.provider_id), '[]'::jsonb),
        'scopes', COALESCE((SELECT jsonb_agg(projection.digest_material
          ORDER BY projection.scope_id, projection.revision_created_at DESC, projection.revision_id)
          FROM projections projection WHERE projection.provider_id = selected.provider_id), '[]'::jsonb)
      ) AS material
    FROM selected_providers selected
  ), snapshot_digest AS MATERIALIZED (
    SELECT encode(sha256(convert_to(jsonb_build_object(
        'filters', p_filters,
      'knownTaxonomyCodes', COALESCE(p_known_codes, '{}'::text[]),
      'selectedDisciplineCodes', COALESCE(p_discipline_codes, '{}'::text[]),
      'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', group_row.id, 'name', group_row.name, 'active', group_row.is_active)
        ORDER BY group_row.id) FROM authorized_groups group_row), '[]'::jsonb),
      'sections', sections_result.value,
      'filterChoices', filter_choices.value,
      'targetCatalog', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'targetId', target.id, 'groupId', target.group_id, 'state', target.state,
        'targetActive', target.is_active, 'productId', product.id,
        'productKey', product.product_key, 'productLabel', product.display_name,
        'productActive', product.is_active, 'payerId', payer.id,
        'payerLabel', payer.name, 'payerActive', payer.is_active
      ) ORDER BY target.group_id, target.state, product.id, target.id)
        FROM private.group_product_targets target
        JOIN authorized_groups group_row ON group_row.id = target.group_id AND group_row.org_id = target.org_id
        JOIN private.payer_products product ON product.id = target.payer_product_id AND product.payer_id = target.payer_id
        JOIN public.payers payer ON payer.id = target.payer_id
          AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
        WHERE target.org_id = p_org_id
          AND (NULLIF(p_filters ->> 'state', '') IS NULL OR target.state = upper(p_filters ->> 'state'))
          AND (NULLIF(p_filters ->> 'productId', '') IS NULL OR target.payer_product_id = (p_filters ->> 'productId')::uuid)
      ), '[]'::jsonb),
      'facilityChoices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', facility.id, 'name', facility.name, 'groupId', facility.group_id,
        'state', facility.state, 'active', facility.is_active
      ) ORDER BY facility.group_id, facility.state, facility.id)
        FROM public.facilities facility
        JOIN authorized_groups group_row ON group_row.id = facility.group_id
        WHERE facility.org_id = p_org_id), '[]'::jsonb),
      'providers', COALESCE((SELECT jsonb_agg(provider_material.material
        ORDER BY lower(provider_material.last_name), lower(provider_material.first_name), provider_material.provider_id)
        FROM provider_material), '[]'::jsonb)
    )::text, 'UTF8')), 'hex') AS value
    FROM sections_result CROSS JOIN filter_choices
  ), ranked_providers AS MATERIALIZED (
    SELECT selected.*, row_number() OVER (
      ORDER BY lower(selected.last_name), lower(selected.first_name), selected.provider_id) AS row_number
    FROM selected_providers selected
    WHERE p_mode = 'export' OR p_cursor IS NULL OR
      (lower(selected.last_name), lower(selected.first_name), selected.provider_id) >
      (lower(COALESCE(p_cursor ->> 'lastName', '')),
       lower(COALESCE(p_cursor ->> 'firstName', '')),
       NULLIF(p_cursor ->> 'providerId', '')::uuid)
  ), page_providers AS MATERIALIZED (
    SELECT * FROM ranked_providers
    WHERE p_mode = 'export' OR row_number <= 51
  ), page_scope_rows AS MATERIALIZED (
    SELECT projection.* FROM projections projection
    JOIN page_providers provider ON provider.provider_id = projection.provider_id
    WHERE NULLIF(p_filters ->> 'status', '') IS NULL
      OR projection.projected_status = p_filters ->> 'status'
  ), scope_cells AS MATERIALIZED (
    SELECT row.provider_id,
      row.group_id::text || ':' || row.state || ':' || row.payer_product_id::text AS cell_key,
      row.group_id::text || ':' || row.state AS section_key,
      row.payer_product_id AS product_id,
      CASE WHEN bool_or(row.projected_status = 'needs_verification') THEN 'needs_verification'
        WHEN bool_or(row.publication_state = 'draft') THEN 'staff_draft' ELSE 'published' END AS cell_state,
      jsonb_agg(jsonb_build_object(
        'sectionKey', row.group_id::text || ':' || row.state,
        'scopeId', row.scope_id, 'facilityId', row.facility_id,
        'facilityLabel', row.facility_name, 'publicationState', row.publication_state,
        'historical', COALESCE((p_filters ->> 'historical')::boolean, false)
          AND (row.summary_revision_id IS DISTINCT FROM row.revision_id OR row.summary_revoked),
        'status', row.projected_status
      ) ORDER BY lower(row.facility_name), row.facility_id, row.revision_created_at DESC) AS locations
    FROM page_scope_rows row
    GROUP BY row.provider_id, row.group_id, row.state, row.payer_product_id
  ), provider_output AS MATERIALIZED (
    SELECT provider.provider_id,
      jsonb_build_object(
        'providerId', provider.provider_id,
        'name', concat_ws(' ', provider.first_name, provider.last_name),
        'npi', provider.npi, 'taxonomyCode', provider.taxonomy_code,
        'status', provider.status, 'referenceOnly', provider.reference_only,
        'verificationState', provider.verification_state,
        'sectionKeys', provider.section_keys,
        'cells', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'key', cell.cell_key, 'sectionKey', cell.section_key,
          'productId', cell.product_id, 'state', cell.cell_state,
          'locationCount', jsonb_array_length(cell.locations), 'locations', cell.locations
        ) ORDER BY cell.section_key, cell.product_id) FROM scope_cells cell
          WHERE cell.provider_id = provider.provider_id), '[]'::jsonb)
      ) AS item
    FROM page_providers provider
    WHERE provider.row_number <= 50 OR p_mode = 'export'
  ), record_rows AS MATERIALIZED (
    SELECT row_number() OVER (
      ORDER BY lower(provider.last_name), lower(provider.first_name), provider.provider_id,
        projection.group_id, projection.state, projection.payer_product_id,
        projection.facility_id, projection.revision_created_at DESC, projection.revision_id
    ) AS row_number,
      jsonb_build_object(
        'providerName', concat_ws(' ', provider.first_name, provider.last_name),
        'npi', provider.npi,
        'taxonomyCode', provider.taxonomy_code,
        'groupLabel', projection.group_name, 'payerLabel', projection.payer_name,
        'productLabel', projection.product_name, 'state', projection.state,
        'facilityLabel', projection.facility_name,
        'status', projection.projected_status,
        'publicationState', projection.publication_state,
        'intakeDate', CASE WHEN projection.publication_state IN ('published', 'draft') THEN projection.intake_date END,
        'completeToSubmitDate', CASE WHEN projection.publication_state IN ('published', 'draft') THEN projection.complete_to_submit_date END,
        'submittedDate', CASE WHEN projection.publication_state IN ('published', 'draft') THEN projection.submitted_date END,
        'payerAcknowledgedDate', CASE WHEN projection.publication_state IN ('published', 'draft') THEN projection.payer_acknowledged_date END,
        'approvedDate', CASE WHEN projection.publication_state = 'draft'
          OR (projection.publication_state = 'published'
            AND 'approved_date' = ANY(projection.supported_fields)) THEN projection.approved_date END,
        'effectiveDate', CASE WHEN projection.publication_state = 'draft'
          OR (projection.publication_state = 'published'
            AND 'effective_date' = ANY(projection.supported_fields)) THEN projection.effective_date END,
        'terminationDate', CASE WHEN projection.publication_state = 'draft'
          OR (projection.publication_state = 'published'
            AND 'termination_date' = ANY(projection.supported_fields)) THEN projection.termination_date END,
        'cycleNo', CASE WHEN projection.publication_state IN ('published', 'draft') THEN projection.cycle_no END,
        'payerReference', CASE WHEN projection.publication_state IN ('published', 'draft') THEN projection.payer_reference END,
        'retroType', CASE WHEN projection.publication_state IN ('published', 'draft')
          THEN projection.retro_status ELSE 'unknown' END,
        'retroValue', CASE WHEN projection.publication_state = 'draft'
          AND projection.retro_status = 'documented' AND projection.retro_days IS NOT NULL
          THEN projection.retro_days::text
          WHEN projection.publication_state = 'draft'
            AND projection.retro_status = 'documented' AND projection.retro_date IS NOT NULL
          THEN projection.retro_date::text
          WHEN projection.publication_state = 'published' AND projection.retro_status = 'documented'
            AND 'retro_days' = ANY(projection.supported_fields) THEN projection.retro_days::text
          WHEN projection.publication_state = 'published' AND projection.retro_status = 'documented'
            AND 'retro_date' = ANY(projection.supported_fields)
          THEN projection.retro_date::text END,
        'retroBasis', CASE WHEN projection.publication_state = 'draft'
          OR (projection.publication_state = 'published' AND 'retro_status' = ANY(projection.supported_fields))
          THEN projection.retro_basis END,
        'clientSafeBlocker', CASE WHEN p_audience = 'staff'
            AND projection.is_current AND projection.publication_state = 'draft'
          THEN projection.client_safe_blocker
          WHEN projection.summary_id IS NOT NULL
          THEN projection.summary_blocker ELSE projection.client_safe_blocker END,
        'owner', CASE WHEN p_audience = 'staff'
            AND projection.is_current AND projection.publication_state = 'draft'
          THEN projection.action_owner
          WHEN projection.summary_id IS NOT NULL
          THEN projection.summary_owner ELSE projection.action_owner END,
        'reviewedAsOf', projection.published_at,
        'proofLabel', CASE WHEN projection.publication_state = 'published'
          AND projection.projected_status <> 'needs_verification'
          THEN projection.active_proofs -> 0 ->> 'fileName' END,
        'proofType', CASE WHEN projection.publication_state = 'published'
          AND projection.projected_status <> 'needs_verification'
          THEN projection.active_proofs -> 0 ->> 'evidenceKind' END,
        'authenticatedReportUrl', '/reporting/enrollment-explorer'
      ) AS item
    FROM projections projection
    JOIN selected_providers provider ON provider.provider_id = projection.provider_id
    WHERE p_mode = 'export'
      AND (NULLIF(p_filters ->> 'status', '') IS NULL
        OR projection.projected_status = p_filters ->> 'status')
  ), filtered_counts AS MATERIALIZED (
    SELECT (SELECT count(*) FROM selected_providers)::integer AS provider_count,
      (SELECT count(*) FROM record_rows)::integer AS row_count
  )
  SELECT jsonb_build_object(
    'accessState', CASE WHEN (SELECT provider_count FROM filtered_counts) = 0 THEN 'empty_cohort' ELSE 'ready' END,
    'snapshotDigest', (SELECT value FROM snapshot_digest),
    'sections', sections_result.value,
    'filterChoices', filter_choices.value,
    'providers', CASE WHEN p_mode = 'page' THEN COALESCE((SELECT jsonb_agg(provider_output.item
      ORDER BY lower(page.last_name), lower(page.first_name), page.provider_id)
      FROM provider_output JOIN page_providers page USING (provider_id) WHERE page.row_number <= 50), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'records', CASE WHEN p_mode = 'export' AND (SELECT row_count FROM filtered_counts) <= 100000
      THEN COALESCE((SELECT jsonb_agg(record_rows.item ORDER BY record_rows.row_number) FROM record_rows), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'providerCount', (SELECT provider_count FROM filtered_counts),
    'rowCount', (SELECT row_count FROM filtered_counts),
    'tooLarge', p_mode = 'export' AND (SELECT row_count FROM filtered_counts) > 100000,
    'hasMore', p_mode = 'page' AND EXISTS (
      SELECT 1 FROM page_providers WHERE row_number = 51),
    'nextCursorKey', CASE WHEN p_mode = 'page' AND EXISTS (
      SELECT 1 FROM page_providers WHERE row_number = 51)
      THEN (SELECT jsonb_build_object('lastName', lower(page.last_name),
        'firstName', lower(page.first_name), 'providerId', page.provider_id)
        FROM page_providers page WHERE page.row_number = 50) ELSE NULL END
  ) INTO v_result
  FROM sections_result CROSS JOIN filter_choices;

  RETURN v_result;
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_report_snapshot(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_audience text,
  p_filters jsonb,
  p_known_codes text[],
  p_discipline_codes text[],
  p_cursor jsonb,
  p_mode text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog, public, private'
AS $$
  SELECT private.e614_report_snapshot(
    p_actor_user_id, p_org_id, p_audience, p_filters,
    p_known_codes, p_discipline_codes, p_cursor, p_mode
  )
$$;

REVOKE ALL ON FUNCTION private.e614_revision_source_material(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e614_report_snapshot(uuid, uuid, text, jsonb, text[], text[], jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.e614_revision_source_material(jsonb),
  private.e614_report_snapshot(uuid, uuid, text, jsonb, text[], text[], jsonb, text) TO service_role;

REVOKE ALL ON FUNCTION public.get_enrollment_report_snapshot(uuid, uuid, text, jsonb, text[], text[], jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_enrollment_report_snapshot(uuid, uuid, text, jsonb, text[], text[], jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_enrollment_scope_history_page(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_audience text,
  p_scope_id uuid,
  p_cursor jsonb,
  p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog, public, private, auth'
AS $$
DECLARE
  v_context jsonb;
  v_scope private.enrollment_scopes%ROWTYPE;
  v_current_provider record;
  v_items jsonb;
  v_next jsonb;
  v_more boolean;
BEGIN
  IF p_actor_user_id IS NULL OR p_org_id IS NULL OR p_scope_id IS NULL
     OR p_audience IS NULL OR p_audience NOT IN ('staff', 'client')
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50
     OR (p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor) IS DISTINCT FROM 'object'
       OR p_cursor ->> 'createdAt' IS NULL OR p_cursor ->> 'revisionId' IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;

  BEGIN
    v_context := public.resolve_enrollment_context(p_actor_user_id, p_audience, p_org_id);
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END;
  IF v_context ->> 'audience' IS DISTINCT FROM p_audience
     OR v_context ->> 'selectedOrgId' IS DISTINCT FROM p_org_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;

  SELECT * INTO v_scope FROM private.enrollment_scopes scope
    WHERE scope.id = p_scope_id AND scope.org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, v_scope.group_id);
  SELECT provider.is_test_provider INTO v_current_provider
    FROM public.providers provider
    WHERE provider.id = v_scope.provider_id AND provider.org_id = p_org_id;
  IF p_audience = 'client' AND COALESCE(v_current_provider.is_test_provider, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
  END IF;
  IF p_audience = 'client' AND NOT EXISTS (
    SELECT 1 FROM private.enrollment_summary_publications publication
    WHERE publication.scope_id = p_scope_id AND publication.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
  END IF;

  WITH revision_rows AS MATERIALIZED (
    SELECT revision.*,
      revision.id = v_scope.current_revision_id AS is_current,
      summary.id AS summary_id, summary.published_status,
      summary.client_safe_blocker AS summary_blocker, summary.action_owner AS summary_owner,
      summary.published_at,
      EXISTS (SELECT 1 FROM private.publication_events event
        WHERE event.summary_publication_id = summary.id
          AND event.event_type = 'publication_revoked') AS summary_revoked
    FROM private.enrollment_scope_revisions revision
    LEFT JOIN LATERAL (
      SELECT publication.* FROM private.enrollment_summary_publications publication
      WHERE publication.scope_id = v_scope.id AND publication.revision_id = revision.id
      ORDER BY CASE WHEN EXISTS (SELECT 1 FROM private.publication_events event
          WHERE event.summary_publication_id = publication.id
            AND event.event_type = 'publication_revoked') THEN 1 ELSE 0 END,
        publication.published_at DESC, publication.id DESC LIMIT 1
    ) summary ON true
    WHERE revision.scope_id = v_scope.id AND revision.org_id = p_org_id
      AND (p_audience = 'staff' OR summary.id IS NOT NULL)
      AND (p_cursor IS NULL OR
        (revision.created_at, revision.id) <
        ((p_cursor ->> 'createdAt')::timestamptz, (p_cursor ->> 'revisionId')::uuid))
  ), page AS MATERIALIZED (
    SELECT candidate.*, row_number() OVER (ORDER BY candidate.created_at DESC, candidate.id DESC) AS page_no
    FROM revision_rows candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT p_limit + 1
  ), delivered AS MATERIALIZED (
    SELECT * FROM page WHERE page_no <= p_limit
  ), source_batch AS MATERIALIZED (
    SELECT * FROM private.e613_revision_source_batch(COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_id', revision.scope_id, 'revision_id', revision.id))
      FROM delivered revision
    ), '[]'::jsonb))
  ), revision_material AS MATERIALIZED (
    SELECT revision.*,
      COALESCE(source.source_valid, true) AS source_valid,
      COALESCE(proof_fields.supported_fields, '{}'::text[]) AS supported_fields,
      COALESCE(proof_fields.proofs, '[]'::jsonb) AS active_proofs,
      (revision.summary_revoked OR NOT revision.is_current OR NOT COALESCE(source.source_valid, true)) AS historical_shell
    FROM delivered revision
    LEFT JOIN source_batch source ON source.scope_id = revision.scope_id AND source.revision_id = revision.id
    LEFT JOIN LATERAL (
      SELECT COALESCE((SELECT array_agg(DISTINCT supported.field ORDER BY supported.field)
        FROM private.enrollment_proof_publications proof
        JOIN public.provider_documents document ON document.id = proof.document_version_id
        CROSS JOIN LATERAL unnest(proof.supported_fields) supported(field)
        WHERE proof.scope_id = revision.scope_id AND proof.revision_id = revision.id
          AND NOT EXISTS (SELECT 1 FROM private.publication_events event
            WHERE event.proof_publication_id = proof.id AND event.event_type = 'publication_revoked')
          AND (document.expiration_date IS NULL OR document.expiration_date >= CURRENT_DATE)
          AND (proof.evidence_kind <> 'license_psv' OR document.expiration_date >= CURRENT_DATE)
          AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
            WHERE successor.supersedes_document_id = document.id)), '{}'::text[]) AS supported_fields,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'publicationId', proof.id, 'evidenceKind', proof.evidence_kind,
          'supportedFields', proof.supported_fields, 'publishedAt', proof.published_at
        ) ORDER BY proof.published_at DESC, proof.id DESC)
          FROM private.enrollment_proof_publications proof
          JOIN public.provider_documents document ON document.id = proof.document_version_id
          WHERE proof.scope_id = revision.scope_id AND proof.revision_id = revision.id
            AND NOT EXISTS (SELECT 1 FROM private.publication_events event
              WHERE event.proof_publication_id = proof.id AND event.event_type = 'publication_revoked')
            AND (document.expiration_date IS NULL OR document.expiration_date >= CURRENT_DATE)
            AND (proof.evidence_kind <> 'license_psv' OR document.expiration_date >= CURRENT_DATE)
            AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
              WHERE successor.supersedes_document_id = document.id)), '[]'::jsonb) AS proofs
    ) proof_fields ON true
  ), client_status AS MATERIALIZED (
    SELECT revision.*,
      (revision.status = 'approved' AND NOT (
        'enrollment_status' = ANY(revision.supported_fields)
        AND 'product_id' = ANY(revision.supported_fields)
        AND 'facility_id' = ANY(revision.supported_fields)))
        OR (revision.effective_date IS NOT NULL AND NOT ('effective_date' = ANY(revision.supported_fields)))
        OR (revision.retro_status <> 'unknown' AND NOT ('retro_status' = ANY(revision.supported_fields)))
        OR (revision.retro_status = 'documented' AND revision.retro_days IS NOT NULL
          AND NOT ('retro_days' = ANY(revision.supported_fields)))
        OR (revision.retro_status = 'documented' AND revision.retro_date IS NOT NULL
          AND NOT ('retro_date' = ANY(revision.supported_fields))) AS missing_proof
    FROM revision_material revision
  ), items AS MATERIALIZED (
    SELECT revision.page_no,
      CASE WHEN p_audience = 'staff' THEN jsonb_build_object(
        'revisionId', revision.id, 'cycleNo', revision.cycle_no, 'revisionNo', revision.revision_no,
        'createdAt', revision.created_at, 'status', revision.status,
        'revision', to_jsonb(revision) - ARRAY['org_id','scope_id','created_by','page_no',
          'is_current','summary_id','published_status','summary_blocker','summary_owner',
          'published_at','summary_revoked','source_valid','supported_fields','active_proofs',
          'historical_shell','missing_proof'],
        'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'sourceKind', source.source_kind, 'sourceId', source.source_id,
          'sourceFingerprint', source.source_fingerprint, 'sourceSnapshot', source.source_snapshot
        ) ORDER BY source.source_kind, source.source_id)
          FROM private.enrollment_scope_sources source
          WHERE source.scope_id = revision.scope_id AND source.revision_id = revision.id), '[]'::jsonb),
        'publications', COALESCE((SELECT jsonb_agg(publication.item ORDER BY publication.published_at,
          publication.publication_id)
          FROM (
            SELECT jsonb_build_object('publicationId', summary.id, 'kind', 'summary',
              'state', CASE WHEN EXISTS (SELECT 1 FROM private.publication_events event
                  WHERE event.summary_publication_id = summary.id AND event.event_type = 'publication_revoked')
                THEN 'revoked' WHEN revision.id <> v_scope.current_revision_id THEN 'superseded'
                ELSE 'published' END,
              'publishedAt', summary.published_at) AS item,
              summary.published_at, summary.id AS publication_id
            FROM private.enrollment_summary_publications summary
            WHERE summary.scope_id = revision.scope_id AND summary.revision_id = revision.id
            UNION ALL
            SELECT jsonb_build_object('publicationId', proof.id, 'kind', 'proof',
              'state', CASE WHEN EXISTS (SELECT 1 FROM private.publication_events event
                  WHERE event.proof_publication_id = proof.id AND event.event_type = 'publication_revoked')
                THEN 'revoked' WHEN EXISTS (SELECT 1 FROM public.provider_documents successor
                  WHERE successor.supersedes_document_id = proof.document_version_id)
                THEN 'superseded'
                WHEN document.expiration_date < CURRENT_DATE
                  OR (proof.evidence_kind = 'license_psv' AND document.expiration_date IS NULL)
                THEN 'expired'
                WHEN revision.id <> v_scope.current_revision_id THEN 'superseded' ELSE 'published' END,
              'publishedAt', proof.published_at, 'evidenceKind', proof.evidence_kind,
              'supportedFields', proof.supported_fields) AS item,
              proof.published_at, proof.id AS publication_id
            FROM private.enrollment_proof_publications proof
            JOIN public.provider_documents document ON document.id = proof.document_version_id
            WHERE proof.scope_id = revision.scope_id AND proof.revision_id = revision.id
          ) publication), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'scopeId', revision.scope_id, 'orgId', revision.org_id,
        'providerId', v_scope.provider_id, 'groupId', v_scope.group_id,
        'payerProductId', v_scope.payer_product_id, 'facilityId', v_scope.facility_id,
        'state', v_scope.state,
        'status', CASE WHEN revision.historical_shell OR revision.missing_proof
          THEN 'needs_verification' ELSE revision.published_status END,
        'historicalStatus', CASE WHEN revision.historical_shell OR revision.missing_proof
          THEN revision.published_status END,
        'clientSafeBlocker', revision.summary_blocker,
        'owner', revision.summary_owner, 'reviewedAt', revision.published_at,
        'cycleNo', CASE WHEN NOT revision.historical_shell THEN revision.cycle_no END,
        'revisionNo', CASE WHEN NOT revision.historical_shell THEN revision.revision_no END,
        'intakeDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof THEN revision.intake_date END,
        'completeToSubmitDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof THEN revision.complete_to_submit_date END,
        'submittedDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof THEN revision.submitted_date END,
        'payerAcknowledgedDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof THEN revision.payer_acknowledged_date END,
        'approvedDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          AND 'approved_date' = ANY(revision.supported_fields) THEN revision.approved_date END,
        'effectiveDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          AND 'effective_date' = ANY(revision.supported_fields) THEN revision.effective_date END,
        'terminationDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          AND 'termination_date' = ANY(revision.supported_fields) THEN revision.termination_date END,
        'payerReference', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof THEN revision.payer_reference END,
        'retroStatus', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          AND 'retro_status' = ANY(revision.supported_fields) THEN revision.retro_status ELSE 'unknown' END,
        'retroDays', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          AND 'retro_days' = ANY(revision.supported_fields) THEN revision.retro_days END,
        'retroDate', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          AND 'retro_date' = ANY(revision.supported_fields) THEN revision.retro_date END,
        'retroBasis', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          AND 'retro_status' = ANY(revision.supported_fields) THEN revision.retro_basis END,
        'proofs', CASE WHEN NOT revision.historical_shell AND NOT revision.missing_proof
          THEN revision.active_proofs ELSE '[]'::jsonb END,
        'historical', true,
        'publicationState', CASE WHEN revision.summary_revoked THEN 'retracted'
          WHEN NOT revision.is_current THEN 'superseded' ELSE 'published' END,
        'publishedAt', revision.published_at
      ) END AS item
    FROM client_status revision
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY page_no), '[]'::jsonb),
    COALESCE((SELECT bool_or(page_no > p_limit) FROM page), false),
    (SELECT jsonb_build_object('createdAt', last_item.created_at, 'revisionId', last_item.id)
      FROM page last_item WHERE last_item.page_no = p_limit)
  INTO v_items, v_more, v_next
  FROM items;

  RETURN jsonb_build_object('audience', p_audience, 'scopeId', p_scope_id,
    'items', v_items, 'nextCursor', CASE WHEN v_more THEN v_next ELSE NULL END);
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
END;
$$;

REVOKE ALL ON FUNCTION public.get_enrollment_scope_history_page(uuid, uuid, text, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_enrollment_scope_history_page(uuid, uuid, text, uuid, jsonb, integer)
  TO service_role;

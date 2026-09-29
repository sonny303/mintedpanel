// Synthetic, disposable PostgREST response for testing Nitro's large CSV
// transport. The real E6.14 SQL contract is verified separately by the native
// PostgreSQL suite; this fixture is installed only in the local HTTP topology.
export const E614_HTTP_STREAM = Object.freeze({
  search: "E614 HTTP stream fixture",
  rows: 10_000,
  blocker: "B".repeat(480),
});

export function e614HttpStreamFixtureSql() {
  return `
CREATE OR REPLACE FUNCTION public.get_enrollment_report_snapshot(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_filters jsonb,
  p_known_codes text[], p_discipline_codes text[], p_cursor jsonb, p_mode text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_records jsonb := '[]'::jsonb;
BEGIN
  IF p_filters ->> 'search' IS DISTINCT FROM '${E614_HTTP_STREAM.search}' THEN
    RETURN private.e614_report_snapshot(p_actor_user_id, p_org_id, p_audience,
      p_filters, p_known_codes, p_discipline_codes, p_cursor, p_mode);
  END IF;
  IF p_audience <> 'staff' OR p_actor_user_id IS NULL OR p_org_id IS NULL
     OR p_mode NOT IN ('page', 'export') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
  IF p_mode = 'export' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'providerName', 'E614 Stream Clinician', 'npi', '9000000001',
      'taxonomyCode', '225100000X', 'groupLabel', 'E614 Group',
      'payerLabel', 'E614 Payer', 'productLabel', 'E614 Product',
      'state', 'CO', 'facilityLabel', 'E614 Facility', 'status', 'submitted',
      'publicationState', 'draft', 'cycleNo', 1, 'payerReference', 'E614-STREAM',
      'retroType', 'unknown', 'clientSafeBlocker', repeat('B', 480),
      'owner', 'Payer', 'authenticatedReportUrl', '/reporting/enrollment-explorer'
    )) INTO v_records FROM generate_series(1, ${E614_HTTP_STREAM.rows});
  END IF;
  RETURN jsonb_build_object(
    'accessState', 'ready',
    'snapshotDigest', encode(sha256(convert_to('e614-http-stream-fixture-v1', 'UTF8')), 'hex'),
    'sections', '[]'::jsonb, 'filterChoices', jsonb_build_object(
      'groups', '[]'::jsonb, 'states', '[]'::jsonb, 'facilities', '[]'::jsonb,
      'products', '[]'::jsonb, 'disciplines', '[]'::jsonb, 'statuses', '[]'::jsonb),
    'providers', '[]'::jsonb, 'records', v_records, 'providerCount', 1,
    'rowCount', CASE WHEN p_mode = 'export' THEN ${E614_HTTP_STREAM.rows} ELSE 0 END,
    'tooLarge', false, 'hasMore', false, 'nextCursorKey', NULL
  );
END;
$$;
`;
}

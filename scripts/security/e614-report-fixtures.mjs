// Shared deterministic SQL fixture for the native report workload and the
// disposable E6.12 HTTP topology. Inputs are synthetic UUID identities only.
export const E614_SCALE_FIXTURE = Object.freeze({
  providerCount: 3000,
  productCount: 20,
  locationsPerProvider: 2,
  scopeCount: 120000,
  facilityIds: Object.freeze([
    "91000000-0000-4000-8000-000000000011",
    "91000000-0000-4000-8000-000000000012",
  ]),
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateUuid(name, value) {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new Error(`E614_FIXTURE_INVALID_${name.toUpperCase()}`);
  return value.toLowerCase();
}

export function e614ScaleFixtureSql({ orgId, groupId, payerId, actorId }) {
  const org = validateUuid("org_id", orgId);
  const group = validateUuid("group_id", groupId);
  const payer = validateUuid("payer_id", payerId);
  const actor = validateUuid("actor_id", actorId);
  const [facilityA, facilityB] = E614_SCALE_FIXTURE.facilityIds;

  return `
BEGIN;
SET CONSTRAINTS ALL DEFERRED;
-- The deferred E6.13 revision audit guard checks every synthetic revision at
-- commit. This fixture-only index keeps that integrity check linear at scale.
CREATE INDEX e614_fixture_audit_guard_idx ON public.audit_log
  (org_id, entity_type, entity_id, user_id, action_type, ((after ->> 'revisionId')));
INSERT INTO public.facilities (id, org_id, group_id, name, state, is_active)
VALUES ('${facilityA}', '${org}', '${group}', 'E614 Scale Location A', 'CO', TRUE),
       ('${facilityB}', '${org}', '${group}', 'E614 Scale Location B', 'CO', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO private.payer_products (id, payer_id, product_key, display_name, is_active, created_by)
SELECT ('92000000-0000-4000-8000-' || lpad(product_no::text, 12, '0'))::uuid,
  '${payer}', 'e614-scale-' || lpad(product_no::text, 2, '0'),
  'E614 Scale Product ' || lpad(product_no::text, 2, '0'), TRUE, '${actor}'
FROM generate_series(1, ${E614_SCALE_FIXTURE.productCount}) AS product_no
ON CONFLICT (id) DO NOTHING;

INSERT INTO private.group_product_targets
  (org_id, group_id, payer_product_id, payer_id, state, is_active, created_by, updated_by)
SELECT '${org}', '${group}', product.id, '${payer}', 'CO', TRUE, '${actor}', '${actor}'
FROM generate_series(1, ${E614_SCALE_FIXTURE.productCount}) AS product_no
JOIN private.payer_products product
  ON product.id = ('92000000-0000-4000-8000-' || lpad(product_no::text, 12, '0'))::uuid
ON CONFLICT (org_id, group_id, payer_product_id, state) DO NOTHING;

INSERT INTO public.providers
  (id, org_id, group_id, first_name, last_name, npi, status, taxonomy_code,
   verification_state, reference_only, is_test_provider)
SELECT ('93000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
  '${org}', '${group}', 'E614 Synthetic', 'Clinician ' || lpad(provider_no::text, 4, '0'),
  '9000' || lpad(provider_no::text, 6, '0'),
  'active', '225100000X', 'verified', FALSE, FALSE
FROM generate_series(1, ${E614_SCALE_FIXTURE.providerCount}) AS provider_no
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.provider_group_assignments
  (org_id, provider_id, group_id, is_primary, start_date)
SELECT '${org}', ('93000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
  '${group}', TRUE, CURRENT_DATE
FROM generate_series(1, ${E614_SCALE_FIXTURE.providerCount}) AS provider_no
ON CONFLICT (provider_id, group_id) DO NOTHING;

INSERT INTO public.provider_facility_assignments
  (org_id, provider_id, facility_id, is_primary, start_date)
SELECT '${org}', ('93000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
  CASE WHEN location_no = 1 THEN '${facilityA}'::uuid ELSE '${facilityB}'::uuid END,
  location_no = 1, CURRENT_DATE
FROM generate_series(1, ${E614_SCALE_FIXTURE.providerCount}) AS provider_no
CROSS JOIN generate_series(1, ${E614_SCALE_FIXTURE.locationsPerProvider}) AS location_no
ON CONFLICT (provider_id, facility_id) DO NOTHING;

CREATE TEMP TABLE e614_scale_rows ON COMMIT DROP AS
SELECT provider_no, product_no, location_no,
  ((provider_no - 1) * ${E614_SCALE_FIXTURE.productCount * E614_SCALE_FIXTURE.locationsPerProvider}
    + (product_no - 1) * ${E614_SCALE_FIXTURE.locationsPerProvider} + location_no) AS scope_no,
  ('93000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid AS provider_id,
  ('92000000-0000-4000-8000-' || lpad(product_no::text, 12, '0'))::uuid AS product_id,
  CASE WHEN location_no = 1 THEN '${facilityA}'::uuid ELSE '${facilityB}'::uuid END AS facility_id,
  ('94000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid AS source_id,
  ('95000000-0000-4000-8000-' || lpad((((provider_no - 1)
    * ${E614_SCALE_FIXTURE.productCount * E614_SCALE_FIXTURE.locationsPerProvider}
    + (product_no - 1) * ${E614_SCALE_FIXTURE.locationsPerProvider} + location_no)::bigint)::text, 12, '0'))::uuid AS scope_id,
  ('96000000-0000-4000-8000-' || lpad((((provider_no - 1)
    * ${E614_SCALE_FIXTURE.productCount * E614_SCALE_FIXTURE.locationsPerProvider}
    + (product_no - 1) * ${E614_SCALE_FIXTURE.locationsPerProvider} + location_no)::bigint)::text, 12, '0'))::uuid AS revision_id
FROM generate_series(1, ${E614_SCALE_FIXTURE.providerCount}) AS provider_no
CROSS JOIN generate_series(1, ${E614_SCALE_FIXTURE.productCount}) AS product_no
CROSS JOIN generate_series(1, ${E614_SCALE_FIXTURE.locationsPerProvider}) AS location_no;

INSERT INTO public.credential_cases
  (id, org_id, provider_id, group_id, facility_id, payer_id, state, case_status, payer_reference_id)
SELECT ('94000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
  '${org}', ('93000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
  '${group}', '${facilityA}', '${payer}', 'CO', 'submitted',
  'E614 scale case ' || lpad(provider_no::text, 4, '0')
FROM generate_series(1, ${E614_SCALE_FIXTURE.providerCount}) AS provider_no
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
SELECT '${org}', ('94000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
  CASE WHEN location_no = 1 THEN '${facilityA}'::uuid ELSE '${facilityB}'::uuid END,
  location_no = 1, '${actor}'
FROM generate_series(1, ${E614_SCALE_FIXTURE.providerCount}) AS provider_no
CROSS JOIN generate_series(1, ${E614_SCALE_FIXTURE.locationsPerProvider}) AS location_no
ON CONFLICT (case_id, facility_id) DO NOTHING;

INSERT INTO private.enrollment_scopes
  (id, org_id, provider_id, group_id, payer_product_id, payer_id,
   facility_id, state, current_revision_id, created_by)
SELECT row.scope_id, '${org}', row.provider_id, '${group}', row.product_id, '${payer}',
  row.facility_id, 'CO', row.revision_id, '${actor}'
FROM e614_scale_rows row
ON CONFLICT (id) DO NOTHING;

INSERT INTO private.enrollment_scope_revisions
  (id, org_id, scope_id, cycle_no, revision_no, status, submitted_date,
   payer_reference, action_owner, retro_status, observed_at, created_by)
SELECT row.revision_id, '${org}', row.scope_id, 1, 1, 'submitted',
  DATE '2026-06-01', 'E614-LOAD-' || lpad(row.scope_no::text, 6, '0'),
  'Payer', 'unknown', TIMESTAMPTZ '2026-09-25 12:00:00+00', '${actor}'
FROM e614_scale_rows row
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, after, description)
SELECT '${org}', '${actor}', 'CREATE', 'enrollment_scope', row.scope_id,
  jsonb_build_object('revisionId', row.revision_id, 'cycleNo', 1, 'revisionNo', 1, 'sourceCount', 1),
  'Synthetic E614 scale fixture'
FROM e614_scale_rows row
ON CONFLICT DO NOTHING;

WITH canonical AS MATERIALIZED (
  SELECT row.source_id,
    private.e613_source_snapshot('case', row.source_id) AS snapshot
  FROM (SELECT DISTINCT source_id FROM e614_scale_rows) row
), linked AS (
  SELECT row.*, canonical.snapshot
  FROM e614_scale_rows row JOIN canonical USING (source_id)
)
INSERT INTO private.enrollment_scope_sources
  (org_id, scope_id, revision_id, source_kind, source_id, source_identity,
   source_snapshot, source_fingerprint, created_by)
SELECT '${org}', linked.scope_id, linked.revision_id, 'case', linked.source_id,
  jsonb_build_object('org_id', '${org}', 'provider_id', linked.provider_id, 'group_id', '${group}',
    'payer_product_id', linked.product_id, 'facility_id', linked.facility_id, 'state', 'CO'),
  linked.snapshot, private.e613_source_fingerprint(linked.snapshot), '${actor}'
FROM linked
ON CONFLICT (revision_id, source_kind, source_id) DO NOTHING;

SELECT 'E614_FIXTURE|' || jsonb_build_object(
  'orgId', '${org}', 'groupId', '${group}', 'payerId', '${payer}', 'actorId', '${actor}',
  'providerCount', ${E614_SCALE_FIXTURE.providerCount},
  'productCount', ${E614_SCALE_FIXTURE.productCount},
  'locationCount', ${E614_SCALE_FIXTURE.locationsPerProvider},
  'scopeCount', ${E614_SCALE_FIXTURE.scopeCount}, 'sourceCount', ${E614_SCALE_FIXTURE.providerCount},
  'facilityIds', jsonb_build_array('${facilityA}', '${facilityB}'),
  'productIds', (SELECT jsonb_agg(product.id ORDER BY product.product_key)
    FROM private.payer_products product WHERE product.payer_id = '${payer}'
      AND product.product_key LIKE 'e614-scale-%'),
  'firstProviderId', '93000000-0000-4000-8000-000000000001',
  'firstProductId', '92000000-0000-4000-8000-000000000001',
  'firstScopeId', '95000000-0000-4000-8000-000000000001',
  'firstRevisionId', '96000000-0000-4000-8000-000000000001',
  'firstSourceId', '94000000-0000-4000-8000-000000000001',
  'sampleDraftScopeId', '95000000-0000-4000-8000-000000000001',
  'sampleScope', (SELECT jsonb_build_object(
    'scopeId', scope.id, 'providerId', scope.provider_id, 'productId', scope.payer_product_id,
    'facilityId', scope.facility_id, 'state', scope.state, 'revisionId', revision.id,
    'sourceCaseId', source.source_id,
    'sourceFingerprint', private.e613_source_fingerprint(
      private.e613_source_snapshot('case', source.source_id)),
    'providerNpi', provider.npi, 'providerName', concat_ws(' ', provider.first_name, provider.last_name),
    'status', revision.status, 'submittedDate', revision.submitted_date
  ) FROM private.enrollment_scopes scope
    JOIN private.enrollment_scope_revisions revision
      ON revision.scope_id = scope.id AND revision.id = scope.current_revision_id
    JOIN private.enrollment_scope_sources source
      ON source.scope_id = scope.id AND source.revision_id = revision.id
    JOIN public.providers provider ON provider.id = scope.provider_id
    WHERE scope.id = '95000000-0000-4000-8000-000000000001')
)::text;
COMMIT;
`;
}

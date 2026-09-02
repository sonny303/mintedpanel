\set ON_ERROR_STOP on

-- Destructive only inside the isolated matrix_spike schema. The runner refuses
-- the production project ref before this file is invoked.
DROP SCHEMA IF EXISTS matrix_spike CASCADE;
CREATE SCHEMA matrix_spike;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matrix_spike_client') THEN
    CREATE ROLE matrix_spike_client NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA matrix_spike TO matrix_spike_client;
SET search_path = matrix_spike, public;

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('specialist', 'billing', 'admin')),
  UNIQUE (org_id, user_id)
);

CREATE TABLE client_group_grants (
  client_user_id uuid NOT NULL,
  group_id uuid NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (client_user_id, group_id)
);

CREATE TABLE provider_groups (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE facilities (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  group_id uuid REFERENCES provider_groups(id),
  name text NOT NULL,
  city text,
  state text,
  county text,
  is_active boolean NOT NULL DEFAULT true,
  reference_only boolean NOT NULL DEFAULT false
);

CREATE TABLE providers (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  group_id uuid REFERENCES provider_groups(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  credentials text,
  specialty text,
  status text NOT NULL CHECK (status IN ('onboarding', 'active', 'terminated')),
  reference_only boolean NOT NULL DEFAULT false,
  is_test_provider boolean NOT NULL DEFAULT false,
  verification_state text NOT NULL DEFAULT 'verified'
);

CREATE TABLE payers (
  id uuid PRIMARY KEY,
  org_id uuid,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE credential_cases (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  state text NOT NULL,
  group_id uuid REFERENCES provider_groups(id),
  facility_id uuid REFERENCES facilities(id),
  case_number bigint NOT NULL UNIQUE,
  case_status text NOT NULL,
  submitted_date date,
  approved_date date,
  expected_effective_date date,
  confirmed_effective_date date,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (provider_id, group_id, payer_id, state)
);

CREATE TABLE contracts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  group_id uuid REFERENCES provider_groups(id),
  payer_id uuid REFERENCES payers(id),
  state text NOT NULL,
  contracting_status text NOT NULL,
  effective_date date,
  expiration_date date,
  UNIQUE (group_id, payer_id, state)
);

-- Relevant production-equivalent indexes, before any proposed optimization.
CREATE INDEX idx_credential_cases_facility_id ON credential_cases (facility_id);
CREATE INDEX idx_credential_cases_org_id ON credential_cases (org_id);
CREATE INDEX idx_credential_cases_provider_id ON credential_cases (provider_id);
CREATE INDEX idx_credential_cases_payer_id ON credential_cases (payer_id);
CREATE INDEX idx_credential_cases_group_id ON credential_cases (group_id);
CREATE INDEX idx_credential_cases_case_status ON credential_cases (org_id, case_status);
CREATE INDEX idx_contracts_group_id ON contracts (group_id);
CREATE INDEX idx_contracts_payer_id ON contracts (payer_id);
CREATE INDEX idx_providers_pending_verification
  ON providers (org_id)
  WHERE verification_state = 'pending_verification';

CREATE FUNCTION current_benchmark_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('matrix_spike.user_id', true), '')::uuid
$$;

CREATE FUNCTION user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = matrix_spike
AS $$
  SELECT org_id
  FROM memberships
  WHERE user_id = current_benchmark_user_id()
$$;

ALTER TABLE provider_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_groups_select
  ON provider_groups FOR SELECT TO matrix_spike_client
  USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY facilities_select
  ON facilities FOR SELECT TO matrix_spike_client
  USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY providers_select
  ON providers FOR SELECT TO matrix_spike_client
  USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY payers_select
  ON payers FOR SELECT TO matrix_spike_client
  USING (org_id IS NULL OR org_id IN (SELECT user_org_ids()));
CREATE POLICY credential_cases_select
  ON credential_cases FOR SELECT TO matrix_spike_client
  USING (org_id IN (SELECT user_org_ids()));
CREATE POLICY contracts_select
  ON contracts FOR SELECT TO matrix_spike_client
  USING (org_id IN (SELECT user_org_ids()));

GRANT SELECT ON
  organizations,
  provider_groups,
  facilities,
  providers,
  payers,
  credential_cases,
  contracts
TO matrix_spike_client;
GRANT EXECUTE ON FUNCTION current_benchmark_user_id() TO matrix_spike_client;
GRANT EXECUTE ON FUNCTION user_org_ids() TO matrix_spike_client;

CREATE TEMP TABLE seed_scales (provider_count integer PRIMARY KEY);
INSERT INTO seed_scales VALUES (500), (1500), (3000);

INSERT INTO organizations (id, name)
SELECT md5('org-' || provider_count)::uuid, 'Scale org ' || provider_count
FROM seed_scales;

INSERT INTO memberships (id, org_id, user_id, role)
SELECT
  md5('membership-' || provider_count)::uuid,
  md5('org-' || provider_count)::uuid,
  md5('user-' || provider_count)::uuid,
  'billing'
FROM seed_scales;

INSERT INTO payers (id, org_id, name, status)
SELECT md5('payer-' || payer_no)::uuid, NULL, 'Payer ' || lpad(payer_no::text, 2, '0'), 'active'
FROM generate_series(1, 20) AS payer_no;

INSERT INTO provider_groups (id, org_id, name)
SELECT
  md5('group-' || provider_count || '-' || group_no)::uuid,
  md5('org-' || provider_count)::uuid,
  'Group ' || group_no
FROM seed_scales
CROSS JOIN generate_series(1, 7) AS group_no;

INSERT INTO client_group_grants (client_user_id, group_id)
SELECT
  md5('user-' || provider_count)::uuid,
  md5('group-' || provider_count || '-' || group_no)::uuid
FROM seed_scales
CROSS JOIN generate_series(1, 7) AS group_no;

INSERT INTO facilities (
  id,
  org_id,
  group_id,
  name,
  city,
  state,
  county
)
SELECT
  md5('facility-' || provider_count || '-' || facility_no)::uuid,
  md5('org-' || provider_count)::uuid,
  md5('group-' || provider_count || '-' || (((facility_no - 1) % 7) + 1))::uuid,
  'Facility ' || lpad(facility_no::text, 2, '0'),
  (ARRAY['Raleigh', 'Charlotte', 'Richmond', 'Atlanta', 'Nashville'])[((facility_no - 1) % 5) + 1],
  (ARRAY['NC', 'SC', 'VA', 'GA', 'TN'])[((facility_no - 1) % 5) + 1],
  (ARRAY['Wake', 'Mecklenburg', 'Richmond', 'Fulton', 'Davidson'])[((facility_no - 1) % 5) + 1]
FROM seed_scales
CROSS JOIN generate_series(1, 40) AS facility_no;

INSERT INTO providers (
  id,
  org_id,
  group_id,
  first_name,
  last_name,
  credentials,
  specialty,
  status,
  reference_only,
  is_test_provider,
  verification_state
)
SELECT
  md5('provider-' || provider_count || '-' || provider_no)::uuid,
  md5('org-' || provider_count)::uuid,
  md5('group-' || provider_count || '-' || (((provider_no - 1) % 7) + 1))::uuid,
  'Taylor' || lpad(provider_no::text, 5, '0'),
  'Provider' || lpad(provider_no::text, 5, '0'),
  (ARRAY['PT', 'OT', 'SLP'])[((provider_no - 1) % 3) + 1],
  (ARRAY['Physical Therapy', 'Occupational Therapy', 'Speech Therapy'])[
    ((provider_no - 1) % 3) + 1
  ],
  CASE WHEN provider_no % 11 = 0 THEN 'onboarding' ELSE 'active' END,
  false,
  false,
  'verified'
FROM seed_scales
CROSS JOIN LATERAL generate_series(1, provider_count) AS provider_no;

INSERT INTO credential_cases (
  id,
  org_id,
  provider_id,
  payer_id,
  state,
  group_id,
  facility_id,
  case_number,
  case_status,
  submitted_date,
  approved_date,
  expected_effective_date,
  confirmed_effective_date,
  created_at,
  updated_at
)
SELECT
  md5('case-' || provider_count || '-' || provider_no || '-' || payer_no)::uuid,
  md5('org-' || provider_count)::uuid,
  md5('provider-' || provider_count || '-' || provider_no)::uuid,
  md5('payer-' || payer_no)::uuid,
  (ARRAY['NC', 'SC', 'VA', 'GA', 'TN'])[((provider_no - 1) % 5) + 1],
  md5('group-' || provider_count || '-' || (((provider_no - 1) % 7) + 1))::uuid,
  md5('facility-' || provider_count || '-' || (((provider_no - 1) % 40) + 1))::uuid,
  provider_count::bigint * 1000000 + provider_no::bigint * 100 + payer_no,
  (ARRAY[
    'not_started',
    'in_progress',
    'submitted',
    'in_review',
    'action_required',
    'approved',
    'denied',
    'not_pursuing'
  ])[((provider_no + payer_no) % 8) + 1],
  CASE
    WHEN (provider_no + payer_no) % 8 >= 2
      THEN DATE '2026-01-01' + ((provider_no + payer_no) % 180)
  END,
  CASE
    WHEN (provider_no + payer_no) % 8 = 5
      THEN DATE '2026-02-01' + ((provider_no + payer_no) % 150)
  END,
  CASE
    WHEN (provider_no + payer_no) % 8 BETWEEN 2 AND 5
      THEN DATE '2026-03-01' + ((provider_no + payer_no) % 150)
  END,
  CASE
    WHEN (provider_no + payer_no) % 8 = 5
      THEN DATE '2026-03-15' + ((provider_no + payer_no) % 120)
  END,
  timestamptz '2026-01-01 00:00:00+00' + ((provider_no + payer_no) % 180) * interval '1 day',
  timestamptz '2026-07-01 00:00:00+00' - ((provider_no + payer_no) % 30) * interval '1 day'
FROM seed_scales
CROSS JOIN LATERAL generate_series(1, provider_count) AS provider_no
CROSS JOIN generate_series(1, 20) AS payer_no;

INSERT INTO contracts (
  id,
  org_id,
  group_id,
  payer_id,
  state,
  contracting_status,
  effective_date,
  expiration_date
)
SELECT
  md5(
    'contract-' || provider_count || '-' || group_no || '-' || payer_no || '-' || state_code
  )::uuid,
  md5('org-' || provider_count)::uuid,
  md5('group-' || provider_count || '-' || group_no)::uuid,
  md5('payer-' || payer_no)::uuid,
  state_code,
  CASE WHEN (group_no + payer_no) % 5 = 0 THEN 'in_progress' ELSE 'in_network' END,
  CASE
    WHEN (group_no + payer_no) % 5 <> 0 THEN DATE '2026-01-01'
  END,
  NULL
FROM seed_scales
CROSS JOIN generate_series(1, 7) AS group_no
CROSS JOIN generate_series(1, 20) AS payer_no
CROSS JOIN unnest(ARRAY['NC', 'SC', 'VA', 'GA', 'TN']) AS state_code;

ANALYZE organizations;
ANALYZE memberships;
ANALYZE client_group_grants;
ANALYZE provider_groups;
ANALYZE facilities;
ANALYZE providers;
ANALYZE payers;
ANALYZE credential_cases;
ANALYZE contracts;

SELECT
  s.provider_count,
  (
    SELECT count(*)
    FROM providers p
    WHERE p.org_id = md5('org-' || s.provider_count)::uuid
  ) AS providers,
  (
    SELECT count(*)
    FROM facilities f
    WHERE f.org_id = md5('org-' || s.provider_count)::uuid
  ) AS facilities,
  (
    SELECT count(DISTINCT c.payer_id)
    FROM credential_cases c
    WHERE c.org_id = md5('org-' || s.provider_count)::uuid
  ) AS payers,
  (
    SELECT count(*)
    FROM credential_cases c
    WHERE c.org_id = md5('org-' || s.provider_count)::uuid
  ) AS cases,
  (
    SELECT count(*)
    FROM contracts ct
    WHERE ct.org_id = md5('org-' || s.provider_count)::uuid
  ) AS contracts
FROM seed_scales s
ORDER BY s.provider_count;

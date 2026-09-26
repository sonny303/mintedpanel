// Synthetic case/profile records for the E6.12 real-HTTP R2 boundary probe.
// These UUIDs and values exist only in a fresh, owned verifier database.
export const PROFILE_HTTP = Object.freeze({
  providerA2: "72000000-0000-4000-8000-000000000001",
  providerB: "72000000-0000-4000-8000-000000000002",
  caseWithLocations: "41000000-0000-4000-8000-000000000101",
  caseEmptyLocations: "41000000-0000-4000-8000-000000000102",
  caseWrongProvider: "41000000-0000-4000-8000-000000000103",
  caseOtherOrg: "41000000-0000-4000-8000-000000000104",
  caseUnselectedSecondary: "41000000-0000-4000-8000-000000000105",
  caseNullGroup: "41000000-0000-4000-8000-000000000106",
  facilityPrimary: "71000000-0000-4000-8000-000000000011",
  facilitySecondary: "71000000-0000-4000-8000-000000000012",
  facilityUnselectedSecondary: "71000000-0000-4000-8000-000000000013",
  policyCaseGroup: "74000000-0000-4000-8000-000000000011",
  licenseKs: "73000000-0000-4000-8000-000000000011",
  licenseCo: "73000000-0000-4000-8000-000000000012",
});

export function profileHttpFixtureSql({ E612 }) {
  const f = PROFILE_HTTP;
  return `
UPDATE public.provider_groups
SET name = 'E612 Case Override Group'
WHERE id = '${E612.groupA2}' AND org_id = '${E612.orgA}';

UPDATE public.providers
SET credentials = 'DO'
WHERE id = '${E612.provider}' AND org_id = '${E612.orgA}';

INSERT INTO public.providers
  (id, org_id, group_id, first_name, last_name, credentials, email, status)
VALUES
  ('${f.providerA2}', '${E612.orgA}', '${E612.groupA2}', 'E612', 'Other', 'MD', 'other-provider@e612.test', 'active'),
  ('${f.providerB}', '${E612.orgB}', '${E612.groupB1}', 'E612', 'Foreign', 'DO', 'foreign-provider@e612.test', 'active')
ON CONFLICT (id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  group_id = EXCLUDED.group_id,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  credentials = EXCLUDED.credentials,
  email = EXCLUDED.email,
  status = EXCLUDED.status;

INSERT INTO public.provider_group_assignments
  (org_id, provider_id, group_id, is_primary, start_date)
VALUES
  ('${E612.orgA}', '${E612.provider}', '${E612.groupA2}', FALSE, DATE '2026-01-01'),
  ('${E612.orgA}', '${f.providerA2}', '${E612.groupA2}', TRUE, DATE '2026-01-01'),
  ('${E612.orgB}', '${f.providerB}', '${E612.groupB1}', TRUE, DATE '2026-01-01')
ON CONFLICT (provider_id, group_id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  is_primary = EXCLUDED.is_primary;

INSERT INTO public.facilities
  (id, org_id, group_id, name, street, suite, city, state, zip, is_active)
VALUES
  ('${f.facilityPrimary}', '${E612.orgA}', '${E612.groupA2}', 'E612 Case Primary', '100 Case Primary Ave', 'Suite 101', 'Overland Park', 'CO', '66211', TRUE),
  ('${f.facilitySecondary}', '${E612.orgA}', '${E612.groupA2}', 'E612 Case Secondary', '220 Case Secondary Ave', 'Suite 202', 'Overland Park', 'CO', '66212', TRUE),
  ('${f.facilityUnselectedSecondary}', '${E612.orgA}', '${E612.groupA2}', 'E612 Unselected Case Location', '330 Case Unselected Ave', NULL, 'Overland Park', 'CO', '66213', TRUE)
ON CONFLICT (id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  group_id = EXCLUDED.group_id,
  name = EXCLUDED.name,
  street = EXCLUDED.street,
  suite = EXCLUDED.suite,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  zip = EXCLUDED.zip,
  is_active = EXCLUDED.is_active;

INSERT INTO public.provider_facility_assignments
  (org_id, provider_id, facility_id, is_primary, start_date, practice_frequency)
VALUES
  ('${E612.orgA}', '${E612.provider}', '${f.facilityPrimary}', FALSE, DATE '2026-01-01', 'Case primary assignment'),
  ('${E612.orgA}', '${E612.provider}', '${f.facilitySecondary}', FALSE, DATE '2026-01-01', 'Case secondary assignment'),
  ('${E612.orgA}', '${E612.provider}', '${f.facilityUnselectedSecondary}', FALSE, DATE '2026-01-01', 'Unselected case assignment')
ON CONFLICT (provider_id, facility_id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  is_primary = EXCLUDED.is_primary,
  practice_frequency = EXCLUDED.practice_frequency;

INSERT INTO public.group_insurance_policies
  (id, org_id, group_id, insurance_type, insurer_name, policy_number, policy_start_date, policy_end_date)
VALUES
  ('${f.policyCaseGroup}', '${E612.orgA}', '${E612.groupA2}', 'professional_liability', 'E612 Case Group Insurer', 'E612-CASE-GROUP-POLICY', DATE '2026-01-01', DATE '2030-01-01')
ON CONFLICT (id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  group_id = EXCLUDED.group_id,
  insurer_name = EXCLUDED.insurer_name,
  policy_number = EXCLUDED.policy_number,
  policy_start_date = EXCLUDED.policy_start_date,
  policy_end_date = EXCLUDED.policy_end_date;

INSERT INTO public.state_licenses
  (id, org_id, provider_id, state, license_number, license_type, issue_date, expiration_date, status)
VALUES
  ('${f.licenseKs}', '${E612.orgA}', '${E612.provider}', 'KS', 'E612-PROVIDER-KS', 'full', DATE '2025-01-01', DATE '2030-01-01', 'active'),
  ('${f.licenseCo}', '${E612.orgA}', '${E612.provider}', 'CO', 'E612-CASE-CO', 'full', DATE '2025-01-01', DATE '2030-01-01', 'active')
ON CONFLICT (id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  provider_id = EXCLUDED.provider_id,
  state = EXCLUDED.state,
  license_number = EXCLUDED.license_number,
  license_type = EXCLUDED.license_type,
  issue_date = EXCLUDED.issue_date,
  expiration_date = EXCLUDED.expiration_date,
  status = EXCLUDED.status;

INSERT INTO public.credential_cases
  (id, org_id, provider_id, group_id, facility_id, payer_id, state, created_by)
VALUES
  ('${f.caseWithLocations}', '${E612.orgA}', '${E612.provider}', '${E612.groupA2}', '${f.facilityPrimary}', '60000000-0000-4000-8000-000000000001', 'CO', '${E612.admin}'),
  ('${f.caseEmptyLocations}', '${E612.orgA}', '${E612.provider}', '${E612.groupA2}', NULL, '60000000-0000-4000-8000-000000000001', 'KS', '${E612.admin}'),
  ('${f.caseWrongProvider}', '${E612.orgA}', '${f.providerA2}', '${E612.groupA2}', NULL, '60000000-0000-4000-8000-000000000001', 'CO', '${E612.admin}'),
  ('${f.caseOtherOrg}', '${E612.orgB}', '${f.providerB}', '${E612.groupB1}', NULL, '60000000-0000-4000-8000-000000000001', 'CO', '${E612.orgBAdmin}'),
  ('${f.caseUnselectedSecondary}', '${E612.orgA}', '${E612.provider}', '${E612.groupA2}', NULL, '60000000-0000-4000-8000-000000000001', 'MO', '${E612.admin}'),
  ('${f.caseNullGroup}', '${E612.orgA}', '${E612.provider}', NULL, NULL, '60000000-0000-4000-8000-000000000001', 'WA', '${E612.admin}')
ON CONFLICT (id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  provider_id = EXCLUDED.provider_id,
  group_id = EXCLUDED.group_id,
  facility_id = EXCLUDED.facility_id,
  payer_id = EXCLUDED.payer_id,
  state = EXCLUDED.state,
  created_by = EXCLUDED.created_by;

INSERT INTO public.case_facilities
  (org_id, case_id, facility_id, is_primary, created_by)
VALUES
  ('${E612.orgA}', '${f.caseWithLocations}', '${f.facilityPrimary}', TRUE, '${E612.admin}'),
  ('${E612.orgA}', '${f.caseWithLocations}', '${f.facilitySecondary}', FALSE, '${E612.admin}'),
  ('${E612.orgA}', '${f.caseUnselectedSecondary}', '${f.facilityUnselectedSecondary}', FALSE, '${E612.admin}')
ON CONFLICT (case_id, facility_id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  is_primary = EXCLUDED.is_primary,
  created_by = EXCLUDED.created_by;
`;
}

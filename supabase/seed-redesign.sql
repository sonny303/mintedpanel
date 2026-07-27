-- Redesign Stage 0 seed universe (docs/redesign/seed-universe.md).
--
-- SEPARATE, additive fixture layer — NOT an edit of the legacy supabase/seed.sql
-- (BEST PT / KS FIT PT). Load it independently for redesign dev/test:
--   psql "$DATABASE_URL" -f supabase/seed-redesign.sql
-- Never load into production (seed-universe guardrail).
--
-- Idempotent by NATURAL KEY (normalized org name / owner email / assignment
-- tuple) rather than fixed UUIDs, so re-running is safe and no hand-authored
-- UUIDs can drift. Like legacy seed.sql it does NOT seed auth.users or
-- memberships (those need GoTrue); a test harness wires the P1 membership per
-- environment.
--
-- Extended per PR:
--   E0.1 — 11 orgs (explicit lifecycle_state) + owner party + 'owner' role each.
--   E0.2 — Zeb sales rep (every org) + per-org customer escalation contacts.
--   E0.3 — TS-10: Zeb also 'owner' on Point Place (one party, many roles).
--          (TS-9 party fixtures + TS-11 Zeb sales-rep on Outer Banks/Dillon are
--           already covered by the E0.1/E0.2 sections above.)

-- created_by placeholder for seeded parties (parties.created_by has no FK).
-- \gset-free: inlined as a literal below.

-- ---------------------------------------------------------------------------
-- E0.1 — Organizations (11-org universe) with lifecycle_state.
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (name, lifecycle_state)
SELECT v.name, v.lifecycle
FROM (VALUES
  ('Outer Banks Rehab Group',      'active'),
  ('Tree Hill Sports Therapy',     'prospect'),
  ('Shelby Sports Rehab',          'active'),
  ('Outer Banks Therapy Group',    'inactive'),
  ('Gemstone Family Rehab',        'active'),
  ('Lowcountry Charm PT',          'prospect'),
  ('South Park Physical Therapy',  'active'),
  ('Dillon Sports Medicine',       'active'),
  ('Lone Star Rehab Group',        'prospect'),
  ('Point Place Physical Therapy', 'active'),
  ('Rose City Rehab Collective',   'prospect')
) AS v(name, lifecycle)
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations o
  WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = lower(regexp_replace(v.name, '\s+', '', 'g'))
);

-- ---------------------------------------------------------------------------
-- E0.1 — Owner parties (P5), one per org. Idempotent by owner email.
-- ---------------------------------------------------------------------------
INSERT INTO public.parties (party_type, name, email, created_by)
SELECT 'person', v.owner_name, v.owner_email, '0e5eed00-0000-4000-a000-000000000000'::uuid
FROM (VALUES
  ('Owner Outer Banks', 'owner.outer-banks@example.test'),
  ('Owner Tree Hill',   'owner.tree-hill@example.test'),
  ('Owner Shelby',      'owner.shelby@example.test'),
  ('Owner OB Therapy',  'owner.ob-therapy@example.test'),
  ('Owner Gemstone',    'owner.gemstone@example.test'),
  ('Owner Lowcountry',  'owner.lowcountry@example.test'),
  ('Owner South Park',  'owner.south-park@example.test'),
  ('Owner Dillon',      'owner.dillon@example.test'),
  ('Owner Lone Star',   'owner.lone-star@example.test'),
  ('Owner Point Place', 'owner.point-place@example.test'),
  ('Owner Rose City',   'owner.rose-city@example.test')
) AS v(owner_name, owner_email)
WHERE NOT EXISTS (
  SELECT 1 FROM public.parties p WHERE p.email = v.owner_email
);

-- ---------------------------------------------------------------------------
-- E0.1 — Owner role assignments (org scope). Idempotent via the unique tuple.
-- ---------------------------------------------------------------------------
INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
SELECT o.id, p.id, 'owner', 'org'
FROM (VALUES
  ('Outer Banks Rehab Group',      'owner.outer-banks@example.test'),
  ('Tree Hill Sports Therapy',     'owner.tree-hill@example.test'),
  ('Shelby Sports Rehab',          'owner.shelby@example.test'),
  ('Outer Banks Therapy Group',    'owner.ob-therapy@example.test'),
  ('Gemstone Family Rehab',        'owner.gemstone@example.test'),
  ('Lowcountry Charm PT',          'owner.lowcountry@example.test'),
  ('South Park Physical Therapy',  'owner.south-park@example.test'),
  ('Dillon Sports Medicine',       'owner.dillon@example.test'),
  ('Lone Star Rehab Group',        'owner.lone-star@example.test'),
  ('Point Place Physical Therapy', 'owner.point-place@example.test'),
  ('Rose City Rehab Collective',   'owner.rose-city@example.test')
) AS v(org_name, owner_email)
JOIN public.organizations o
  ON lower(regexp_replace(o.name, '\s+', '', 'g')) = lower(regexp_replace(v.org_name, '\s+', '', 'g'))
JOIN public.parties p ON p.email = v.owner_email
ON CONFLICT ON CONSTRAINT party_role_assignments_unique DO NOTHING;

-- ---------------------------------------------------------------------------
-- E0.2 — Sales rep (Zeb Loewenstine): one party, sales_rep on every seed org.
-- ---------------------------------------------------------------------------
INSERT INTO public.parties (
  party_type, name, email, phone_office, address_line1, address_line2, city, state, postal_code, country, created_by
)
SELECT 'person', 'Zeb Loewenstine', 'zeb@mintedpanel.example.test', '704-555-0100',
       '101 S Tryon St', 'Suite 400', 'Charlotte', 'NC', '28280', 'US',
       '0e5eed00-0000-4000-a000-000000000000'::uuid
WHERE NOT EXISTS (SELECT 1 FROM public.parties WHERE email = 'zeb@mintedpanel.example.test');

INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
SELECT o.id, z.id, 'sales_rep', 'org'
FROM public.organizations o
CROSS JOIN LATERAL (SELECT id FROM public.parties WHERE email = 'zeb@mintedpanel.example.test' LIMIT 1) z
WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) IN (
  'outerbanksrehabgroup','treehillsportstherapy','shelbysportsrehab','outerbankstherapygroup',
  'gemstonefamilyrehab','lowcountrycharmpt','southparkphysicaltherapy','dillonsportsmedicine',
  'lonestarrehabgroup','pointplacephysicaltherapy','rosecityrehabcollective'
)
ON CONFLICT ON CONSTRAINT party_role_assignments_unique DO NOTHING;

-- ---------------------------------------------------------------------------
-- E0.2 — Customer escalation contacts (one per org). Idempotent by email.
-- ---------------------------------------------------------------------------
INSERT INTO public.parties (
  party_type, name, email, phone_office, address_line1, city, state, postal_code, country, created_by
)
SELECT 'person', v.name, v.email, v.phone, v.line1, v.city, v.state, v.zip, 'US',
       '0e5eed00-0000-4000-a000-000000000000'::uuid
FROM (VALUES
  ('Sarah Cameron',     'contact.outer-banks@example.test', '252-555-0111', '12 Figure Eight Rd',        'Kill Devil Hills', 'NC', '27948'),
  ('Haley James',       'contact.tree-hill@example.test',   '910-555-0112', '44 Rivercourt Ln',          'Wilmington',       'NC', '28401'),
  ('April Buchanon',    'contact.shelby@example.test',      '704-555-0113', '210 Stadium Dr',            'Shelby',           'NC', '28150'),
  ('Rose Cameron',      'contact.ob-therapy@example.test',  '252-555-0114', '8 Lighthouse Rd',           'Nags Head',        'NC', '27959'),
  ('Judy Gemstone',     'contact.gemstone@example.test',    '843-555-0115', '1 Salvation Center Blvd',   'Charleston',       'SC', '29401'),
  ('Cameran Eubanks',   'contact.lowcountry@example.test',  '843-555-0116', '77 East Bay St',            'Charleston',       'SC', '29401'),
  ('Sharon Marsh',      'contact.south-park@example.test',  '719-555-0117', '260 Avenue de los Mexicanos','South Park',      'CO', '80440'),
  ('Coach Eric Taylor', 'contact.dillon@example.test',      '432-555-0118', '500 Panther Field Rd',      'Dillon',           'TX', '79714'),
  ('Owen Strand',       'contact.lone-star@example.test',   '512-555-0119', '126 Firehouse Way',         'Austin',           'TX', '78701'),
  ('Kitty Forman',      'contact.point-place@example.test', '414-555-0120', '416 Marie Dr',              'Point Place',      'WI', '53511'),
  ('Candace Devereaux', 'contact.rose-city@example.test',   '503-555-0121', '3550 N Mississippi Ave',    'Portland',         'OR', '97227')
) AS v(name, email, phone, line1, city, state, zip)
WHERE NOT EXISTS (SELECT 1 FROM public.parties p WHERE p.email = v.email);

INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
SELECT o.id, p.id, 'customer_escalation_contact', 'org'
FROM (VALUES
  ('Outer Banks Rehab Group',      'contact.outer-banks@example.test'),
  ('Tree Hill Sports Therapy',     'contact.tree-hill@example.test'),
  ('Shelby Sports Rehab',          'contact.shelby@example.test'),
  ('Outer Banks Therapy Group',    'contact.ob-therapy@example.test'),
  ('Gemstone Family Rehab',        'contact.gemstone@example.test'),
  ('Lowcountry Charm PT',          'contact.lowcountry@example.test'),
  ('South Park Physical Therapy',  'contact.south-park@example.test'),
  ('Dillon Sports Medicine',       'contact.dillon@example.test'),
  ('Lone Star Rehab Group',        'contact.lone-star@example.test'),
  ('Point Place Physical Therapy', 'contact.point-place@example.test'),
  ('Rose City Rehab Collective',   'contact.rose-city@example.test')
) AS v(org_name, email)
JOIN public.organizations o
  ON lower(regexp_replace(o.name, '\s+', '', 'g')) = lower(regexp_replace(v.org_name, '\s+', '', 'g'))
JOIN public.parties p ON p.email = v.email
ON CONFLICT ON CONSTRAINT party_role_assignments_unique DO NOTHING;

-- ---------------------------------------------------------------------------
-- E0.3 — TS-10: Zeb ALSO holds 'owner' on Point Place Physical Therapy, in
-- addition to the seeded "Owner Point Place" and his sales_rep everywhere. One
-- party, many roles across orgs (F0.3.3/F0.3.4). Idempotent via the unique tuple.
-- ---------------------------------------------------------------------------
INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
SELECT o.id, z.id, 'owner', 'org'
FROM public.organizations o
CROSS JOIN LATERAL (SELECT id FROM public.parties WHERE email = 'zeb@mintedpanel.example.test' LIMIT 1) z
WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = 'pointplacephysicaltherapy'
ON CONFLICT ON CONSTRAINT party_role_assignments_unique DO NOTHING;

-- ---------------------------------------------------------------------------
-- E0.5 — Inbound "contact us" leads (F0.5.5 / TE-7). Two demo leads awaiting
-- triage in the shared internal queue: one convertible to a prospect org, one
-- an obvious dismiss. Idempotent by (org_name, contact_email). Capture links
-- themselves are token-ephemeral (only a hash is stored, generated at issue) so
-- they are exercised via the mock e2e harness, not seeded here — TS-7 (Lone Star
-- owner) and TS-13 (Rose City alt recipient / office manager) run through the
-- create_capture_link -> validate_capture_token -> submit_capture flow.
-- ---------------------------------------------------------------------------
INSERT INTO public.inbound_leads (org_name, contact_name, contact_email, contact_phone, status)
SELECT v.org_name, v.contact_name, v.email, v.phone, 'new'
FROM (VALUES
  ('Coastal Motion PT',  'Wallace Boden', 'wallace@coastalmotion.example.test', '910-555-0130'),
  ('Definitely Not Spam','A Bot',         'noreply@spam.example.test',          '000-000-0000')
) AS v(org_name, contact_name, email, phone)
WHERE NOT EXISTS (
  SELECT 1 FROM public.inbound_leads l
  WHERE l.org_name = v.org_name AND l.contact_email = v.email
);

-- ---------------------------------------------------------------------------
-- E1.3 — TS-35 L3 fixture: one seeded provider on Outer Banks Rehab Group
-- with a primary group assignment and TWO state licenses — the NC license
-- verified against the state board (PSV trail populated), the SC license
-- unverified. Idempotent by natural keys (group name per org, provider npi
-- per org, unique assignment tuple, unique (provider, state, number)).
-- ---------------------------------------------------------------------------
INSERT INTO public.provider_groups (org_id, name, tin, npi_type2, states, billing_street, billing_city, billing_state, billing_zip, billing_phone)
SELECT o.id, 'Outer Banks Rehab Group LLC', '561234567', '1902837465', ARRAY['NC','SC'],
       '4104 S Croatan Hwy', 'Nags Head', 'NC', '27959', '252-555-0100'
FROM public.organizations o
WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = 'outerbanksrehabgroup'
  AND NOT EXISTS (
    SELECT 1 FROM public.provider_groups g
    WHERE g.org_id = o.id AND g.name = 'Outer Banks Rehab Group LLC'
  );

INSERT INTO public.providers (org_id, group_id, first_name, last_name, credentials, npi, specialty, taxonomy_code, caqh_id, caqh_last_attested_date, status)
SELECT o.id, g.id, 'Brooke', 'Ostrander', 'PT, DPT', '1093817465', 'Physical Therapy', '225100000X', '16224897', '2026-06-15', 'onboarding'
FROM public.organizations o
JOIN public.provider_groups g ON g.org_id = o.id AND g.name = 'Outer Banks Rehab Group LLC'
WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = 'outerbanksrehabgroup'
  AND NOT EXISTS (
    SELECT 1 FROM public.providers p WHERE p.org_id = o.id AND p.npi = '1093817465'
  );

INSERT INTO public.provider_group_assignments (org_id, provider_id, group_id, is_primary)
SELECT p.org_id, p.id, g.id, true
FROM public.providers p
JOIN public.provider_groups g ON g.org_id = p.org_id AND g.name = 'Outer Banks Rehab Group LLC'
WHERE p.npi = '1093817465'
ON CONFLICT ON CONSTRAINT provider_group_assignments_provider_id_group_id_key DO NOTHING;

-- NC license: PSV-verified against the NC board lookup (TS-35 given state).
INSERT INTO public.state_licenses (org_id, provider_id, state, license_number, license_type, issue_date, expiration_date, status, verified_status, verified_at, verified_by, verification_source_url)
SELECT p.org_id, p.id, 'NC', 'PT-48213', 'full', '2023-02-01', '2027-01-31', 'active',
       'verified', '2026-07-10T14:30:00Z', NULL, 'https://www.ncbpte.org/license-verification'
FROM public.providers p
WHERE p.npi = '1093817465'
  AND NOT EXISTS (
    SELECT 1 FROM public.state_licenses l
    WHERE l.provider_id = p.id AND l.state = 'NC' AND l.license_number = 'PT-48213'
  );

-- SC license: entered but not yet verified (the TS-35 dark half).
INSERT INTO public.state_licenses (org_id, provider_id, state, license_number, license_type, issue_date, expiration_date, status, verified_status)
SELECT p.org_id, p.id, 'SC', 'PT-11902', 'compact', '2024-05-01', '2026-12-31', 'active', 'unverified'
FROM public.providers p
WHERE p.npi = '1093817465'
  AND NOT EXISTS (
    SELECT 1 FROM public.state_licenses l
    WHERE l.provider_id = p.id AND l.state = 'SC' AND l.license_number = 'PT-11902'
  );

-- ---------------------------------------------------------------------------
-- E1.6 — Global payer catalog fixtures (TS-36/TS-37/TS-38).
-- A representative slice of the full reference dataset
-- (docs/redesign/data/payer-catalog/) covering the six seed-universe states
-- NC/SC/CO/TX/WI/OR: per-state Blues + two nationals. Global rows
-- (org_id IS NULL) are platform-managed and invisible to orgs until assigned
-- via org_payer_assignments — seeding them is inert for org flows.
-- Idempotent on the uq_payers_payer_slug partial unique.
-- ---------------------------------------------------------------------------
INSERT INTO public.payers (org_id, payer_slug, name, payer_kind, aliases, states, status, last_synced_at)
VALUES
  (NULL, 'blue-cross-and-blue-shield-of-north-carolina', 'Blue Cross and Blue Shield of North Carolina', 'commercial', ARRAY['BCBSNC', 'Blue Cross NC'], ARRAY['NC'], 'active', now()),
  (NULL, 'bluecross-blueshield-of-south-carolina', 'BlueCross BlueShield of South Carolina', 'commercial', ARRAY['BCBS SC', 'BlueChoice HealthPlan (subsidiary)'], ARRAY['SC'], 'active', now()),
  (NULL, 'anthem-blue-cross-and-blue-shield-of-colorado', 'Anthem Blue Cross and Blue Shield of Colorado (Elevance)', 'commercial', ARRAY['Anthem BCBS of Colorado'], ARRAY['CO'], 'active', now()),
  (NULL, 'blue-cross-and-blue-shield-of-texas', 'Blue Cross and Blue Shield of Texas (HCSC)', 'commercial', ARRAY['BCBSTX'], ARRAY['TX'], 'active', now()),
  (NULL, 'anthem-blue-cross-and-blue-shield-of-wisconsin', 'Anthem Blue Cross and Blue Shield of Wisconsin (Elevance)', 'commercial', ARRAY['Compcare Health Services Insurance Corp (HMO/BadgerCare legal entity)'], ARRAY['WI'], 'active', now()),
  (NULL, 'regence-bluecross-blueshield-of-oregon', 'Regence BlueCross BlueShield of Oregon', 'commercial', ARRAY['Cambia', 'Regence Oregon'], ARRAY['OR'], 'active', now()),
  (NULL, 'unitedhealthcare', 'UnitedHealthcare', 'commercial', ARRAY['UHC', 'UMR', 'Oxford'], ARRAY['CO', 'NC', 'OR', 'SC', 'TX', 'WI'], 'active', now()),
  (NULL, 'cigna-healthcare', 'Cigna Healthcare', 'commercial', ARRAY['Cigna', 'Evernorth'], ARRAY['CO', 'NC', 'OR', 'SC', 'TX', 'WI'], 'active', now())
ON CONFLICT (payer_slug) WHERE payer_slug IS NOT NULL DO NOTHING;

-- TS-38 fixture: one unreviewed sync diff (upstream rename) awaiting review.
INSERT INTO public.payer_catalog_changes (payer_id, field, old_value, new_value, source)
SELECT p.id, 'name', 'Blue Cross and Blue Shield of North Carolina', 'Blue Cross NC (rebranded)', 'sync'
FROM public.payers p
WHERE lower(p.name) = lower('Blue Cross and Blue Shield of North Carolina') AND p.org_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.payer_catalog_changes c
    WHERE c.payer_id = p.id AND c.field = 'name'
      AND c.new_value = 'Blue Cross NC (rebranded)' AND c.review_state = 'unreviewed'
  );

-- ---------------------------------------------------------------------------
-- E4.0 — Payer-pipeline fixtures (TS-69..72) on Dillon Sports Medicine.
-- Fixed UUIDs so the group/providers/payers, four cases, and their append-only
-- pipeline history are idempotent (ON CONFLICT (id) DO NOTHING); org_id is
-- resolved from the seeded Dillon org. Demonstrates: a case walked through the
-- spine to In Review with an RFI round trip + a readable append-only timeline
-- (TS-69); a tracking ID reused on a sibling case for the SAME payer (TS-70
-- duplicate warning); an Approved case with an effective date + BOTH structured
-- provider IDs (TS-71); and a second case at Submitted, ready to be denied —
-- blocked until a reason code is chosen at runtime (TS-72). Local fixture only.
-- ---------------------------------------------------------------------------
INSERT INTO public.provider_groups (id, org_id, name, tin, npi_type2, states, billing_street, billing_city, billing_state, billing_zip, billing_phone)
SELECT 'd4110000-0000-4000-a000-0000000000a1', o.id, 'Dillon Sports Medicine LLC', '742938174', '1748291037', ARRAY['TX'],
       '500 Panther Field Rd', 'Dillon', 'TX', '79714', '432-555-0100'
FROM public.organizations o
WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = 'dillonsportsmedicine'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.providers (id, org_id, group_id, first_name, last_name, credentials, npi, specialty, taxonomy_code, home_state, status)
SELECT v.id, o.id, 'd4110000-0000-4000-a000-0000000000a1', v.first_name, v.last_name, 'PT, DPT', v.npi, 'Physical Therapy', '225100000X', 'TX', 'active'
FROM public.organizations o
CROSS JOIN (VALUES
  ('d4110000-0000-4000-a000-0000000000b1'::uuid, 'Tim', 'Riggins', '1546372819'),
  ('d4110000-0000-4000-a000-0000000000b2'::uuid, 'Jason', 'Street', '1546372820')
) AS v(id, first_name, last_name, npi)
WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = 'dillonsportsmedicine'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payers (id, org_id, name)
SELECT v.id, o.id, v.name
FROM public.organizations o
CROSS JOIN (VALUES
  ('d4110000-0000-4000-a000-0000000000c1'::uuid, 'Blue Cross and Blue Shield of Texas'),
  ('d4110000-0000-4000-a000-0000000000c2'::uuid, 'UnitedHealthcare TX')
) AS v(id, name)
WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = 'dillonsportsmedicine'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.credential_cases (id, org_id, provider_id, group_id, payer_id, state, specialty, payer_pipeline_state, payer_reference_id, confirmed_effective_date, payer_individual_provider_id, payer_group_provider_id)
SELECT v.id, g.org_id, v.provider_id, g.id, v.payer_id, 'TX', 'Physical Therapy',
       v.pstate, v.ref, v.eff, v.ind_id, v.grp_id
FROM public.provider_groups g
CROSS JOIN (VALUES
  ('d4110000-0000-4000-a000-000000000069'::uuid, 'd4110000-0000-4000-a000-0000000000b1'::uuid, 'd4110000-0000-4000-a000-0000000000c1'::uuid, 'in_review', 'TX-APP-77031', NULL::date, NULL::text, NULL::text),
  ('d4110000-0000-4000-a000-000000000070'::uuid, 'd4110000-0000-4000-a000-0000000000b2'::uuid, 'd4110000-0000-4000-a000-0000000000c1'::uuid, 'submitted', 'TX-APP-77031', NULL, NULL, NULL),
  ('d4110000-0000-4000-a000-000000000071'::uuid, 'd4110000-0000-4000-a000-0000000000b1'::uuid, 'd4110000-0000-4000-a000-0000000000c2'::uuid, 'approved', 'TX-UHC-55012', '2026-08-01'::date, 'UHC-IND-88420', 'UHC-GRP-2210'),
  ('d4110000-0000-4000-a000-000000000072'::uuid, 'd4110000-0000-4000-a000-0000000000b2'::uuid, 'd4110000-0000-4000-a000-0000000000c2'::uuid, 'submitted', NULL, NULL, NULL, NULL)
) AS v(id, provider_id, payer_id, pstate, ref, eff, ind_id, grp_id)
WHERE g.id = 'd4110000-0000-4000-a000-0000000000a1'
ON CONFLICT (id) DO NOTHING;

-- Append-only pipeline history for the four cases (idempotent: skipped once any
-- row exists for a case). TS-69 shows the In Review ↔ Action Required RFI round
-- trip; TS-71 ends Approved.
INSERT INTO public.payer_pipeline_history (org_id, case_id, from_state, to_state, is_correction, changed_at)
SELECT c.org_id, c.id, v.from_state, v.to_state, false, v.changed_at::timestamptz
FROM public.credential_cases c
JOIN (VALUES
  ('d4110000-0000-4000-a000-000000000069'::uuid, 'not_started', 'assigned', '2026-07-01T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000069'::uuid, 'assigned', 'drafting', '2026-07-02T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000069'::uuid, 'drafting', 'submitted', '2026-07-05T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000069'::uuid, 'submitted', 'in_review', '2026-07-08T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000069'::uuid, 'in_review', 'action_required', '2026-07-10T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000069'::uuid, 'action_required', 'in_review', '2026-07-12T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000070'::uuid, 'not_started', 'assigned', '2026-07-03T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000070'::uuid, 'assigned', 'drafting', '2026-07-04T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000070'::uuid, 'drafting', 'submitted', '2026-07-06T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000071'::uuid, 'not_started', 'assigned', '2026-07-02T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000071'::uuid, 'assigned', 'drafting', '2026-07-03T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000071'::uuid, 'drafting', 'submitted', '2026-07-05T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000071'::uuid, 'submitted', 'in_review', '2026-07-09T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000071'::uuid, 'in_review', 'approved', '2026-07-14T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000072'::uuid, 'not_started', 'assigned', '2026-07-06T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000072'::uuid, 'assigned', 'drafting', '2026-07-07T09:00:00Z'),
  ('d4110000-0000-4000-a000-000000000072'::uuid, 'drafting', 'submitted', '2026-07-09T09:00:00Z')
) AS v(case_id, from_state, to_state, changed_at) ON v.case_id = c.id
WHERE NOT EXISTS (SELECT 1 FROM public.payer_pipeline_history h WHERE h.case_id = c.id);

-- ---------------------------------------------------------------------------
-- E4.1 — Structured touches & follow-up cadence (TS-73..75) on the Dillon cases.
-- org_id resolved from the case; fixed UUIDs + ON CONFLICT (id) DO NOTHING.
-- Demonstrates: the seven touch types + legacy `mail`; optional dispositions
-- (incl. Other + context); prominent recipient capture; follow-up carry-forward
-- (a date-less touch keeps the prior follow-up — case 069) and an explicit clear
-- (case 072); an overdue follow-up that surfaces in the queue (case 070, due
-- 2026-07-10 < the 2026-07-15 fixture "today"); and an append-only correction
-- pair (case 069). Local fixture only.
-- ---------------------------------------------------------------------------
INSERT INTO public.touches (id, org_id, case_id, touch_date, entry_type, touch_type, outcome, next_follow_up_date, clears_follow_up, recipient_name, recipient_contact, notes, source, created_at)
SELECT v.id::uuid, c.org_id, c.id, v.touch_date::date, 'touchpoint', v.touch_type, v.outcome,
       v.next_follow_up_date::date, v.clears_follow_up, v.recipient_name, v.recipient_contact, v.notes,
       'manual', v.created_at::timestamptz
FROM public.credential_cases c
JOIN (VALUES
  ('e41d0000-0000-4000-a000-000000000001', 'd4110000-0000-4000-a000-000000000069', '2026-07-08', 'portal', 'successful', '2026-07-22', false, 'BCBS TX Provider Relations', '800-555-0069', 'Portal Check — application received, in review. Re-check in ~2 weeks.', '2026-07-08T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000002', 'd4110000-0000-4000-a000-000000000069', '2026-07-11', 'provider_outreach', 'attempted', NULL, false, 'Tim Riggins', 'tim.riggins@example.test', 'Asked the provider to upload an updated COI. No new follow-up — the 07-22 re-check carries forward.', '2026-07-11T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000003', 'd4110000-0000-4000-a000-000000000069', '2026-07-12', 'call', 'attempted', NULL, false, 'BCBS TX Rep', '800-555-0069', 'Left a voicemail; quoted reference TX-APP-77301.', '2026-07-12T10:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000004', 'd4110000-0000-4000-a000-000000000070', '2026-07-02', 'email', 'sent', '2026-07-10', false, 'BCBS TX Enrollment', 'enrollment@example.test', 'Emailed the enrollment packet; awaiting confirmation.', '2026-07-02T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000005', 'd4110000-0000-4000-a000-000000000070', '2026-07-05', 'fax', 'confirmed_received', NULL, false, 'BCBS TX Fax', '800-555-0199', 'Faxed supporting documents; confirmation received.', '2026-07-05T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000006', 'd4110000-0000-4000-a000-000000000071', '2026-06-20', 'mail', 'delivered', NULL, false, NULL, NULL, 'Mailed a W-9 and a voided check to UHC.', '2026-06-20T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000007', 'd4110000-0000-4000-a000-000000000071', '2026-07-01', 'caqh_update', 'successful', NULL, false, NULL, NULL, 'Re-attested CAQH; confirmed taxonomy 225100000X.', '2026-07-01T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000008', 'd4110000-0000-4000-a000-000000000072', '2026-07-08', 'portal', 'successful', '2026-07-25', false, NULL, NULL, 'Portal Check — draft saved, awaiting review.', '2026-07-08T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000009', 'd4110000-0000-4000-a000-000000000072', '2026-07-09', 'internal_sync', 'other', NULL, false, NULL, NULL, 'Internal sync: escalate the UHC delay to the team lead.', '2026-07-09T09:00:00Z'),
  ('e41d0000-0000-4000-a000-000000000010', 'd4110000-0000-4000-a000-000000000072', '2026-07-12', 'portal', 'successful', NULL, true, NULL, NULL, 'Confirmed submitted in the portal; clearing the open follow-up.', '2026-07-12T09:00:00Z')
) AS v(id, case_id, touch_date, touch_type, outcome, next_follow_up_date, clears_follow_up, recipient_name, recipient_contact, notes, created_at)
  ON v.case_id::uuid = c.id
ON CONFLICT (id) DO NOTHING;

-- The correction row is a SEPARATE insert so its self-FK (corrects_touch_id)
-- resolves against the already-inserted original above (case 069, row …003).
INSERT INTO public.touches (id, org_id, case_id, touch_date, entry_type, touch_type, outcome, next_follow_up_date, clears_follow_up, recipient_name, recipient_contact, notes, corrects_touch_id, source, created_at)
SELECT 'e41d0000-0000-4000-a000-000000000011'::uuid, c.org_id, c.id, '2026-07-12'::date, 'touchpoint', 'call', 'successful',
       NULL, false, 'BCBS TX Rep', '800-555-0069',
       'Correction: the reference number is TX-APP-77031 (digits were transposed in the prior entry).',
       'e41d0000-0000-4000-a000-000000000003'::uuid, 'manual', '2026-07-12T14:00:00Z'::timestamptz
FROM public.credential_cases c
WHERE c.id = 'd4110000-0000-4000-a000-000000000069'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E4.2 — Payer & SOP admin module fixtures on Dillon Sports Medicine.
--
-- TS-76: P4 Company Owner / Ops Lead maps to the existing ADMIN role (TE-2).
-- The P4 persona signs in as an admin membership on Dillon; like every other
-- membership that seed row is wired by the test harness (this file never seeds
-- auth.users/memberships — GoTrue owns them). No standalone seed row is needed
-- beyond the existing Dillon owner (owner.dillon@example.test), who is the P4.
--
-- TS-99: a DESIGNATED TEST PROVIDER — an ordinary providers row flagged
-- is_test_provider, excluded from every work surface by the shared predicate.
-- The "Sowmya dummy provider" pattern, made first-class.
INSERT INTO public.providers
  (id, org_id, group_id, first_name, last_name, credentials, npi, specialty, taxonomy_code, home_state, status, is_test_provider)
SELECT 'e42d0000-0000-4000-a000-0000000000f1'::uuid, o.id,
       'd4110000-0000-4000-a000-0000000000a1'::uuid,
       'Sowmya', 'Test', 'PT, DPT', '1999999999', 'Physical Therapy', '225100000X', 'TX', 'active', true
FROM public.organizations o
WHERE o.name = 'Dillon Sports Medicine'
ON CONFLICT (id) DO NOTHING;

-- TS-78: an org-added denial reason code on Dillon (in addition to the six
-- global defaults seeded by E4.0). Demonstrates add + deactivate + historical
-- rendering; deactivation is exercised by the e2e, not seeded here.
INSERT INTO public.denial_reason_codes (id, org_id, code, label, active)
SELECT 'e42d0000-0000-4000-a000-0000000000f2'::uuid, o.id, 'roster_mismatch', 'Roster mismatch', true
FROM public.organizations o
WHERE o.name = 'Dillon Sports Medicine'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E4.5 — Document storage fixtures on Dillon Sports Medicine (TS-89 L3).
--
-- Staggered expirations for the expiring-credentials table + the advisory
-- readiness integration: an EXPIRED provider State License, a group COI
-- expiring INSIDE the 30-day window (two versions — the superseded v1 shows
-- immutable history, TS-88's re-upload shape), and a comfortably CURRENT
-- provider DEA. Dates are relative to the seeding day (CURRENT_DATE) so the
-- classification holds whenever the universe is seeded; ON CONFLICT keeps
-- re-seeds idempotent (dates freeze at first insert — L3 metadata only).
--
-- METADATA-ONLY fixtures: the file_path rows follow the TE-2 org-bound
-- contract but no object exists in Storage (TS-88/TS-90 downloads run through
-- the mock e2e harness; live download of a seed row 404s honestly).
INSERT INTO public.provider_documents
  (id, org_id, provider_id, group_id, doc_type, file_name, file_path, expiration_date,
   document_family_id, version_number, supersedes_document_id)
SELECT 'e45d0000-0000-4000-a000-000000000001'::uuid, o.id,
       'd4110000-0000-4000-a000-0000000000b1'::uuid, NULL,
       'state_license', 'tx-license-riggins.pdf',
       'org/' || o.id || '/provider/d4110000-0000-4000-a000-0000000000b1/e45f0000-0000-4000-a000-000000000001/1/tx-license-riggins.pdf',
       CURRENT_DATE - 10,
       'e45f0000-0000-4000-a000-000000000001'::uuid, 1, NULL
FROM public.organizations o WHERE o.name = 'Dillon Sports Medicine'
ON CONFLICT (id) DO NOTHING;

-- The group COI family: v1 (long expired, superseded) -> v2 (current head,
-- expiring in 21 days -> the TS-89 gherkin's advisory + expiring-soon row).
INSERT INTO public.provider_documents
  (id, org_id, provider_id, group_id, doc_type, file_name, file_path, expiration_date,
   document_family_id, version_number, supersedes_document_id)
SELECT 'e45d0000-0000-4000-a000-000000000002'::uuid, o.id,
       NULL, 'd4110000-0000-4000-a000-0000000000a1'::uuid,
       'coi', 'dillon-coi-2025.pdf',
       'org/' || o.id || '/group/d4110000-0000-4000-a000-0000000000a1/e45f0000-0000-4000-a000-000000000002/1/dillon-coi-2025.pdf',
       CURRENT_DATE - 300,
       'e45f0000-0000-4000-a000-000000000002'::uuid, 1, NULL
FROM public.organizations o WHERE o.name = 'Dillon Sports Medicine'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.provider_documents
  (id, org_id, provider_id, group_id, doc_type, file_name, file_path, expiration_date,
   document_family_id, version_number, supersedes_document_id)
SELECT 'e45d0000-0000-4000-a000-000000000003'::uuid, o.id,
       NULL, 'd4110000-0000-4000-a000-0000000000a1'::uuid,
       'coi', 'dillon-coi-2026.pdf',
       'org/' || o.id || '/group/d4110000-0000-4000-a000-0000000000a1/e45f0000-0000-4000-a000-000000000002/2/dillon-coi-2026.pdf',
       CURRENT_DATE + 21,
       'e45f0000-0000-4000-a000-000000000002'::uuid, 2,
       'e45d0000-0000-4000-a000-000000000002'::uuid
FROM public.organizations o WHERE o.name = 'Dillon Sports Medicine'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.provider_documents
  (id, org_id, provider_id, group_id, doc_type, file_name, file_path, expiration_date,
   document_family_id, version_number, supersedes_document_id)
SELECT 'e45d0000-0000-4000-a000-000000000004'::uuid, o.id,
       'd4110000-0000-4000-a000-0000000000b1'::uuid, NULL,
       'dea', 'dea-riggins.pdf',
       'org/' || o.id || '/provider/d4110000-0000-4000-a000-0000000000b1/e45f0000-0000-4000-a000-000000000004/1/dea-riggins.pdf',
       CURRENT_DATE + 200,
       'e45f0000-0000-4000-a000-000000000004'::uuid, 1, NULL
FROM public.organizations o WHERE o.name = 'Dillon Sports Medicine'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E6.8 — Payer lifecycle fixtures (TS-139).
-- ONE manual duplicate of the seeded UnitedHealthcare global fixture — the
-- known manual-setup failure mode: a variant spelling ("United Healthcare",
-- with the space) slips past the E6.7 normalized-name guard, and TS-139
-- merges it into the canonical survivor via merge_payer. GLOBAL row
-- (org_id NULL), source 'manual', no slug — exactly what create_payer would
-- mint. TS-138/TS-140 are L1 derivations over the existing Dillon cases and
-- seeded payers (no rows needed); the TS-139 case-collision slice creates
-- its colliding cases at probe/test time, never in seed.
-- Idempotent on the normalized-name key (the uq_payers_global_normalized_name
-- grain — an ON CONFLICT can't target the expression index portably, so the
-- guard is a NOT EXISTS on the same expression).
-- ---------------------------------------------------------------------------
INSERT INTO public.payers (org_id, name, payer_kind, states, status, source)
SELECT NULL, 'United Healthcare', 'commercial', ARRAY['NC', 'TX'], 'active', 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payers p
  WHERE p.org_id IS NULL AND p.status <> 'merged'
    AND lower(btrim(p.name)) = lower(btrim('United Healthcare'))
);

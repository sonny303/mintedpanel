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

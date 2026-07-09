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

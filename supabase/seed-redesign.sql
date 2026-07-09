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
--   E0.2 — Zeb sales rep + per-org customer contacts (added in that PR).
--   E0.3 — TS-9–TS-11 party/role states (added in that PR).

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

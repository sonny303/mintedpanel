-- seed_universe_v1.sql
-- Seed universe from docs/redesign/seed-universe.md injected as live rows
-- (11 fictional orgs + owner parties + owner role assignments + operator
-- memberships + the canonical 22-status set per org).
--
-- Written 2026-07-10 against hosted project fkvuhfsqcmujywzgczmc.
-- Safety properties:
--   * INSERT only - no UPDATE/DELETE/DDL. Existing rows are never touched.
--   * Every row has a fixed, hardcoded UUID (prefix 5eed...), so the script
--     is idempotent (re-run inserts 0 rows) and the rollback is exact.
--   * Every INSERT carries ON CONFLICT ... DO NOTHING on the correct
--     conflict target for its table.
--   * One transaction - all or nothing.
-- ID scheme (all fixed, greppable by the 5eed prefix):
--   organizations          5eed0001-0000-4000-a000-0000000000NN  (NN = org 01..11)
--   parties (P5 owners)    5eed0002-0000-4000-a000-0000000000NN
--   party_role_assignments 5eed0003-0000-4000-a000-0000000000NN
--   memberships            5eed0004-0000-4000-a000-0000000000NN  (12 = coordinator on Shelby)
--   status_configs         5eed0005-0000-4000-a000-0000NN0000MM  (MM = status 01..22)
-- Persona -> login mapping (fictional .test logins would require auth.users
-- rows, which GoTrue owns; mapped onto existing production logins instead):
--   P1 Credentialing Manager "Sowmya Seed" -> sowmya@minted.com  (admin on all 11)
--   P2 Coordinator "Coordinator Seed"      -> test@minted.com    (specialist on Shelby Sports Rehab)
--   P5 owners -> parties rows + 'owner' role assignments (no logins).
-- Rollback: seed_universe_v1_rollback.sql (reverse dependency order, scoped
-- to these hardcoded UUIDs only).

BEGIN;

-- Preflight: fail loudly (aborting the transaction) if referenced fixed
-- points are missing rather than half-seeding.
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '7be296c5-8907-4b54-ad24-c0eb9f6dceed') THEN
    RAISE EXCEPTION 'preflight: P1 profile 7be296c5-8907-4b54-ad24-c0eb9f6dceed (sowmya@minted.com) not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '3a51124e-27e1-44ab-a137-de704990f96a') THEN
    RAISE EXCEPTION 'preflight: P2 profile 3a51124e-27e1-44ab-a137-de704990f96a (test@minted.com) not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.party_role_types WHERE role_key = 'owner' AND is_active) THEN
    RAISE EXCEPTION 'preflight: party role type ''owner'' missing or inactive';
  END IF;
END
$preflight$;

-- 1) Organizations (11) ------------------------------------------------------
INSERT INTO public.organizations (id, name, lifecycle_state) VALUES
  ('5eed0001-0000-4000-a000-000000000001', 'Outer Banks Rehab Group', 'active'),
  ('5eed0001-0000-4000-a000-000000000002', 'Tree Hill Sports Therapy', 'prospect'),
  ('5eed0001-0000-4000-a000-000000000003', 'Shelby Sports Rehab', 'active'),
  ('5eed0001-0000-4000-a000-000000000004', 'Outer Banks Therapy Group', 'inactive'),
  ('5eed0001-0000-4000-a000-000000000005', 'Gemstone Family Rehab', 'active'),
  ('5eed0001-0000-4000-a000-000000000006', 'Lowcountry Charm PT', 'prospect'),
  ('5eed0001-0000-4000-a000-000000000007', 'South Park Physical Therapy', 'active'),
  ('5eed0001-0000-4000-a000-000000000008', 'Dillon Sports Medicine', 'active'),
  ('5eed0001-0000-4000-a000-000000000009', 'Lone Star Rehab Group', 'prospect'),
  ('5eed0001-0000-4000-a000-000000000010', 'Point Place Physical Therapy', 'active'),
  ('5eed0001-0000-4000-a000-000000000011', 'Rose City Rehab Collective', 'prospect')
ON CONFLICT (id) DO NOTHING;

-- 2) Owner parties (11, P5) --------------------------------------------------
-- created_by = sowmya@minted.com, matching the app's party-creation pattern.
INSERT INTO public.parties (id, party_type, name, email, created_by) VALUES
  ('5eed0002-0000-4000-a000-000000000001', 'person', 'Owner Outer Banks', 'owner.outer-banks@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000002', 'person', 'Owner Tree Hill', 'owner.tree-hill@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000003', 'person', 'Owner Shelby', 'owner.shelby@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000004', 'person', 'Owner OB Therapy', 'owner.ob-therapy@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000005', 'person', 'Owner Gemstone', 'owner.gemstone@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000006', 'person', 'Owner Lowcountry', 'owner.lowcountry@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000007', 'person', 'Owner South Park', 'owner.south-park@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000008', 'person', 'Owner Dillon', 'owner.dillon@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000009', 'person', 'Owner Lone Star', 'owner.lone-star@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000010', 'person', 'Owner Point Place', 'owner.point-place@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed'),
  ('5eed0002-0000-4000-a000-000000000011', 'person', 'Owner Rose City', 'owner.rose-city@example.test', '7be296c5-8907-4b54-ad24-c0eb9f6dceed')
ON CONFLICT (id) DO NOTHING;

-- 3) Owner role assignments (11, org-scoped) ---------------------------------
INSERT INTO public.party_role_assignments (id, org_id, party_id, role_key, scope_type, scope_id) VALUES
  ('5eed0003-0000-4000-a000-000000000001', '5eed0001-0000-4000-a000-000000000001', '5eed0002-0000-4000-a000-000000000001', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000002', '5eed0001-0000-4000-a000-000000000002', '5eed0002-0000-4000-a000-000000000002', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000003', '5eed0001-0000-4000-a000-000000000003', '5eed0002-0000-4000-a000-000000000003', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000004', '5eed0001-0000-4000-a000-000000000004', '5eed0002-0000-4000-a000-000000000004', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000005', '5eed0001-0000-4000-a000-000000000005', '5eed0002-0000-4000-a000-000000000005', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000006', '5eed0001-0000-4000-a000-000000000006', '5eed0002-0000-4000-a000-000000000006', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000007', '5eed0001-0000-4000-a000-000000000007', '5eed0002-0000-4000-a000-000000000007', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000008', '5eed0001-0000-4000-a000-000000000008', '5eed0002-0000-4000-a000-000000000008', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000009', '5eed0001-0000-4000-a000-000000000009', '5eed0002-0000-4000-a000-000000000009', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000010', '5eed0001-0000-4000-a000-000000000010', '5eed0002-0000-4000-a000-000000000010', 'owner', 'org', NULL),
  ('5eed0003-0000-4000-a000-000000000011', '5eed0001-0000-4000-a000-000000000011', '5eed0002-0000-4000-a000-000000000011', 'owner', 'org', NULL)
ON CONFLICT ON CONSTRAINT party_role_assignments_unique DO NOTHING;

-- 4) Memberships (12) --------------------------------------------------------
-- sowmya@minted.com admin on all 11 (P1 across the portfolio, scenario TS-5);
-- test@minted.com specialist on Shelby Sports Rehab (P2 multi-operator, TS-8).
INSERT INTO public.memberships (id, org_id, user_id, role) VALUES
  ('5eed0004-0000-4000-a000-000000000001', '5eed0001-0000-4000-a000-000000000001', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000002', '5eed0001-0000-4000-a000-000000000002', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000003', '5eed0001-0000-4000-a000-000000000003', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000004', '5eed0001-0000-4000-a000-000000000004', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000005', '5eed0001-0000-4000-a000-000000000005', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000006', '5eed0001-0000-4000-a000-000000000006', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000007', '5eed0001-0000-4000-a000-000000000007', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000008', '5eed0001-0000-4000-a000-000000000008', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000009', '5eed0001-0000-4000-a000-000000000009', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000010', '5eed0001-0000-4000-a000-000000000010', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000011', '5eed0001-0000-4000-a000-000000000011', '7be296c5-8907-4b54-ad24-c0eb9f6dceed', 'admin'),
  ('5eed0004-0000-4000-a000-000000000012', '5eed0001-0000-4000-a000-000000000003', '3a51124e-27e1-44ab-a137-de704990f96a', 'specialist')
ON CONFLICT (org_id, user_id) DO NOTHING;

-- 5) Canonical status configs (22 per org, 242 total) ------------------------
-- Mirrors the create_organization() RPC seed so seeded orgs behave like
-- app-created orgs when switched into.
INSERT INTO public.status_configs (id, org_id, track, label, color, sort_order, action_bucket) VALUES
  ('5eed0005-0000-4000-a000-000001000001', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000001000002', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000001000003', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000001000004', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000001000005', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000001000006', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000001000007', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000001000008', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000001000009', '5eed0001-0000-4000-a000-000000000001', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000001000010', '5eed0001-0000-4000-a000-000000000001', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000001000011', '5eed0001-0000-4000-a000-000000000001', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000001000012', '5eed0001-0000-4000-a000-000000000001', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000001000013', '5eed0001-0000-4000-a000-000000000001', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000001000014', '5eed0001-0000-4000-a000-000000000001', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000001000015', '5eed0001-0000-4000-a000-000000000001', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000001000016', '5eed0001-0000-4000-a000-000000000001', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000001000017', '5eed0001-0000-4000-a000-000000000001', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000001000018', '5eed0001-0000-4000-a000-000000000001', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000001000019', '5eed0001-0000-4000-a000-000000000001', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000001000020', '5eed0001-0000-4000-a000-000000000001', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000001000021', '5eed0001-0000-4000-a000-000000000001', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000001000022', '5eed0001-0000-4000-a000-000000000001', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000002000001', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000002000002', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000002000003', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000002000004', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000002000005', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000002000006', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000002000007', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000002000008', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000002000009', '5eed0001-0000-4000-a000-000000000002', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000002000010', '5eed0001-0000-4000-a000-000000000002', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000002000011', '5eed0001-0000-4000-a000-000000000002', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000002000012', '5eed0001-0000-4000-a000-000000000002', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000002000013', '5eed0001-0000-4000-a000-000000000002', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000002000014', '5eed0001-0000-4000-a000-000000000002', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000002000015', '5eed0001-0000-4000-a000-000000000002', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000002000016', '5eed0001-0000-4000-a000-000000000002', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000002000017', '5eed0001-0000-4000-a000-000000000002', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000002000018', '5eed0001-0000-4000-a000-000000000002', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000002000019', '5eed0001-0000-4000-a000-000000000002', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000002000020', '5eed0001-0000-4000-a000-000000000002', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000002000021', '5eed0001-0000-4000-a000-000000000002', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000002000022', '5eed0001-0000-4000-a000-000000000002', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000003000001', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000003000002', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000003000003', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000003000004', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000003000005', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000003000006', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000003000007', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000003000008', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000003000009', '5eed0001-0000-4000-a000-000000000003', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000003000010', '5eed0001-0000-4000-a000-000000000003', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000003000011', '5eed0001-0000-4000-a000-000000000003', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000003000012', '5eed0001-0000-4000-a000-000000000003', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000003000013', '5eed0001-0000-4000-a000-000000000003', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000003000014', '5eed0001-0000-4000-a000-000000000003', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000003000015', '5eed0001-0000-4000-a000-000000000003', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000003000016', '5eed0001-0000-4000-a000-000000000003', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000003000017', '5eed0001-0000-4000-a000-000000000003', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000003000018', '5eed0001-0000-4000-a000-000000000003', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000003000019', '5eed0001-0000-4000-a000-000000000003', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000003000020', '5eed0001-0000-4000-a000-000000000003', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000003000021', '5eed0001-0000-4000-a000-000000000003', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000003000022', '5eed0001-0000-4000-a000-000000000003', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000004000001', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000004000002', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000004000003', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000004000004', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000004000005', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000004000006', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000004000007', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000004000008', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000004000009', '5eed0001-0000-4000-a000-000000000004', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000004000010', '5eed0001-0000-4000-a000-000000000004', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000004000011', '5eed0001-0000-4000-a000-000000000004', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000004000012', '5eed0001-0000-4000-a000-000000000004', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000004000013', '5eed0001-0000-4000-a000-000000000004', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000004000014', '5eed0001-0000-4000-a000-000000000004', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000004000015', '5eed0001-0000-4000-a000-000000000004', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000004000016', '5eed0001-0000-4000-a000-000000000004', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000004000017', '5eed0001-0000-4000-a000-000000000004', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000004000018', '5eed0001-0000-4000-a000-000000000004', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000004000019', '5eed0001-0000-4000-a000-000000000004', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000004000020', '5eed0001-0000-4000-a000-000000000004', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000004000021', '5eed0001-0000-4000-a000-000000000004', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000004000022', '5eed0001-0000-4000-a000-000000000004', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000005000001', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000005000002', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000005000003', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000005000004', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000005000005', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000005000006', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000005000007', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000005000008', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000005000009', '5eed0001-0000-4000-a000-000000000005', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000005000010', '5eed0001-0000-4000-a000-000000000005', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000005000011', '5eed0001-0000-4000-a000-000000000005', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000005000012', '5eed0001-0000-4000-a000-000000000005', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000005000013', '5eed0001-0000-4000-a000-000000000005', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000005000014', '5eed0001-0000-4000-a000-000000000005', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000005000015', '5eed0001-0000-4000-a000-000000000005', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000005000016', '5eed0001-0000-4000-a000-000000000005', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000005000017', '5eed0001-0000-4000-a000-000000000005', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000005000018', '5eed0001-0000-4000-a000-000000000005', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000005000019', '5eed0001-0000-4000-a000-000000000005', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000005000020', '5eed0001-0000-4000-a000-000000000005', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000005000021', '5eed0001-0000-4000-a000-000000000005', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000005000022', '5eed0001-0000-4000-a000-000000000005', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000006000001', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000006000002', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000006000003', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000006000004', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000006000005', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000006000006', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000006000007', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000006000008', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000006000009', '5eed0001-0000-4000-a000-000000000006', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000006000010', '5eed0001-0000-4000-a000-000000000006', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000006000011', '5eed0001-0000-4000-a000-000000000006', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000006000012', '5eed0001-0000-4000-a000-000000000006', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000006000013', '5eed0001-0000-4000-a000-000000000006', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000006000014', '5eed0001-0000-4000-a000-000000000006', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000006000015', '5eed0001-0000-4000-a000-000000000006', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000006000016', '5eed0001-0000-4000-a000-000000000006', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000006000017', '5eed0001-0000-4000-a000-000000000006', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000006000018', '5eed0001-0000-4000-a000-000000000006', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000006000019', '5eed0001-0000-4000-a000-000000000006', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000006000020', '5eed0001-0000-4000-a000-000000000006', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000006000021', '5eed0001-0000-4000-a000-000000000006', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000006000022', '5eed0001-0000-4000-a000-000000000006', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000007000001', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000007000002', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000007000003', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000007000004', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000007000005', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000007000006', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000007000007', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000007000008', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000007000009', '5eed0001-0000-4000-a000-000000000007', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000007000010', '5eed0001-0000-4000-a000-000000000007', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000007000011', '5eed0001-0000-4000-a000-000000000007', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000007000012', '5eed0001-0000-4000-a000-000000000007', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000007000013', '5eed0001-0000-4000-a000-000000000007', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000007000014', '5eed0001-0000-4000-a000-000000000007', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000007000015', '5eed0001-0000-4000-a000-000000000007', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000007000016', '5eed0001-0000-4000-a000-000000000007', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000007000017', '5eed0001-0000-4000-a000-000000000007', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000007000018', '5eed0001-0000-4000-a000-000000000007', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000007000019', '5eed0001-0000-4000-a000-000000000007', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000007000020', '5eed0001-0000-4000-a000-000000000007', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000007000021', '5eed0001-0000-4000-a000-000000000007', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000007000022', '5eed0001-0000-4000-a000-000000000007', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000008000001', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000008000002', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000008000003', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000008000004', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000008000005', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000008000006', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000008000007', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000008000008', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000008000009', '5eed0001-0000-4000-a000-000000000008', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000008000010', '5eed0001-0000-4000-a000-000000000008', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000008000011', '5eed0001-0000-4000-a000-000000000008', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000008000012', '5eed0001-0000-4000-a000-000000000008', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000008000013', '5eed0001-0000-4000-a000-000000000008', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000008000014', '5eed0001-0000-4000-a000-000000000008', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000008000015', '5eed0001-0000-4000-a000-000000000008', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000008000016', '5eed0001-0000-4000-a000-000000000008', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000008000017', '5eed0001-0000-4000-a000-000000000008', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000008000018', '5eed0001-0000-4000-a000-000000000008', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000008000019', '5eed0001-0000-4000-a000-000000000008', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000008000020', '5eed0001-0000-4000-a000-000000000008', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000008000021', '5eed0001-0000-4000-a000-000000000008', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000008000022', '5eed0001-0000-4000-a000-000000000008', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000009000001', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000009000002', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000009000003', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000009000004', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000009000005', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000009000006', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000009000007', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000009000008', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000009000009', '5eed0001-0000-4000-a000-000000000009', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000009000010', '5eed0001-0000-4000-a000-000000000009', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000009000011', '5eed0001-0000-4000-a000-000000000009', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000009000012', '5eed0001-0000-4000-a000-000000000009', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000009000013', '5eed0001-0000-4000-a000-000000000009', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000009000014', '5eed0001-0000-4000-a000-000000000009', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000009000015', '5eed0001-0000-4000-a000-000000000009', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000009000016', '5eed0001-0000-4000-a000-000000000009', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000009000017', '5eed0001-0000-4000-a000-000000000009', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000009000018', '5eed0001-0000-4000-a000-000000000009', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000009000019', '5eed0001-0000-4000-a000-000000000009', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000009000020', '5eed0001-0000-4000-a000-000000000009', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000009000021', '5eed0001-0000-4000-a000-000000000009', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000009000022', '5eed0001-0000-4000-a000-000000000009', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000010000001', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000010000002', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000010000003', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000010000004', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000010000005', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000010000006', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000010000007', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000010000008', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000010000009', '5eed0001-0000-4000-a000-000000000010', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000010000010', '5eed0001-0000-4000-a000-000000000010', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000010000011', '5eed0001-0000-4000-a000-000000000010', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000010000012', '5eed0001-0000-4000-a000-000000000010', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000010000013', '5eed0001-0000-4000-a000-000000000010', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000010000014', '5eed0001-0000-4000-a000-000000000010', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000010000015', '5eed0001-0000-4000-a000-000000000010', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000010000016', '5eed0001-0000-4000-a000-000000000010', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000010000017', '5eed0001-0000-4000-a000-000000000010', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000010000018', '5eed0001-0000-4000-a000-000000000010', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000010000019', '5eed0001-0000-4000-a000-000000000010', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000010000020', '5eed0001-0000-4000-a000-000000000010', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000010000021', '5eed0001-0000-4000-a000-000000000010', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000010000022', '5eed0001-0000-4000-a000-000000000010', 'location', 'Inactive', '#9CA3AF', 70, 'complete'),
  ('5eed0005-0000-4000-a000-000011000001', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'Not Started', '#9CA3AF', 5, 'ours'),
  ('5eed0005-0000-4000-a000-000011000002', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'In-Network', '#059669', 10, 'complete'),
  ('5eed0005-0000-4000-a000-000011000003', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'OON', '#DC2626', 20, 'complete'),
  ('5eed0005-0000-4000-a000-000011000004', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'In Progress', '#2563EB', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000011000005', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'Waiting on Provider', '#D97706', 31, 'waiting_provider'),
  ('5eed0005-0000-4000-a000-000011000006', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'Submitted', '#0891B2', 32, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000011000007', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'Approved', '#059669', 35, 'complete'),
  ('5eed0005-0000-4000-a000-000011000008', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'Denied', '#DC2626', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000011000009', '5eed0001-0000-4000-a000-000000000011', 'credentialing', 'Not Required', '#9CA3AF', 45, 'complete'),
  ('5eed0005-0000-4000-a000-000011000010', '5eed0001-0000-4000-a000-000000000011', 'contracting', 'Not Started', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000011000011', '5eed0001-0000-4000-a000-000000000011', 'contracting', 'In Progress', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000011000012', '5eed0001-0000-4000-a000-000000000011', 'contracting', 'Denied', '#DC2626', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000011000013', '5eed0001-0000-4000-a000-000000000011', 'contracting', 'Contracted', '#0891B2', 40, 'waiting_payer'),
  ('5eed0005-0000-4000-a000-000011000014', '5eed0001-0000-4000-a000-000000000011', 'contracting', 'In-Network', '#059669', 50, 'complete'),
  ('5eed0005-0000-4000-a000-000011000015', '5eed0001-0000-4000-a000-000000000011', 'contracting', 'OON', '#DC2626', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000011000016', '5eed0001-0000-4000-a000-000000000011', 'location', 'Prospect', '#9CA3AF', 10, 'ours'),
  ('5eed0005-0000-4000-a000-000011000017', '5eed0001-0000-4000-a000-000000000011', 'location', 'Planned', '#2563EB', 20, 'ours'),
  ('5eed0005-0000-4000-a000-000011000018', '5eed0001-0000-4000-a000-000000000011', 'location', 'Interviewing', '#0891B2', 30, 'ours'),
  ('5eed0005-0000-4000-a000-000011000019', '5eed0001-0000-4000-a000-000000000011', 'location', 'Pending Fulfillment', '#D97706', 40, 'ours'),
  ('5eed0005-0000-4000-a000-000011000020', '5eed0001-0000-4000-a000-000000000011', 'location', 'Ready for Launch', '#059669', 50, 'ours'),
  ('5eed0005-0000-4000-a000-000011000021', '5eed0001-0000-4000-a000-000000000011', 'location', 'Live', '#059669', 60, 'complete'),
  ('5eed0005-0000-4000-a000-000011000022', '5eed0001-0000-4000-a000-000000000011', 'location', 'Inactive', '#9CA3AF', 70, 'complete')
ON CONFLICT (org_id, track, label) DO NOTHING;

COMMIT;

-- E0.7 F0.7.2 TE-3: Stage 0 RLS & GRANT audit
-- Re-runnable verification script. Run against the hosted DB via MCP execute_sql
-- or psql. Every assertion returns a row; an empty result set = all checks pass.
-- If any row is returned, the named assertion failed.
--
-- Tables: parties, party_role_types, party_role_assignments,
--         party_capture_links, inbound_leads, report_shares
-- Functions: the 4 intended anon RPCs + 8 non-public functions

-- 1. RLS must be enabled on all 6 Stage 0 tables
SELECT 'FAIL: RLS not enabled on ' || tablename AS assertion
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'parties', 'party_role_types', 'party_role_assignments',
    'party_capture_links', 'inbound_leads', 'report_shares'
  )
  AND rowsecurity IS NOT TRUE

UNION ALL

-- 2. anon must have ZERO table privileges on all 6 tables
SELECT 'FAIL: anon has ' || privilege_type || ' on ' || table_name AS assertion
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND table_name IN (
    'parties', 'party_role_types', 'party_role_assignments',
    'party_capture_links', 'inbound_leads', 'report_shares'
  )

UNION ALL

-- 3. authenticated must have SELECT, INSERT, UPDATE, DELETE on all 6 tables
SELECT 'FAIL: authenticated missing ' || expected || ' on ' || tbl AS assertion
FROM (
  VALUES
    ('parties', 'SELECT'), ('parties', 'INSERT'), ('parties', 'UPDATE'), ('parties', 'DELETE'),
    ('party_role_types', 'SELECT'), ('party_role_types', 'INSERT'), ('party_role_types', 'UPDATE'), ('party_role_types', 'DELETE'),
    ('party_role_assignments', 'SELECT'), ('party_role_assignments', 'INSERT'), ('party_role_assignments', 'UPDATE'), ('party_role_assignments', 'DELETE'),
    ('party_capture_links', 'SELECT'), ('party_capture_links', 'INSERT'), ('party_capture_links', 'UPDATE'), ('party_capture_links', 'DELETE'),
    ('inbound_leads', 'SELECT'), ('inbound_leads', 'INSERT'), ('inbound_leads', 'UPDATE'), ('inbound_leads', 'DELETE'),
    ('report_shares', 'SELECT'), ('report_shares', 'INSERT'), ('report_shares', 'UPDATE'), ('report_shares', 'DELETE')
) AS expected_grants(tbl, expected)
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name = tbl
    AND grantee = 'authenticated'
    AND privilege_type = expected
)

UNION ALL

-- 4. anon must have EXECUTE on exactly these 4 public RPCs
SELECT 'FAIL: anon cannot execute ' || fn AS assertion
FROM (
  VALUES
    ('validate_capture_token(text)'),
    ('submit_capture(text, jsonb)'),
    ('submit_inbound_lead(jsonb)'),
    ('validate_report_share(text)')
) AS required_anon(fn)
WHERE NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE')

UNION ALL

-- 5. anon must NOT have EXECUTE on these non-public functions
SELECT 'FAIL: anon CAN execute ' || fn || ' (should not)' AS assertion
FROM (
  VALUES
    ('create_organization(text)'),
    ('create_organization(text, text, text)'),
    ('create_organization(text, text, text, jsonb, jsonb)'),
    ('create_capture_link(uuid, uuid, text, text)'),
    ('create_report_share(text, text, uuid, text)'),
    ('revoke_report_share(uuid)'),
    ('assert_contact_valid(jsonb, text)'),
    ('insert_contact_party(jsonb, uuid)'),
    ('reject_inactive_role_assignment()'),
    ('set_updated_at()')
) AS blocked_anon(fn)
WHERE has_function_privilege('anon', 'public.' || fn, 'EXECUTE')

UNION ALL

-- 6. authenticated must have EXECUTE on the authenticated-only RPCs
SELECT 'FAIL: authenticated cannot execute ' || fn AS assertion
FROM (
  VALUES
    ('create_organization(text)'),
    ('create_organization(text, text, text)'),
    ('create_organization(text, text, text, jsonb, jsonb)'),
    ('create_capture_link(uuid, uuid, text, text)'),
    ('create_report_share(text, text, uuid, text)'),
    ('revoke_report_share(uuid)')
) AS required_auth(fn)
WHERE NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')

UNION ALL

-- 7. Internal helpers must NOT be callable by authenticated
SELECT 'FAIL: authenticated CAN execute internal helper ' || fn AS assertion
FROM (
  VALUES
    ('assert_contact_valid(jsonb, text)'),
    ('insert_contact_party(jsonb, uuid)'),
    ('reject_inactive_role_assignment()'),
    ('set_updated_at()')
) AS internal_fn(fn)
WHERE has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')

UNION ALL

-- 8. RLS policies exist on all 6 tables (at least one policy per table)
SELECT 'FAIL: no RLS policies on ' || tbl AS assertion
FROM (
  VALUES ('parties'), ('party_role_types'), ('party_role_assignments'),
         ('party_capture_links'), ('inbound_leads'), ('report_shares')
) AS tables(tbl)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
)

ORDER BY 1;

-- E0.7 F0.7.2: Stage 0 GRANT hardening
--
-- Revokes excess anon table privileges on the 6 Stage 0 tables and locks
-- down function EXECUTE to intended callers only.  All statements are
-- idempotent (REVOKE/GRANT are no-ops when the state already matches).
--
-- Tables affected:
--   parties, party_role_types, party_role_assignments,
--   party_capture_links, inbound_leads, report_shares
--
-- Functions affected:
--   Authenticated-only: create_organization (×3 overloads),
--     create_capture_link, create_report_share, revoke_report_share
--   Internal helpers (no client caller): assert_contact_valid,
--     insert_contact_party
--   Trigger functions (no client caller): reject_inactive_role_assignment,
--     set_updated_at
--   Anon-callable (the 4 intended public RPCs): validate_capture_token,
--     submit_capture, submit_inbound_lead, validate_report_share

----------------------------------------------------------------------
-- 1. TABLE GRANTS — strip anon from all 6 Stage 0 tables
----------------------------------------------------------------------
REVOKE ALL ON TABLE public.parties FROM anon;
REVOKE ALL ON TABLE public.party_role_types FROM anon;
REVOKE ALL ON TABLE public.party_role_assignments FROM anon;
REVOKE ALL ON TABLE public.party_capture_links FROM anon;
REVOKE ALL ON TABLE public.inbound_leads FROM anon;
REVOKE ALL ON TABLE public.report_shares FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.party_role_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.party_role_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.party_capture_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inbound_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.report_shares TO authenticated;

----------------------------------------------------------------------
-- 2. FUNCTION EXECUTE — revoke default PUBLIC grant, re-grant to the
--    intended callers only
----------------------------------------------------------------------

-- 2a. Authenticated-only RPCs
REVOKE EXECUTE ON FUNCTION public.create_organization(text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.create_organization(text, text, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.create_capture_link(uuid, uuid, text, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.create_report_share(text, text, uuid, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_report_share(uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_capture_link(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_report_share(text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_report_share(uuid) TO authenticated;

-- 2b. Internal SECURITY DEFINER helpers (called only from within
--     create_organization v3; the definer context is superuser, so no
--     client role needs EXECUTE)
REVOKE EXECUTE ON FUNCTION public.assert_contact_valid(jsonb, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.insert_contact_party(jsonb, uuid) FROM public, anon, authenticated;

-- 2c. Trigger functions (fired by the trigger mechanism under the
--     function owner's privileges; no client invocation)
REVOKE EXECUTE ON FUNCTION public.reject_inactive_role_assignment() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM public, anon, authenticated;

-- 2d. Anon-callable RPCs — the 4 intended public RPCs.
--     Revoke the broad PUBLIC default, then grant explicitly to anon
--     (+ authenticated so internal callers still work).
REVOKE EXECUTE ON FUNCTION public.validate_capture_token(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.submit_capture(text, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.submit_inbound_lead(jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.validate_report_share(text) FROM public;

GRANT EXECUTE ON FUNCTION public.validate_capture_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_capture(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_inbound_lead(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_report_share(text) TO anon, authenticated;

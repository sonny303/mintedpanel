-- E1.4 TE-3 — atomic primary-practice-location swap (F1.4.3). Two browser
-- PostgREST calls are not atomic and multi-row UPDATE ordering is not a
-- uniqueness guarantee under uq_provider_facility_assignments_one_primary,
-- so the demote+promote happens in ONE transaction here. SECURITY DEFINER
-- with a pinned search_path; the function re-checks membership + writer role
-- and target ownership itself (definer bypasses RLS). EXECUTE granted to
-- authenticated only.
CREATE OR REPLACE FUNCTION public.set_primary_assignment(
  p_provider_id uuid,
  p_assignment_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  IF NOT (v_org IN (SELECT user_org_ids()))
     OR NOT (user_role(v_org) = ANY (ARRAY['specialist'::text, 'admin'::text])) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM provider_facility_assignments
    WHERE id = p_assignment_id AND provider_id = p_provider_id AND org_id = v_org
  ) THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  UPDATE provider_facility_assignments
    SET is_primary = false
    WHERE provider_id = p_provider_id AND org_id = v_org
      AND is_primary AND id <> p_assignment_id;
  UPDATE provider_facility_assignments
    SET is_primary = true
    WHERE id = p_assignment_id AND org_id = v_org AND NOT is_primary;
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_assignment(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_primary_assignment(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_primary_assignment(uuid, uuid) TO authenticated;

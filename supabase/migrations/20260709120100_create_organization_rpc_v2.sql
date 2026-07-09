-- E0.1 TE-1 — create_organization RPC v2 (owner capture, duplicate guard,
-- prospect lifecycle, owner party + assignment).
--
-- Additive: this ADDS the 3-arg overload
-- create_organization(p_name, p_owner_name, p_owner_email) and leaves the legacy
-- 1-arg create_organization(text) in place (dropping it would violate the
-- additive-only migration rule and break the shared hosted DB for the `main`
-- deploy until it is promoted from redesign). Both app call sites (NoOrgScreen
-- first-run path and Admin → Settings CreateOrgPanel) migrate to this enforced
-- 3-arg form in the same PR, so nothing in the redesign app calls the old
-- signature — owner enforcement is never bypassed. The new params carry NO
-- defaults, so a 1-arg-style call cannot reach this enforced path.
--
-- SECURITY DEFINER bootstrap unchanged: caller ADMIN membership, the 22
-- canonical status_configs, and a CREATE audit row. Idempotent (CREATE OR
-- REPLACE). Writes the owner into the canonical party model
-- (20260709120000_party_model_foundation.sql).

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_owner_name text,
  p_owner_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_party_id uuid;
  v_name text := btrim(p_name);
  v_owner_name text := btrim(p_owner_name);
  v_owner_email text := btrim(p_owner_email);
  v_norm text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF v_owner_name = '' THEN
    RAISE EXCEPTION 'Owner name is required';
  END IF;
  IF v_owner_email = '' THEN
    RAISE EXCEPTION 'Owner email is required';
  END IF;
  IF v_owner_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Owner email is not valid';
  END IF;

  -- Duplicate guard (F0.1.4): hard block on a matching normalized name
  -- (case- and space-insensitive). No override; the caller must change the name.
  v_norm := lower(regexp_replace(v_name, '\s+', '', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'An organization named "%" already exists. Please use a different name.', v_name;
  END IF;

  -- New orgs always start as prospect (F0.1.3); promotion to active is automatic
  -- on first scope (Stage 1+), never a manual toggle. E0.0's column defaults to
  -- 'active', so this override is required.
  INSERT INTO public.organizations (name, lifecycle_state)
    VALUES (v_name, 'prospect')
    RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

  INSERT INTO public.status_configs (org_id, track, label, color, sort_order, action_bucket) VALUES
    (v_org_id, 'credentialing', 'Not Started',          '#9CA3AF',  5, 'ours'),
    (v_org_id, 'credentialing', 'In-Network',           '#059669', 10, 'complete'),
    (v_org_id, 'credentialing', 'OON',                  '#DC2626', 20, 'complete'),
    (v_org_id, 'credentialing', 'In Progress',          '#2563EB', 30, 'ours'),
    (v_org_id, 'credentialing', 'Waiting on Provider',  '#D97706', 31, 'waiting_provider'),
    (v_org_id, 'credentialing', 'Submitted',            '#0891B2', 32, 'waiting_payer'),
    (v_org_id, 'credentialing', 'Approved',             '#059669', 35, 'complete'),
    (v_org_id, 'credentialing', 'Denied',               '#DC2626', 40, 'ours'),
    (v_org_id, 'credentialing', 'Not Required',         '#9CA3AF', 45, 'complete'),
    (v_org_id, 'contracting',   'Not Started',          '#9CA3AF', 10, 'ours'),
    (v_org_id, 'contracting',   'In Progress',          '#2563EB', 20, 'ours'),
    (v_org_id, 'contracting',   'Denied',               '#DC2626', 30, 'ours'),
    (v_org_id, 'contracting',   'Contracted',           '#0891B2', 40, 'waiting_payer'),
    (v_org_id, 'contracting',   'In-Network',           '#059669', 50, 'complete'),
    (v_org_id, 'contracting',   'OON',                  '#DC2626', 60, 'complete'),
    (v_org_id, 'location',      'Prospect',             '#9CA3AF', 10, 'ours'),
    (v_org_id, 'location',      'Planned',              '#2563EB', 20, 'ours'),
    (v_org_id, 'location',      'Interviewing',         '#0891B2', 30, 'ours'),
    (v_org_id, 'location',      'Pending Fulfillment',  '#D97706', 40, 'ours'),
    (v_org_id, 'location',      'Ready for Launch',     '#059669', 50, 'ours'),
    (v_org_id, 'location',      'Live',                 '#059669', 60, 'complete'),
    (v_org_id, 'location',      'Inactive',             '#9CA3AF', 70, 'complete');

  -- Owner captured as a Party holding the 'owner' role at org scope (F0.1.2 +
  -- E0.3 F0.3.6 consolidation: one model, no parallel contact store).
  INSERT INTO public.parties (party_type, name, email, created_by)
    VALUES ('person', v_owner_name, v_owner_email, v_uid)
    RETURNING id INTO v_party_id;

  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
    VALUES (v_org_id, v_party_id, 'owner', 'org');

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text) TO authenticated;

-- Hotfix — org intake no longer auto-creates a sales rep.
--
-- E0.2 FR-1 made the sales rep default to a hardcoded "Zeb Loewenstine" identity
-- when the caller omitted it, and E0.8 F0.8.2 then removed the sales-rep field
-- from the intake form entirely — so EVERY org created since E0.8 silently got a
-- placeholder person on its People list with a Sales Rep role nobody asked for.
-- The sales rep is now genuinely OPTIONAL: supplied → validated and stored the
-- same way; omitted → no party, no assignment. Sales reps are added afterwards
-- through the People surface like any other party.
--
-- Signature, arg order, and the 1-/3-arg overloads are unchanged (CREATE OR
-- REPLACE, not a new overload) — the only behavior change is the dropped default.

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_owner_name text,
  p_owner_email text,
  p_customer jsonb,
  p_sales_rep jsonb DEFAULT NULL
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
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_has_sales boolean;
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
  IF v_owner_email !~ v_email_re THEN
    RAISE EXCEPTION 'Owner email is not valid';
  END IF;

  -- Customer contact stays required (E0.2 FR-2). Sales rep is optional: a NULL,
  -- a JSON null, or an empty object means "none" — never a substituted identity.
  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'Customer contact is required';
  END IF;
  PERFORM public.assert_contact_valid(p_customer, 'Customer contact');

  v_has_sales := p_sales_rep IS NOT NULL
             AND jsonb_typeof(p_sales_rep) = 'object'
             AND p_sales_rep <> '{}'::jsonb;
  IF v_has_sales THEN
    PERFORM public.assert_contact_valid(p_sales_rep, 'Sales rep');
  END IF;

  -- Duplicate guard (F0.1.4): hard block on a matching normalized name.
  v_norm := lower(regexp_replace(v_name, '\s+', '', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'An organization named "%" already exists. Please use a different name.', v_name;
  END IF;

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

  -- Owner (E0.1).
  INSERT INTO public.parties (party_type, name, email, created_by)
    VALUES ('person', v_owner_name, v_owner_email, v_uid)
    RETURNING id INTO v_party_id;
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
    VALUES (v_org_id, v_party_id, 'owner', 'org');

  -- Customer escalation contact.
  v_party_id := public.insert_contact_party(p_customer, v_uid);
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
    VALUES (v_org_id, v_party_id, 'customer_escalation_contact', 'org');

  -- Sales rep — ONLY when one was actually supplied.
  IF v_has_sales THEN
    v_party_id := public.insert_contact_party(p_sales_rep, v_uid);
    INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
      VALUES (v_org_id, v_party_id, 'sales_rep', 'org');
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Clean up what the default already wrote.
--
-- Scoped to the placeholder identity the RPC itself minted (that literal email
-- was never a real address) — a sales rep a human entered has a different email
-- and is left alone. Assignments first, then the now-orphaned party rows, so the
-- placeholder also disappears from the cross-org "Add existing person" pool.
-- A no-op on a fresh rebuild and idempotent on re-run.
-- ---------------------------------------------------------------------------
DELETE FROM public.party_role_assignments a
USING public.parties p
WHERE p.id = a.party_id
  AND a.role_key = 'sales_rep'
  AND lower(btrim(coalesce(p.email, ''))) = 'zeb@mintedpanel.example.test';

DELETE FROM public.parties p
WHERE lower(btrim(coalesce(p.email, ''))) = 'zeb@mintedpanel.example.test'
  AND NOT EXISTS (
    SELECT 1 FROM public.party_role_assignments a WHERE a.party_id = p.id
  );

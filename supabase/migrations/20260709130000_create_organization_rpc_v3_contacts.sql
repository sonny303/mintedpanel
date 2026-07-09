-- E0.2 TE-2 — create_organization RPC v3: customer contact + sales rep.
--
-- Additive: adds a 5-arg overload
--   create_organization(p_name, p_owner_name, p_owner_email,
--                       p_customer jsonb, p_sales_rep jsonb DEFAULT NULL)
-- on top of the E0.1 3-arg overload (kept). Unambiguous vs the 3-arg: this form
-- requires the 4th (customer) arg, so a 3-arg call never resolves here. The
-- redesign app migrates BOTH call sites to this form; sales rep defaults to Zeb
-- Loewenstine when omitted (E0.2 FR-1). Both contacts are stored as parties
-- holding their roles at org scope in the canonical party model — one source of
-- truth, no parallel contact store (E0.3 F0.3.6).
--
-- The contact jsonb shape (snake_case, matching parties columns):
--   { name, email, phone_office, phone_mobile?, address_line1, address_line2?,
--     city, state, postal_code, country? }
-- Required for a contact: name, email (valid), phone_office, address_line1,
-- city, state, postal_code (FR-2). Owner stays name+email only (E0.1). E0.2
-- needs NO schema change — the canonical parties table (all phone/address
-- columns) and the customer_escalation_contact/sales_rep roles landed in E0.1.

-- ---------------------------------------------------------------------------
-- Internal helpers (revoked from clients; only the SECURITY DEFINER RPC, as the
-- function owner, calls them). Kept separate so customer + sales rep share one
-- validation + insert path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_contact_valid(p jsonb, p_label text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := btrim(coalesce(p->>'email', ''));
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
BEGIN
  IF p IS NULL THEN RAISE EXCEPTION '% is required', p_label; END IF;
  IF btrim(coalesce(p->>'name', '')) = '' THEN RAISE EXCEPTION '% name is required', p_label; END IF;
  IF v_email = '' THEN RAISE EXCEPTION '% email is required', p_label; END IF;
  IF v_email !~ v_email_re THEN RAISE EXCEPTION '% email is not valid', p_label; END IF;
  IF btrim(coalesce(p->>'phone_office', '')) = '' THEN RAISE EXCEPTION '% phone is required', p_label; END IF;
  IF btrim(coalesce(p->>'address_line1', '')) = '' THEN RAISE EXCEPTION '% street address is required', p_label; END IF;
  IF btrim(coalesce(p->>'city', '')) = '' THEN RAISE EXCEPTION '% city is required', p_label; END IF;
  IF btrim(coalesce(p->>'state', '')) = '' THEN RAISE EXCEPTION '% state is required', p_label; END IF;
  IF btrim(coalesce(p->>'postal_code', '')) = '' THEN RAISE EXCEPTION '% postal code is required', p_label; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_contact_party(p jsonb, p_uid uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.parties (
    party_type, name, email, phone_office, phone_mobile,
    address_line1, address_line2, city, state, postal_code, country, created_by
  ) VALUES (
    'person',
    btrim(p->>'name'),
    btrim(p->>'email'),
    nullif(btrim(coalesce(p->>'phone_office', '')), ''),
    nullif(btrim(coalesce(p->>'phone_mobile', '')), ''),
    nullif(btrim(coalesce(p->>'address_line1', '')), ''),
    nullif(btrim(coalesce(p->>'address_line2', '')), ''),
    nullif(btrim(coalesce(p->>'city', '')), ''),
    nullif(btrim(coalesce(p->>'state', '')), ''),
    nullif(btrim(coalesce(p->>'postal_code', '')), ''),
    nullif(btrim(coalesce(p->>'country', '')), ''),
    p_uid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_contact_valid(jsonb, text) FROM public;
REVOKE ALL ON FUNCTION public.insert_contact_party(jsonb, uuid) FROM public;

-- ---------------------------------------------------------------------------
-- RPC v3.
-- ---------------------------------------------------------------------------
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
  v_zeb constant jsonb := jsonb_build_object(
    'name', 'Zeb Loewenstine',
    'email', 'zeb@mintedpanel.example.test',
    'phone_office', '704-555-0100',
    'address_line1', '101 S Tryon St',
    'address_line2', 'Suite 400',
    'city', 'Charlotte',
    'state', 'NC',
    'postal_code', '28280',
    'country', 'US'
  );
  v_sales jsonb;
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

  -- Customer contact is required; sales rep defaults to Zeb when omitted (FR-1).
  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'Customer contact is required';
  END IF;
  PERFORM public.assert_contact_valid(p_customer, 'Customer contact');
  v_sales := COALESCE(p_sales_rep, v_zeb);
  PERFORM public.assert_contact_valid(v_sales, 'Sales rep');

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

  -- Sales rep (Zeb by default).
  v_party_id := public.insert_contact_party(v_sales, v_uid);
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type)
    VALUES (v_org_id, v_party_id, 'sales_rep', 'org');

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) TO authenticated;

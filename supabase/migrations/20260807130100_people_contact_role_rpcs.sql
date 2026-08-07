-- People contact roles + contact tokens — the FUNCTION half.
--
-- Companion to 20260807130000_people_contact_roles.sql (same decision record:
-- docs/redesign/DECISION-RECORD-2026-08-07-people-contact-roles.md). Split out
-- so the schema change and the function reissues apply as separate, individually
-- reviewable units.
--
-- Four SECURITY DEFINER functions insert or update `parties`. After the schema
-- half makes parties.org_id NOT NULL, every one of them would 23502 on the next
-- org intake or capture-link issue, so all four are reissued here to carry
-- org_id and the new name/contact columns.
-- 5. insert_contact_party — 3-arg overload carrying org_id + the new fields.
--    The 2-arg form is RETAINED (additive rule) but has no caller after this
--    migration; it cannot satisfy the NOT NULL and must not be used again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_contact_party(p jsonb, p_uid uuid, p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_name text := btrim(p->>'name');
BEGIN
  INSERT INTO public.parties (
    org_id, party_type, name, first_name, last_name, title,
    email, phone_office, phone_extension, phone_mobile, fax,
    address_line1, address_line2, city, state, postal_code, country, created_by
  ) VALUES (
    p_org_id,
    'person',
    v_name,
    coalesce(nullif(btrim(coalesce(p->>'first_name', '')), ''),
             nullif(public._party_first_name(v_name), '')),
    coalesce(nullif(btrim(coalesce(p->>'last_name', '')), ''),
             nullif(public._party_last_name(v_name), '')),
    nullif(btrim(coalesce(p->>'title', '')), ''),
    btrim(p->>'email'),
    nullif(btrim(coalesce(p->>'phone_office', '')), ''),
    nullif(btrim(coalesce(p->>'phone_extension', '')), ''),
    nullif(btrim(coalesce(p->>'phone_mobile', '')), ''),
    nullif(btrim(coalesce(p->>'fax', '')), ''),
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

REVOKE ALL ON FUNCTION public.insert_contact_party(jsonb, uuid, uuid) FROM public;

-- ---------------------------------------------------------------------------
-- 6. create_organization 5-arg — reissued so both intake parties carry org_id +
--    split names, and the owner/customer assignments are marked default.
--    Signature unchanged; the 2026-08-07 no-default-sales-rep behavior is
--    preserved exactly (NULL / JSON null / {} ⇒ no party, no assignment).
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

  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'Customer contact is required';
  END IF;
  PERFORM public.assert_contact_valid(p_customer, 'Customer contact');

  -- Sales rep stays genuinely optional (hotfix 20260807120000): NULL, JSON null
  -- and {} all mean "no sales rep", and no placeholder identity is substituted.
  v_sales := NULL;
  IF p_sales_rep IS NOT NULL
     AND jsonb_typeof(p_sales_rep) = 'object'
     AND p_sales_rep <> '{}'::jsonb THEN
    v_sales := p_sales_rep;
    PERFORM public.assert_contact_valid(v_sales, 'Sales rep');
  END IF;

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

  -- Owner / authorized contact (name + email only, E0.1).
  INSERT INTO public.parties (org_id, party_type, name, first_name, last_name, email, created_by)
    VALUES (v_org_id, 'person', v_owner_name,
            nullif(public._party_first_name(v_owner_name), ''),
            nullif(public._party_last_name(v_owner_name), ''),
            v_owner_email, v_uid)
    RETURNING id INTO v_party_id;
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'owner', 'org', true);

  -- Organization contact.
  v_party_id := public.insert_contact_party(p_customer, v_uid, v_org_id);
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'customer_escalation_contact', 'org', true);

  IF v_sales IS NOT NULL THEN
    v_party_id := public.insert_contact_party(v_sales, v_uid, v_org_id);
    INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
      VALUES (v_org_id, v_party_id, 'sales_rep', 'org', true);
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. create_organization 3-arg — reissued for the same NOT NULL reason. It has
--    no app caller (the 5-arg is the live intake path) but must not be left
--    able to 23502.
-- ---------------------------------------------------------------------------
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
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Organization name is required'; END IF;
  IF v_owner_name = '' THEN RAISE EXCEPTION 'Owner name is required'; END IF;
  IF v_owner_email = '' THEN RAISE EXCEPTION 'Owner email is required'; END IF;
  IF v_owner_email !~ v_email_re THEN RAISE EXCEPTION 'Owner email is not valid'; END IF;

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

  INSERT INTO public.parties (org_id, party_type, name, first_name, last_name, email, created_by)
    VALUES (v_org_id, 'person', v_owner_name,
            nullif(public._party_first_name(v_owner_name), ''),
            nullif(public._party_last_name(v_owner_name), ''),
            v_owner_email, v_uid)
    RETURNING id INTO v_party_id;
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'owner', 'org', true);

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. create_capture_link — the ad-hoc recipient party now carries org_id, and
--    the existing-party check is ORG-SCOPED (was `created_by = me OR assigned
--    here`, the other half of the cross-org identity problem).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_capture_link(
  p_org_id uuid,
  p_party_id uuid,
  p_recipient_email text,
  p_recipient_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_party_id uuid;
  v_recipient_name text;
  v_org_name text;
  v_token text;
  v_hash text;
  v_link_id uuid;
  v_expires timestamptz := now() + interval '7 days';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = p_org_id AND m.user_id = v_uid
      AND m.role = ANY (ARRAY['specialist'::text, 'admin'::text])
  ) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'Recipient email is required';
  END IF;
  IF v_email !~ v_email_re THEN
    RAISE EXCEPTION 'Recipient email is not valid';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = p_org_id;

  IF p_party_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.parties p WHERE p.id = p_party_id AND p.org_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'Recipient party not found for this organization';
    END IF;
    v_party_id := p_party_id;
    SELECT name INTO v_recipient_name FROM public.parties WHERE id = v_party_id;
  ELSE
    v_recipient_name := coalesce(nullif(btrim(coalesce(p_recipient_name, '')), ''), v_email);
    INSERT INTO public.parties (
      org_id, party_type, name, first_name, last_name, email, created_by
    )
    VALUES (
      p_org_id, 'person', v_recipient_name,
      nullif(public._party_first_name(v_recipient_name), ''),
      nullif(public._party_last_name(v_recipient_name), ''),
      v_email, v_uid
    )
    RETURNING id INTO v_party_id;
  END IF;

  UPDATE public.party_capture_links
    SET state = 'revoked'
    WHERE org_id = p_org_id AND state = 'active';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  INSERT INTO public.party_capture_links (
    org_id, party_id, token_hash, recipient_email, state, expires_at, created_by
  )
  VALUES (p_org_id, v_party_id, v_hash, v_email, 'active', v_expires, v_uid)
  RETURNING id INTO v_link_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (p_org_id, v_uid, 'CREATE', 'party_capture_link', v_link_id,
            'Issued one-time data capture link');

  RETURN jsonb_build_object(
    'token', v_token,
    'link_id', v_link_id,
    'party_id', v_party_id,
    'recipient_name', v_recipient_name,
    'recipient_email', v_email,
    'org_name', v_org_name,
    'expires_at', v_expires
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. submit_capture — persists first/last/title/fax/extension so a captured
--    contact resolves the token families. Without this the capture form would
--    collect split names and silently drop them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_capture(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
  v_name text;
BEGIN
  IF NOT public.check_rpc_throttle('submit_capture', 20, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.party_capture_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('submit_capture');

  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links SET state = 'expired' WHERE id = v_link.id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  PERFORM public.assert_contact_valid(p_payload, 'This form');
  v_name := btrim(p_payload->>'name');

  UPDATE public.parties SET
    name = v_name,
    first_name = coalesce(nullif(btrim(coalesce(p_payload->>'first_name', '')), ''),
                          nullif(public._party_first_name(v_name), '')),
    last_name = coalesce(nullif(btrim(coalesce(p_payload->>'last_name', '')), ''),
                         nullif(public._party_last_name(v_name), '')),
    title = nullif(btrim(coalesce(p_payload->>'title', '')), ''),
    email = btrim(p_payload->>'email'),
    phone_office = nullif(btrim(coalesce(p_payload->>'phone_office', '')), ''),
    phone_extension = nullif(btrim(coalesce(p_payload->>'phone_extension', '')), ''),
    phone_mobile = nullif(btrim(coalesce(p_payload->>'phone_mobile', '')), ''),
    fax = nullif(btrim(coalesce(p_payload->>'fax', '')), ''),
    address_line1 = nullif(btrim(coalesce(p_payload->>'address_line1', '')), ''),
    address_line2 = nullif(btrim(coalesce(p_payload->>'address_line2', '')), ''),
    city = nullif(btrim(coalesce(p_payload->>'city', '')), ''),
    state = nullif(btrim(coalesce(p_payload->>'state', '')), ''),
    postal_code = nullif(btrim(coalesce(p_payload->>'postal_code', '')), ''),
    country = nullif(btrim(coalesce(p_payload->>'country', '')), '')
  WHERE id = v_link.party_id;

  UPDATE public.party_capture_links
    SET state = 'used', used_at = now()
    WHERE id = v_link.id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'UPDATE', 'party', v_link.party_id,
            'Party data captured via one-time link');

  RETURN jsonb_build_object('ok', true, 'state', 'used');
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. validate_capture_token — `current` gains the new fields so the public
--     form prefills them (additive keys; every existing key is unchanged).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_capture_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
  v_state text;
  v_org_name text;
  v_party public.parties%ROWTYPE;
BEGIN
  IF NOT public.check_rpc_throttle('validate_capture_token', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.party_capture_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('validate_capture_token');

  v_state := v_link.state;
  IF v_state = 'active' AND v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links SET state = 'expired' WHERE id = v_link.id;
    v_state := 'expired';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT * INTO v_party FROM public.parties WHERE id = v_link.party_id;

  IF v_state <> 'active' THEN
    RETURN jsonb_build_object(
      'state', v_state,
      'org_name', v_org_name,
      'recipient_name', v_party.name
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'active',
    'org_name', v_org_name,
    'recipient_name', v_party.name,
    'recipient_email', v_link.recipient_email,
    'expires_at', v_link.expires_at,
    'required_fields', jsonb_build_array(
      'name', 'email', 'phone_office', 'address_line1', 'city', 'state', 'postal_code'),
    'current', jsonb_build_object(
      'name', v_party.name,
      'first_name', v_party.first_name,
      'last_name', v_party.last_name,
      'title', v_party.title,
      'email', v_party.email,
      'phone_office', v_party.phone_office,
      'phone_extension', v_party.phone_extension,
      'phone_mobile', v_party.phone_mobile,
      'fax', v_party.fax,
      'address_line1', v_party.address_line1,
      'address_line2', v_party.address_line2,
      'city', v_party.city,
      'state', v_party.state,
      'postal_code', v_party.postal_code,
      'country', v_party.country
    )
  );
END;
$$;

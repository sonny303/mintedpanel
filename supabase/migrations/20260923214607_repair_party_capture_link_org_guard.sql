-- Repair the public capture boundary without changing its signature, throttle,
-- payload shape, state machine, or caller ACL. A link is usable only when its
-- party still belongs to the link's organization. This is a forward function
-- correction; it does not add a composite FK because preserved used links may
-- intentionally reference historical party state.

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
  SELECT * INTO v_link
    FROM public.party_capture_links
   WHERE token_hash = v_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  -- Lock the party row before marking the token valid or inspecting state.
  -- D8 makes org_id immutable; the lock closes the delete/change race.
  PERFORM 1
    FROM public.parties p
   WHERE p.id = v_link.party_id
     AND p.org_id = v_link.org_id
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('submit_capture');

  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links
       SET state = 'expired'
     WHERE id = v_link.id
       AND org_id = v_link.org_id;
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
  WHERE id = v_link.party_id
    AND org_id = v_link.org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  UPDATE public.party_capture_links
     SET state = 'used', used_at = now()
   WHERE id = v_link.id
     AND org_id = v_link.org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'UPDATE', 'party', v_link.party_id,
            'Party data captured via one-time link');

  RETURN jsonb_build_object('ok', true, 'state', 'used');
END;
$$;

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
  SELECT * INTO v_link
    FROM public.party_capture_links
   WHERE token_hash = v_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM 1
    FROM public.parties p
   WHERE p.id = v_link.party_id
     AND p.org_id = v_link.org_id
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('validate_capture_token');

  v_state := v_link.state;
  IF v_state = 'active' AND v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links
       SET state = 'expired'
     WHERE id = v_link.id
       AND org_id = v_link.org_id;
    v_state := 'expired';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT * INTO v_party FROM public.parties WHERE id = v_link.party_id AND org_id = v_link.org_id;

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

REVOKE ALL ON FUNCTION public.submit_capture(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_capture(text, jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_capture_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_capture_token(text) TO anon, authenticated;

-- MINT-60: atomically retire one exact portal mapping generation and record
-- an idempotent, append-only receipt. Old field-map rows and SOP references
-- remain in place; MINT-52 excludes old generations from effective use.

CREATE UNIQUE INDEX IF NOT EXISTS form_mapping_reset_events_portal_idempotency
  ON public.form_mapping_reset_events (portal_id, idempotency_key);

CREATE OR REPLACE FUNCTION public.reset_portal_mapping(
  p_portal_id uuid,
  p_expected_mapping_generation integer,
  p_idempotency_key uuid
)
RETURNS public.form_mapping_reset_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_portal public.portals%ROWTYPE;
  v_receipt public.form_mapping_reset_events%ROWTYPE;
  v_owner_scope text;
  v_affected_field_count integer;
BEGIN
  IF v_actor_id IS NULL OR coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;
  IF p_portal_id IS NULL
     OR p_expected_mapping_generation IS NULL
     OR p_expected_mapping_generation < 1
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_mapping_reset';
  END IF;

  -- This exact configuration row is the serialization point used by MINT-57
  -- writes. Never resolve the reset target by URL or a key shared by siblings.
  SELECT * INTO v_portal
    FROM public.portals AS portal
   WHERE portal.id = p_portal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_not_found';
  END IF;
  v_owner_scope := CASE WHEN v_portal.org_id IS NULL THEN 'global' ELSE 'organization' END;

  -- Authorize every call, including an idempotent retry. Global reset follows
  -- the shared-authoring policy; org reset requires a current exact-org role.
  IF v_portal.org_id IS NULL THEN
    IF app_authz.is_restricted_external() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM public.memberships AS membership
     WHERE membership.org_id = v_portal.org_id
       AND membership.user_id = v_actor_id
       AND membership.role IN ('admin', 'specialist')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;

  -- Portal keys are a mutable snapshot on old receipts. Replay is therefore
  -- keyed by immutable portal id, and happens before current-generation CAS.
  SELECT * INTO v_receipt
    FROM public.form_mapping_reset_events AS event
   WHERE event.portal_id = v_portal.id
     AND event.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_receipt.actor_id IS DISTINCT FROM v_actor_id
       OR v_receipt.owner_scope IS DISTINCT FROM v_owner_scope
       OR v_receipt.org_id IS DISTINCT FROM v_portal.org_id
       OR v_receipt.old_mapping_generation IS DISTINCT FROM p_expected_mapping_generation THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'mapping_reset_idempotency_conflict';
    END IF;
    RETURN v_receipt;
  END IF;

  IF v_portal.mapping_generation IS DISTINCT FROM p_expected_mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;
  IF v_portal.mapping_generation = 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'mapping_generation_exhausted';
  END IF;

  -- An org-only empty generation must never reveal a shared fallback. Removing
  -- the override to reveal shared configuration is a distinct operation.
  IF v_portal.org_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.portals AS shared_portal
     WHERE shared_portal.org_id IS NULL
       AND shared_portal.portal_key = v_portal.portal_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'org_mapping_has_shared_fallback';
  END IF;

  -- Count every saved row in this owner's exact current generation, including
  -- undecided rows and rows beyond ordinary client page limits. No map content
  -- or private organization override detail is copied into the receipt.
  SELECT count(*)::integer INTO v_affected_field_count
    FROM public.portal_field_maps AS field_map
   WHERE field_map.portal_key = v_portal.portal_key
     AND field_map.org_id IS NOT DISTINCT FROM v_portal.org_id
     AND field_map.mapping_generation = v_portal.mapping_generation;

  -- MINT-57 triggers require these transaction-local markers. They are set
  -- only after actor/scope authorization, idempotency handling and generation
  -- compare-and-swap have all succeeded.
  PERFORM set_config(
    'minted.expected_mapping_generation', v_portal.mapping_generation::text, true
  );
  PERFORM set_config('minted.mapping_reset', 'true', true);

  UPDATE public.portals AS portal
     SET mapping_generation = v_portal.mapping_generation + 1,
         is_verified = false,
         last_verified_at = NULL,
         proven_at = NULL,
         updated_at = now()
   WHERE portal.id = v_portal.id
   RETURNING * INTO v_portal;

  INSERT INTO public.form_mapping_reset_events (
    portal_id, owner_scope, org_id, portal_key,
    old_mapping_generation, new_mapping_generation, actor_id,
    affected_field_count, idempotency_key
  ) VALUES (
    v_portal.id, v_owner_scope, v_portal.org_id, v_portal.portal_key,
    p_expected_mapping_generation, v_portal.mapping_generation, v_actor_id,
    v_affected_field_count, p_idempotency_key
  ) RETURNING * INTO v_receipt;

  RETURN v_receipt;
END;
$$;

-- The MINT-45 generation-change trigger permits only the portal table owner to
-- advance mapping_generation. Transfer the definer to that exact owner instead
-- of weakening either generation guard or broadening browser table grants.
DO $$
DECLARE
  v_owner name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(relation.relowner)
    INTO v_owner
    FROM pg_catalog.pg_class AS relation
   WHERE relation.oid = 'public.portals'::regclass;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'could not resolve public.portals table owner';
  END IF;
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION public.reset_portal_mapping(uuid, integer, uuid) OWNER TO %I',
    v_owner
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_portal_mapping(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_portal_mapping(uuid, integer, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.reset_portal_mapping(uuid, integer, uuid) IS
  'MINT-60: authenticated exact-portal mapping reset. Checks scope and actor, replays by portal id, CAS-increments generation, clears proof, and appends a non-PHI receipt in one transaction.';

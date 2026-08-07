-- Follow-up hardening for D8. The hosted project already has the two
-- 2026080713* people/contact migrations, so this migration closes the tenant
-- gap without rewriting applied history.

-- Refuse to hide legacy cross-org links. A rebuild or hosted apply with a
-- mismatch must stop with a count before constraints or policies are changed.
DO $$
DECLARE
  v_mismatch_count bigint;
BEGIN
  SELECT count(*)
    INTO v_mismatch_count
    FROM public.party_role_assignments pra
    JOIN public.parties p ON p.id = pra.party_id
   WHERE p.org_id IS DISTINCT FROM pra.org_id;

  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'party_role_tenant_mismatch: % assignment(s) link a party from another organization',
      v_mismatch_count;
  END IF;
END;
$$;

-- A composite FK makes same-org identity structural, including for service-role
-- writes that bypass RLS. Keep (org_id, id) unique so it is a valid FK target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_org_id_id
  ON public.parties (org_id, id);

ALTER TABLE public.party_role_assignments
  DROP CONSTRAINT IF EXISTS party_role_assignments_party_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.party_role_assignments'::regclass
       AND conname = 'party_role_assignments_org_party_fkey'
  ) THEN
    ALTER TABLE public.party_role_assignments
      ADD CONSTRAINT party_role_assignments_org_party_fkey
      FOREIGN KEY (org_id, party_id)
      REFERENCES public.parties (org_id, id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

-- D8 makes a party's organization part of its identity. RLS cannot compare OLD
-- and NEW, so a trigger enforces immutability for every database role.
CREATE OR REPLACE FUNCTION public.reject_party_org_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'party_org_id_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parties_org_id_immutable ON public.parties;
CREATE TRIGGER parties_org_id_immutable
  BEFORE UPDATE OF org_id ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.reject_party_org_change();

REVOKE ALL ON FUNCTION public.reject_party_org_change() FROM public, anon, authenticated;

-- Keep the tenant join visible in the browser-write policies as defense in
-- depth. The composite FK remains the final authority for every database role.
DROP POLICY IF EXISTS pra_insert_writer ON public.party_role_assignments;
CREATE POLICY pra_insert_writer ON public.party_role_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
    AND EXISTS (
      SELECT 1
        FROM public.parties p
       WHERE p.id = party_role_assignments.party_id
         AND p.org_id = party_role_assignments.org_id
    )
  );

DROP POLICY IF EXISTS pra_update_writer ON public.party_role_assignments;
CREATE POLICY pra_update_writer ON public.party_role_assignments
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
    AND EXISTS (
      SELECT 1
        FROM public.parties p
       WHERE p.id = party_role_assignments.party_id
         AND p.org_id = party_role_assignments.org_id
    )
  );

-- One Postgres function call is one transaction. Validate and lock the target
-- before demoting the old default so any error preserves the prior default.
CREATE OR REPLACE FUNCTION public.set_default_party_role(
  p_org_id uuid,
  p_party_id uuid,
  p_role_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF public.user_role(p_org_id) IS NULL
     OR public.user_role(p_org_id) NOT IN ('specialist', 'admin') THEN
    RAISE EXCEPTION 'party_role_default_not_authorized';
  END IF;

  -- Serialize promotions for this organization/role pair. The target row lock
  -- then protects the assignment from concurrent update/delete.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_org_id::text || ':' || p_role_key, 0)
  );

  SELECT id
    INTO v_target_id
    FROM public.party_role_assignments
   WHERE org_id = p_org_id
     AND party_id = p_party_id
     AND role_key = p_role_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'party_role_default_assignment_not_found';
  END IF;

  UPDATE public.party_role_assignments
     SET is_default = false
   WHERE org_id = p_org_id
     AND role_key = p_role_key
     AND is_default
     AND id <> v_target_id;

  UPDATE public.party_role_assignments
     SET is_default = true
   WHERE id = v_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'party_role_default_assignment_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_party_role(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_default_party_role(uuid, uuid, text) TO authenticated;

-- MINT-48 — typed portal rows are independent, explicitly selected form
-- configurations. Legacy NULL-type rows remain on the URL-selected path.

CREATE OR REPLACE FUNCTION public.guard_explicit_portal_configuration_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.case_type IS NOT NULL THEN
      IF NEW.payer_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'portal_configuration_payer_required';
      END IF;
      NEW.requires_explicit_selection := true;
      -- A fresh typed configuration starts untrusted and has no inherited
      -- proof. A distinct portal_key is the configuration boundary for maps.
      NEW.is_verified := false;
      NEW.last_verified_at := NULL;
      NEW.proven_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.requires_explicit_selection
     AND NEW.requires_explicit_selection IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'explicit_selection_cannot_be_disabled';
  END IF;

  IF OLD.portal_key IS DISTINCT FROM NEW.portal_key
     AND (OLD.requires_explicit_selection OR NEW.requires_explicit_selection) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'explicit_portal_key_immutable';
  END IF;

  IF OLD.requires_explicit_selection
     AND OLD.payer_id IS DISTINCT FROM NEW.payer_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'explicit_portal_payer_immutable';
  END IF;

  -- Existing rows, including typed rows created before MINT-48 and
  -- NULL-to-typed MINT-44 classifications, retain their marker and identity.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_explicit_portal_configuration_identity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS portals_guard_explicit_configuration_identity ON public.portals;
CREATE TRIGGER portals_guard_explicit_configuration_identity
  BEFORE INSERT OR UPDATE OF portal_key, payer_id, requires_explicit_selection
  ON public.portals
  FOR EACH ROW EXECUTE FUNCTION public.guard_explicit_portal_configuration_identity();

COMMENT ON FUNCTION public.guard_explicit_portal_configuration_identity() IS
  'MINT-48: fresh typed portal inserts become explicit, untrusted configurations; flagged payer/key identity and the explicit-selection marker cannot be changed or downgraded. Existing rows retain legacy markers.';

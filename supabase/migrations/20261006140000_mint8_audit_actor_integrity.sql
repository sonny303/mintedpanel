-- MINT-8: browser-authenticated direct/SECURITY INVOKER audit writes must use
-- the verified database actor and database time. Preserve trusted SECURITY
-- DEFINER and service-role writers, which may record deliberate attribution.

CREATE OR REPLACE FUNCTION private.enforce_audit_actor_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_user_name text;
BEGIN
  -- Use the effective database role, not the JWT role GUC. Direct and
  -- SECURITY INVOKER browser writes run as authenticated; SECURITY DEFINER
  -- writers are trusted database code and may intentionally attribute an
  -- action to a stored operator (for example, the issuer of a capture link).
  IF current_user = 'authenticated' THEN
    v_actor_id := auth.uid();

    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'audit_authentication_required';
    END IF;

    -- Read the profile under the caller's normal self-read policy for direct
    -- and SECURITY INVOKER writes. The self-read policy grants this query only
    -- for the verified actor, and its success is exercised in the DB test.
    SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name), ''), p.email)
      INTO v_user_name
      FROM public.profiles AS p
     WHERE p.id = v_actor_id;

    NEW.user_id := v_actor_id;
    NEW.user_name := v_user_name;
    NEW.ts := pg_catalog.statement_timestamp();
    NEW.created_at := NEW.ts;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_audit_actor_integrity()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER audit_log_actor_integrity_before_insert
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_audit_actor_integrity();

-- UPDATE was already denied to authenticated users by RLS because audit_log
-- has no UPDATE policy. Remove the unused table privilege as defense in depth
-- for ordinary-client append-only behavior. This focused migration leaves the
-- service_role's elevated UPDATE/DELETE/TRUNCATE privileges unchanged.
REVOKE UPDATE ON public.audit_log FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

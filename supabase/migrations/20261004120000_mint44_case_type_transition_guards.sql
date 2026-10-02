-- MINT-44 follow-up: keep persisted case-purpose classifications stable.
-- Historical NULL cases stay NULL until a trusted migration changes them;
-- normal portal configuration may classify a legacy org portal once.

CREATE OR REPLACE FUNCTION public.guard_credential_case_type_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'credential_case_type_immutable';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS credential_cases_case_type_immutable ON public.credential_cases;
CREATE TRIGGER credential_cases_case_type_immutable
  BEFORE UPDATE OF case_type ON public.credential_cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_credential_case_type_immutable();

CREATE OR REPLACE FUNCTION public.guard_org_portal_case_type_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF OLD.org_id IS NOT NULL
     AND OLD.case_type IS NOT NULL
     AND NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'org_portal_case_type_immutable';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS org_portals_case_type_transition ON public.portals;
CREATE TRIGGER org_portals_case_type_transition
  BEFORE UPDATE OF case_type ON public.portals
  FOR EACH ROW EXECUTE FUNCTION public.guard_org_portal_case_type_transition();

REVOKE ALL ON FUNCTION public.guard_credential_case_type_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_org_portal_case_type_transition()
  FROM PUBLIC, anon, authenticated, service_role;

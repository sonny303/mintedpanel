-- MINT-51: stamp each credential case's owner context with a small monotonic
-- version. This is a read-time tuple marker; task and SOP identity remain
-- independently stamped on each task row.

ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS context_version integer;

UPDATE public.credential_cases
SET context_version = 1
WHERE context_version IS NULL;

ALTER TABLE public.credential_cases
  ALTER COLUMN context_version SET DEFAULT 1,
  ALTER COLUMN context_version SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.credential_cases'::regclass
      AND conname = 'credential_cases_context_version_positive'
  ) THEN
    ALTER TABLE public.credential_cases
      ADD CONSTRAINT credential_cases_context_version_positive
      CHECK (context_version > 0);
  END IF;
END;
$migration$;

COMMENT ON COLUMN public.credential_cases.context_version IS
  'MINT-51 context stamp: increments when case owner identity, case type, or workflow status changes.';

CREATE OR REPLACE FUNCTION public.bump_credential_case_context_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.context_version := 1;
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.org_id,
    NEW.provider_id,
    NEW.group_id,
    NEW.facility_id,
    NEW.payer_id,
    NEW.state,
    NEW.case_type,
    NEW.case_status,
    NEW.payer_pipeline_state,
    NEW.credentialing_status_id,
    NEW.mso_id
  ) IS DISTINCT FROM ROW(
    OLD.org_id,
    OLD.provider_id,
    OLD.group_id,
    OLD.facility_id,
    OLD.payer_id,
    OLD.state,
    OLD.case_type,
    OLD.case_status,
    OLD.payer_pipeline_state,
    OLD.credentialing_status_id,
    OLD.mso_id
  ) THEN
    NEW.context_version := OLD.context_version + 1;
  ELSE
    -- Callers cannot forge a higher/lower version with an ordinary update.
    NEW.context_version := OLD.context_version;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS credential_cases_context_version ON public.credential_cases;
CREATE TRIGGER credential_cases_context_version
  BEFORE INSERT OR UPDATE ON public.credential_cases
  FOR EACH ROW EXECUTE FUNCTION public.bump_credential_case_context_version();

REVOKE ALL ON FUNCTION public.bump_credential_case_context_version()
  FROM PUBLIC, anon, authenticated, service_role;

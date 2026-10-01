-- MINT-19 follow-up: protect full-array SOP edits from overwriting a newer
-- atomic completion or another attachment/removal update.
ALTER TABLE public.tasks
  ADD COLUMN sop_content_revision integer NOT NULL DEFAULT 1
  CONSTRAINT tasks_sop_content_revision_positive CHECK (sop_content_revision > 0);

CREATE OR REPLACE FUNCTION public.bump_task_sop_content_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.sop_content IS DISTINCT FROM OLD.sop_content THEN
    NEW.sop_content_revision := OLD.sop_content_revision + 1;
  ELSE
    -- Callers cannot forge, reset, or increment the concurrency token.
    NEW.sop_content_revision := OLD.sop_content_revision;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER tasks_bump_sop_content_revision
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_task_sop_content_revision();

COMMENT ON COLUMN public.tasks.sop_content_revision IS
  'Monotonic optimistic concurrency token; increments on every sop_content change.';

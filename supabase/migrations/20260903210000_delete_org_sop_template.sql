-- Hard-delete an org-authored SOP template without breaking prior cases.
--
-- PM decisions (2026-09-03):
--   1. Null task stamps (sop_template_id/sop_version) and run-row snapshot
--      columns, then delete head + version rows. Cases keep sop_content;
--      provenance degrades (stamps gone → no "Generated from …" line).
--   2. Retire payer_forms (set retired_at), keep Storage objects so older
--      cases can still download the baked form row.
--   3. Portals / field maps are unlink-only — leave the shared catalog alone.
--   4. Org-authored templates only (org_id = caller's org). Admin-only.
--      Global / fallback templates are out of scope.
--
-- payer_forms.template_id was ON DELETE CASCADE, which would wipe form rows
-- (and break old-case downloads) the moment the template head is removed.
-- Flip to nullable + ON DELETE SET NULL, and widen the immutability trigger
-- so the delete RPC can detach (template_id → NULL) after retiring.

-- ---------------------------------------------------------------------------
-- 1. Preserve retired forms across template hard-delete.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payer_forms
  ALTER COLUMN template_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.payer_forms
    DROP CONSTRAINT IF EXISTS payer_forms_template_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.payer_forms
  ADD CONSTRAINT payer_forms_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.sop_templates(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.payer_forms_retire_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Detach path (org SOP hard-delete): template_id may become NULL, and the
  -- same UPDATE may also set retired_at/retired_by. Every other column stays
  -- immutable — same posture as the original retire-only guard.
  IF NEW.template_id IS NULL AND OLD.template_id IS NOT NULL THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.payer_id IS DISTINCT FROM OLD.payer_id
       OR NEW.family_id IS DISTINCT FROM OLD.family_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.label IS DISTINCT FROM OLD.label
       OR NEW.file_name IS DISTINCT FROM OLD.file_name
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
       OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION 'payer_forms rows are immutable; only retired_at/retired_by/template_id(NULL) may change'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- service_role (the /api upload path) is exempt: it inserts, it never
  -- UPDATEs, so this only ever guards a client-issued update.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.payer_id IS DISTINCT FROM OLD.payer_id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.label IS DISTINCT FROM OLD.label
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
  THEN
    RAISE EXCEPTION 'payer_forms rows are immutable; only retired_at/retired_by may change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. delete_org_sop_template — transactional hard-delete door.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_org_sop_template(
  p_org_id uuid,
  p_template_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_before public.sop_templates%ROWTYPE;
  v_tasks_cleared int := 0;
  v_run_rows_cleared int := 0;
  v_forms_retired int := 0;
  v_versions_deleted int := 0;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) <> 'admin' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_before
    FROM public.sop_templates
   WHERE id = p_template_id
     AND org_id = p_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sop_template_not_found';
  END IF;
  -- Defense in depth: global / fallback rows are never deletable here even if
  -- a caller somehow matched org_id (they can't — org_id is NULL on those).
  IF v_before.org_id IS NULL THEN
    RAISE EXCEPTION 'sop_template_not_org_authored';
  END IF;

  -- Release the composite FK tasks → sop_template_versions before versions go.
  UPDATE public.tasks
     SET sop_template_id = NULL,
         sop_version = NULL
   WHERE sop_template_id = p_template_id;
  GET DIAGNOSTICS v_tasks_cleared = ROW_COUNT;

  -- Snapshot columns only (no FK) — clear so ledgers don't point at a gone id.
  UPDATE public.case_generation_run_rows
     SET sop_template_id = NULL,
         sop_version = NULL,
         sop_resolution_tier = NULL
   WHERE sop_template_id = p_template_id;
  GET DIAGNOSTICS v_run_rows_cleared = ROW_COUNT;

  -- Retire then detach. Storage objects stay; old cases keep their baked form id.
  UPDATE public.payer_forms
     SET retired_at = coalesce(retired_at, now()),
         retired_by = coalesce(retired_by, v_uid),
         template_id = NULL
   WHERE template_id = p_template_id;
  GET DIAGNOSTICS v_forms_retired = ROW_COUNT;

  DELETE FROM public.sop_template_versions
   WHERE template_id = p_template_id;
  GET DIAGNOSTICS v_versions_deleted = ROW_COUNT;

  -- sop_template_drafts.template_id is ON DELETE CASCADE — drafts go with the head.
  DELETE FROM public.sop_templates
   WHERE id = p_template_id
     AND org_id = p_org_id;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'DELETE', 'sop_template', p_template_id,
     jsonb_build_object(
       'id', v_before.id,
       'name', v_before.name,
       'payerId', v_before.payer_id,
       'states', to_jsonb(v_before.states),
       'groupId', v_before.group_id,
       'archived', v_before.archived,
       'currentVersion', v_before.current_version
     ),
     NULL,
     'Deleted SOP template "' || v_before.name || '"');

  RETURN jsonb_build_object(
    'template_id', p_template_id,
    'name', v_before.name,
    'tasks_cleared', v_tasks_cleared,
    'run_rows_cleared', v_run_rows_cleared,
    'forms_retired', v_forms_retired,
    'versions_deleted', v_versions_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_org_sop_template(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_org_sop_template(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_org_sop_template(uuid, uuid) TO authenticated, service_role;

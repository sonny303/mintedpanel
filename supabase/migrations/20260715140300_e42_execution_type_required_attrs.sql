-- E4.2 TE-12 + TE-13 — SOP task execution-type metadata and required
-- provider-profile attributes, both additive and versioned with the SOP.
--
-- TE-12: execution_type is per-task. It rides the `task_definitions` jsonb
-- (each task object gains an optional `executionType`), and is STAMPED onto the
-- concrete generated `tasks` row here (nullable column, null ⇒ manual). R6 only
-- renders + stamps; automated behaviors ride E4.3/E4.5/R7.
alter table public.tasks
  add column if not exists execution_type text
  check (execution_type is null
         or execution_type in ('manual','extension_fill','auto_verify','document_attach'));

-- TE-13: required provider-profile attributes are a governed key list stored
-- with the SOP version (immutability per TE-12). Kept on the head (editable
-- working copy) and snapshotted into each immutable version by the publish RPC.
alter table public.sop_templates
  add column if not exists required_profile_attributes jsonb not null default '[]'::jsonb;
alter table public.sop_template_versions
  add column if not exists required_profile_attributes jsonb not null default '[]'::jsonb;

-- Publish RPC: additively carry required_profile_attributes into the new
-- immutable version AND the head. The new defaulted param changes the arg
-- count, so the old 5-arg overload must be dropped first (a bare CREATE OR
-- REPLACE would leave two overloads and make named-arg calls ambiguous).
drop function if exists public.publish_sop_template_version(uuid, integer, text, jsonb, text);

create or replace function public.publish_sop_template_version(
  p_template_id uuid,
  p_expected_version integer,
  p_name text,
  p_task_definitions jsonb,
  p_change_note text default null::text,
  p_required_profile_attributes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_current integer;
  v_uid uuid := auth.uid();
  v_next integer;
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Template name is required';
  end if;
  if p_task_definitions is null or jsonb_typeof(p_task_definitions) <> 'array' then
    raise exception 'task_definitions must be a json array';
  end if;
  if jsonb_typeof(v_attrs) <> 'array' then
    raise exception 'required_profile_attributes must be a json array';
  end if;

  select org_id, current_version into v_org, v_current
    from public.sop_templates where id = p_template_id
    for update;
  if not found then
    raise exception 'Template not found';
  end if;

  if v_org is null then
    if v_uid is not null then
      raise exception 'Global templates are platform-managed';
    end if;
  elsif not (v_org in (select user_org_ids()))
     or user_role(v_org) is distinct from 'admin' then
    raise exception 'Not authorized';
  end if;

  if v_current is distinct from p_expected_version then
    raise exception 'sop_version_conflict: expected version %, head is %',
      p_expected_version, v_current;
  end if;

  v_next := v_current + 1;

  insert into public.sop_template_versions
    (template_id, version, name, task_definitions, change_note, published_by, required_profile_attributes)
  values (p_template_id, v_next, btrim(p_name), p_task_definitions,
          nullif(btrim(coalesce(p_change_note, '')), ''), v_uid, v_attrs);

  update public.sop_templates
    set name = btrim(p_name),
        task_definitions = p_task_definitions,
        required_profile_attributes = v_attrs,
        current_version = v_next,
        updated_at = now()
    where id = p_template_id and current_version = v_current;
  if not found then
    raise exception 'sop_version_conflict: concurrent publish detected';
  end if;

  if v_org is not null then
    insert into public.audit_log
      (org_id, user_id, action_type, entity_type, entity_id, description)
    values (v_org, v_uid, 'UPDATE', 'sop_template', p_template_id,
            'Published SOP template ' || btrim(p_name) || ' version ' || v_next);
  end if;

  return jsonb_build_object('template_id', p_template_id, 'version', v_next);
end;
$function$;

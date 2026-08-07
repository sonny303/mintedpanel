-- E6.9 F6.9.6 — fold `steps[].dataFields` into the field registry.
--
-- DML ONLY. No column is added, renamed or dropped, and `dataFields` STAYS in
-- the template JSON (additive-only rule) — the editor simply stops reading it
-- for `online_form` steps, so an unmigrated or rolled-back reader still finds
-- exactly what it expects.
--
-- Two field systems existed for the same boxes: the captured portal mappings
-- (`portal_field_maps`) and the step's Data fields, each with its own label and
-- its own picker over the same token catalog. One row, mapped once, now serves
-- both.
--
-- IDEMPOTENCE is mechanical, not best-effort: each migrated row's selector is
-- derived deterministically from `(template, task index, step index, token)`
-- via md5, so a re-run computes the SAME selector and the F6.9.1 partial unique
-- index turns the insert into a no-op. `ON CONFLICT DO NOTHING` makes that
-- explicit rather than relying on an error.
--
-- Repo-only; hosted apply is an operator step in the PR body.

-- ---------------------------------------------------------------------------
-- 1. Version snapshot BEFORE the migration touches anything (F6.9.6).
--
--    A snapshot is a NEW version N+1 carrying identical content plus a
--    current_version bump. Affected templates only: a template with no
--    online-form data fields has nothing to roll back and gets no spurious
--    version.
--
--    Re-run safety is the NOT EXISTS on the change note, NOT `ON CONFLICT
--    (template_id, version)`: the first run bumps current_version to N+1, so a
--    second run would compute N+2 — a version that does not exist yet, which
--    the conflict clause would happily insert. The change note is the only
--    marker that survives the bump, so it is what the guard reads.
-- ---------------------------------------------------------------------------
WITH affected AS (
  SELECT DISTINCT t.id, t.current_version, t.name, t.task_definitions
    FROM public.sop_templates t
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(t.task_definitions) = 'array'
           THEN t.task_definitions ELSE '[]'::jsonb END
    ) AS task(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(task.value->'steps') = 'array'
           THEN task.value->'steps' ELSE '[]'::jsonb END
    ) AS step(value)
   WHERE step.value->>'stepType' = 'online_form'
     AND jsonb_typeof(step.value->'dataFields') = 'array'
     AND jsonb_array_length(step.value->'dataFields') > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.sop_template_versions v
        WHERE v.template_id = t.id
          AND v.change_note = 'Snapshot before the E6.9 data-fields migration'
     )
)
INSERT INTO public.sop_template_versions (template_id, version, name, task_definitions, change_note)
SELECT a.id, a.current_version + 1, a.name, a.task_definitions,
       'Snapshot before the E6.9 data-fields migration'
  FROM affected a
ON CONFLICT (template_id, version) DO NOTHING;

UPDATE public.sop_templates t
   SET current_version = v.version
  FROM public.sop_template_versions v
 WHERE v.template_id = t.id
   AND v.change_note = 'Snapshot before the E6.9 data-fields migration'
   AND v.version > t.current_version;

-- ---------------------------------------------------------------------------
-- 2. Migrate each online-form step's data fields into shared registry rows.
--
--    Rows land on the step's OWN portal (`portalKey`); a step with no portal
--    has no registry to migrate into and is skipped rather than guessed at.
--    They arrive undecided (proposed/manual) with the notes the
--    portal_field_maps_notes_required CHECK demands — a reference token the
--    admin listed is a field someone still has to decide, not a mapping.
-- ---------------------------------------------------------------------------
WITH step_fields AS (
  SELECT
    lower(btrim(step.value->>'portalKey')) AS portal_key,
    md5(
      t.id::text || ':' || task.ordinality::text || ':' || step.ordinality::text || ':' ||
      coalesce(field.value->>'token', field.value->>'label', field.ordinality::text)
    ) AS selector_hash,
    nullif(btrim(coalesce(field.value->>'label', '')), '') AS field_label,
    nullif(btrim(coalesce(field.value->>'token', '')), '') AS token
  FROM public.sop_templates t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.task_definitions) = 'array'
         THEN t.task_definitions ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS task(value, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(task.value->'steps') = 'array'
         THEN task.value->'steps' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS step(value, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(step.value->'dataFields') = 'array'
         THEN step.value->'dataFields' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS field(value, ordinality)
  WHERE step.value->>'stepType' = 'online_form'
    AND nullif(btrim(coalesce(step.value->>'portalKey', '')), '') IS NOT NULL
)
INSERT INTO public.portal_field_maps (
  org_id, portal_key, selector, field_label, field_type, map_type,
  status, source, notes, token
)
SELECT
  NULL,
  sf.portal_key,
  'manual:' || sf.selector_hash,
  sf.field_label,
  'text',
  'web',
  'proposed',
  'manual',
  'Migrated from the step''s Data fields (E6.9)',
  NULL
FROM step_fields sf
WHERE sf.portal_key <> ''
ON CONFLICT DO NOTHING;

-- Story 1 data migration: fold the two case-activity note stores (case internal
-- notes and task comments — both rows in the polymorphic `notes` table,
-- discriminated by entity_type) into the touchlog as `note` entries, preserving
-- the original author (author_id -> coordinator_id) and timestamp (created_at).
--
-- BACKUP FIRST. Before applying to any environment with real data, snapshot the
-- source rows so the copy is reversible:
--   CREATE TABLE public.notes_pre_touchlog_backup AS
--     SELECT * FROM public.notes WHERE entity_type IN ('case', 'task');
--
-- Per the additive rule (AGENTS.md) the `notes` table is NOT dropped. It is left
-- dormant: after this migration the app writes and reads case/task notes through
-- the touchlog, and nothing reads `notes` for those entity types. Provider notes
-- (entity_type = 'provider') are not case activity and stay in `notes` untouched.
--
-- Guarded so a repo-only rebuild (empty `notes`) is a no-op, and re-application is
-- idempotent: a note is copied only if no touchlog note entry already carries the
-- same (case_id, coordinator_id, content, created_at).

INSERT INTO public.touches
  (org_id, case_id, touch_date, entry_type, touch_type, outcome, notes, coordinator_id, task_id, source, created_at)
SELECT
  n.org_id,
  CASE WHEN n.entity_type = 'case' THEN n.entity_id ELSE t.case_id END AS case_id,
  (n.created_at)::date AS touch_date,
  'note' AS entry_type,
  NULL AS touch_type,
  NULL AS outcome,
  n.content,
  n.author_id AS coordinator_id,
  CASE WHEN n.entity_type = 'task' THEN n.entity_id ELSE NULL END AS task_id,
  'manual' AS source,
  n.created_at
FROM public.notes n
LEFT JOIN public.tasks t
  ON n.entity_type = 'task' AND t.id = n.entity_id
WHERE n.entity_type IN ('case', 'task')
  -- Skip task notes on tasks with no case (touches.case_id is NOT NULL).
  AND (CASE WHEN n.entity_type = 'case' THEN n.entity_id ELSE t.case_id END) IS NOT NULL
  -- Idempotent: don't re-copy a note already present in the touchlog.
  AND NOT EXISTS (
    SELECT 1 FROM public.touches x
    WHERE x.entry_type = 'note'
      AND x.case_id = (CASE WHEN n.entity_type = 'case' THEN n.entity_id ELSE t.case_id END)
      AND x.notes IS NOT DISTINCT FROM n.content
      AND x.coordinator_id IS NOT DISTINCT FROM n.author_id
      AND x.created_at = n.created_at
  );

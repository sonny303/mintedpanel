-- Touchlog foundation (Story 1 + Story 3 schema): make `touches` the single
-- case-activity spine. Additive only — no column/table is dropped.
--
-- `touches` gains an entry_type discriminator so one append-only table carries
-- touchpoints, notes, system events, and task updates. `task_id` lets a note or
-- update reference a task; `communication_event_id` (Story 8) links a touchpoint
-- to a batch payer call (the FK constraint + parent table land in the Story 8
-- migration; the column is added here so the touchlog model is complete).
--
-- Story 3 widens the channel + outcome vocabularies (adds the Mail channel and
-- the full channel-aware outcome taxonomy) the same way the audit_log READ
-- migration widened its check — drop + re-add with the union of old and new.

-- 1. New columns (guarded for repo-only rebuilds).
ALTER TABLE public.touches
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'touchpoint';
ALTER TABLE public.touches
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id);
ALTER TABLE public.touches
  ADD COLUMN IF NOT EXISTS communication_event_id uuid;

-- 2. Non-touchpoint entries (note / system_event / task_update) carry no channel
--    or outcome, so those two columns must accept NULL. Existing rows are all
--    touchpoints with both set, so they satisfy the shape check below.
ALTER TABLE public.touches ALTER COLUMN touch_type DROP NOT NULL;
ALTER TABLE public.touches ALTER COLUMN outcome DROP NOT NULL;

-- 3. entry_type domain.
ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_entry_type_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_entry_type_check
  CHECK (entry_type = ANY (ARRAY['touchpoint', 'note', 'system_event', 'task_update']));

-- 4. Channel: add 'mail'; allow NULL for non-touchpoint entries.
ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_touch_type_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_touch_type_check
  CHECK (touch_type IS NULL OR touch_type = ANY (ARRAY['call', 'email', 'portal', 'fax', 'mail']));

-- 5. Outcome: union of legacy codes (keep existing rows valid) and the Story 3
--    channel-aware taxonomy. Allow NULL for non-touchpoint entries.
ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_outcome_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_outcome_check
  CHECK (outcome IS NULL OR outcome = ANY (ARRAY[
    -- legacy
    'reached', 'left_voicemail', 'no_answer', 'response_received', 'submitted', 'no_response', 'form_filled',
    -- email
    'sent', 'reply_received', 'info_requested', 'approved', 'denied', 'no_response_yet',
    -- portal
    'draft_saved', 'under_review', 'submission_error',
    -- phone
    'spoke_with_rep', 'callback_scheduled', 'got_reference_number', 'directed_to_portal_or_email',
    -- fax
    'confirmed_received', 'failed', 'no_confirmation',
    -- mail
    'delivered', 'returned'
  ]));

-- 6. Shape: a touchpoint must have both channel and outcome; other entry types
--    keep those NULL and carry their content in `notes`.
ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_touchpoint_shape_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_touchpoint_shape_check
  CHECK (
    entry_type <> 'touchpoint'
    OR (touch_type IS NOT NULL AND outcome IS NOT NULL)
  );

-- 7. Read paths that filter the timeline by task or entry_type.
CREATE INDEX IF NOT EXISTS touches_task_id_idx ON public.touches (task_id);
CREATE INDEX IF NOT EXISTS touches_entry_type_idx ON public.touches (entry_type);

-- E4.1 Structured Touches & Follow-up Cadence. Additive only — no column or
-- table is dropped, and `touches` stays append-only (no UPDATE/DELETE policy).
--
-- Widens the touchpoint vocabulary to the seven fixed E4.1 touch types, adds
-- the optional high-level disposition outcomes, loosens the shape check so a
-- typed touch may carry a NULL outcome (F4.1.4 — disposition is optional and
-- must never be synthesized to satisfy a legacy constraint), and adds four
-- additive optional columns: follow-up clear flag, recipient capture, and the
-- correction back-reference (corrections are appends, never edits).
--
-- Every statement is guarded (ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF
-- EXISTS + re-add) so a repo-only rebuild from the baseline still passes.

-- 1. New optional columns.
ALTER TABLE public.touches
  ADD COLUMN IF NOT EXISTS clears_follow_up boolean NOT NULL DEFAULT false;
ALTER TABLE public.touches
  ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE public.touches
  ADD COLUMN IF NOT EXISTS recipient_contact text;
-- Self-reference: a correction row points at the touch it corrects (F4.1 Edge
-- Cases & Corrections). Append-only — the original is never mutated.
ALTER TABLE public.touches
  ADD COLUMN IF NOT EXISTS corrects_touch_id uuid REFERENCES public.touches(id);

-- 2. touch_type: the seven fixed E4.1 types. Adds caqh_update, provider_outreach,
--    internal_sync; keeps the legacy call/email/portal/fax/mail so existing rows
--    (and the extension's 'portal' submission touches) stay valid. NULL still
--    allowed for note/system_event/task_update entries.
ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_touch_type_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_touch_type_check
  CHECK (touch_type IS NULL OR touch_type = ANY (ARRAY[
    'call', 'email', 'portal', 'fax', 'mail',
    'caqh_update', 'provider_outreach', 'internal_sync'
  ]));

-- 3. outcome: union of the legacy channel-aware taxonomy (keep existing rows
--    valid — no backfill) and the E4.1 disposition set. 'no_response' already
--    exists, so only successful/attempted/error/other are new. NULL allowed.
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
    'delivered', 'returned',
    -- E4.1 disposition (F4.1.4)
    'successful', 'attempted', 'error', 'other'
  ]));

-- 4. Shape: a touchpoint must still carry a channel (touch_type), but outcome is
--    now optional on typed touches (F4.1.4). note/system_event/task_update keep
--    touch_type NULL and carry their text in `notes`.
ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_touchpoint_shape_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_touchpoint_shape_check
  CHECK (
    entry_type <> 'touchpoint'
    OR touch_type IS NOT NULL
  );

-- 5. Read path for rendering the correction pair ("corrected by …").
CREATE INDEX IF NOT EXISTS touches_corrects_touch_id_idx
  ON public.touches (corrects_touch_id)
  WHERE corrects_touch_id IS NOT NULL;

-- Story 2: latest payer reference / submission ID on the case. A single nullable
-- text column, latest-wins (a new value overwrites the old). Per-submission
-- history is preserved through touchlog system_event entries, not this field.
ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS payer_reference_id text;

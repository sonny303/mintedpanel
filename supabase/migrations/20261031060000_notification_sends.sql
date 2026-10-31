-- MINT-108 notification_sends and notification_org_slots: the ledgers behind
-- scheduled notification jobs (src/server/jobs/), starting with the follow-up
-- digest (followup-digest).
--
-- A job run is at-least-once (job_runs, migration 20261031050000): a failed
-- or crashed run is run again. A job that emails people therefore claims each
-- send here first, keyed on (job, slot, org_id, recipient_user_id), and skips
-- a recipient whose send for that slot is already claimed or sent.
--
-- The slot is what makes a send once-only, and it is not the job_runs run
-- key. The digest's cron runs every hour (its run key is the UTC hour), and
-- each org's digest goes out once its local hour reaches its send hour; its
-- slot is the org's LOCAL DATE. So a rerun, a later hourly run, a changed send
-- hour or a changed time zone cannot send a recipient a second digest for the
-- same local date.
--
-- Idempotency is the partial unique index notification_sends_one_live_send:
-- at most one row per key is claimed or sent. Only a definite rejection (the
-- provider refused it, the input was invalid, or the mailer was misconfigured,
-- each before anything was accepted) is finished as failed; a failed row is
-- outside the index, so a later attempt may claim again with a new row, and
-- the failure stays on record. After three failed rows for a key the claim
-- answers `exhausted` and the job stops trying that send for the slot.
--
-- Anything that may have been delivered is never resent: a network error or
-- timeout, an unexplained error, or a function that died mid-send leaves the
-- row claimed, because SendGrid has no idempotency key.
--
-- notification_org_slots records, per (job, org_id, slot), that the org's
-- sends for the slot are settled: every planned send is sent, already sent,
-- given up, or left claimed because it may have been delivered, so a later
-- run has nothing to do for it. The hourly digest reads it to skip an org that
-- has had its digest for the local date; an org whose run failed, or that has
-- a send a later attempt may retry, gets no row, so the next hourly run
-- catches it up the same local day.
--
-- No PHI, ever: ids, the slot, timestamps, the provider's message id (a
-- token, CHECK-limited to a short safe alphabet) and an error code from a
-- closed set. Never an address, a name, a subject or a body.
--
-- service_role only: RLS on with no policies, nothing granted to anon or
-- authenticated. service_role may read both tables, and writes only through
-- the SECURITY DEFINER RPCs below, so every send follows claimed -> sent or
-- claimed -> failed and an org slot is only ever inserted.
--
-- Additive and re-runnable. REPO-ONLY until an operator applies it, staging
-- first, after 20261031050000 and 20261031051500. Until then the digest job
-- cannot check an org slot or claim a send, so it sends nothing and its run
-- is recorded failed.
-- Verify the OBJECTS, not a ledger filename (supabase-migrations skill):
--   SELECT to_regclass('public.notification_sends'),
--          to_regclass('public.notification_org_slots');            -- both non-null
--   SELECT proname, pg_get_function_identity_arguments(oid), prosecdef
--     FROM pg_proc WHERE proname IN ('claim_notification_send',
--       'finish_notification_send', 'complete_notification_org_slot');
--     -> p_job text, p_slot text, p_org_id uuid, p_recipient_user_id uuid | true (returns jsonb)
--     -> p_id uuid, p_outcome text, p_provider_message_id text, p_error_code text | true
--     -> p_job text, p_org_id uuid, p_slot text | true (returns boolean)
--   Then run supabase/tests/mint108-notification-sends.sql (rolled back).

CREATE TABLE IF NOT EXISTS public.notification_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  slot text NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- An actor id, not a foreign key (the notification_sequences.updated_by
  -- convention): removing a profile must not rewrite the send history.
  recipient_user_id uuid NOT NULL,
  outcome text NOT NULL DEFAULT 'claimed',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  provider_message_id text,
  error_code text,
  -- The job name is job_runs_job_check's pattern; the slot uses the same
  -- alphabet as a run key, but it is not one.
  CONSTRAINT notification_sends_job_check CHECK (job ~ '^[a-z][a-z0-9-]{0,47}$'),
  CONSTRAINT notification_sends_slot_check CHECK (slot ~ '^[0-9A-Za-z:_-]{1,64}$'),
  CONSTRAINT notification_sends_outcome_check CHECK (outcome IN ('claimed', 'sent', 'failed')),
  CONSTRAINT notification_sends_provider_message_id_check CHECK (
    provider_message_id IS NULL OR provider_message_id ~ '^[A-Za-z0-9._=-]{1,128}$'
  ),
  CONSTRAINT notification_sends_error_code_check CHECK (
    error_code IS NULL
    OR error_code IN ('misconfigured', 'invalid_input', 'provider_rejected')
  ),
  -- A send is finished exactly when it is no longer claimed, carries an error
  -- code exactly when it failed, and a message id only when it was sent.
  CONSTRAINT notification_sends_finished_check CHECK ((outcome = 'claimed') = (finished_at IS NULL)),
  CONSTRAINT notification_sends_failed_code_check CHECK ((outcome = 'failed') = (error_code IS NOT NULL)),
  CONSTRAINT notification_sends_message_id_sent_check CHECK (
    provider_message_id IS NULL OR outcome = 'sent'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_sends_one_live_send
  ON public.notification_sends (job, slot, org_id, recipient_user_id)
  WHERE outcome IN ('claimed', 'sent');
CREATE INDEX IF NOT EXISTS notification_sends_org_claimed_idx
  ON public.notification_sends (org_id, claimed_at DESC);
-- Serves the claim's count of a key's failed rows.
CREATE INDEX IF NOT EXISTS notification_sends_key_idx
  ON public.notification_sends (job, slot, org_id, recipient_user_id);

ALTER TABLE public.notification_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_sends FROM public, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_sends TO service_role;

COMMENT ON TABLE public.notification_sends IS
  'Per-recipient send ledger for scheduled notification jobs (MINT-108). At most one claimed or sent row per (job, slot, org_id, recipient_user_id), so no later run resends for the same slot; at most three failed rows per key. Ids, timestamps and closed codes only, never PHI. service_role only; written by claim_notification_send and finish_notification_send.';
COMMENT ON COLUMN public.notification_sends.job IS
  'The registered job name that sent it, e.g. followup-digest.';
COMMENT ON COLUMN public.notification_sends.slot IS
  'What a send is once-only for, within (job, org, recipient). For followup-digest, the org''s local date the digest is for (YYYY-MM-DD). Not the job_runs run key, which for the digest is the UTC hour.';
COMMENT ON COLUMN public.notification_sends.recipient_user_id IS
  'The org member the message went to (an actor id, not a foreign key). Never an address.';
COMMENT ON COLUMN public.notification_sends.outcome IS
  'claimed (the job is sending, or the send may have been delivered: a network error, a timeout, an unexplained error or a function that died; never resent), then sent or failed. failed means a definite rejection; a later attempt may claim again as a new row, up to three failed rows per key.';
COMMENT ON COLUMN public.notification_sends.finished_at IS
  'When the send was recorded sent (the provider accepted it) or failed. NULL while claimed.';
COMMENT ON COLUMN public.notification_sends.provider_message_id IS
  'SendGrid''s x-message-id for a sent row, when it returned one. Limited to [A-Za-z0-9._=-], at most 128 characters.';
COMMENT ON COLUMN public.notification_sends.error_code IS
  'Set exactly when outcome is failed: misconfigured, invalid_input or provider_rejected, the mailer''s error kinds that prove nothing was accepted. Never an error message.';

-- ---------------------------------------------------------------------------
-- notification_org_slots: one row per (job, org_id, slot) once that org's
-- sends for the slot are settled. Insert-only, through
-- complete_notification_org_slot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_org_slots (
  job text NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slot text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  -- The same patterns as notification_sends.
  CONSTRAINT notification_org_slots_job_check CHECK (job ~ '^[a-z][a-z0-9-]{0,47}$'),
  CONSTRAINT notification_org_slots_slot_check CHECK (slot ~ '^[0-9A-Za-z:_-]{1,64}$'),
  CONSTRAINT notification_org_slots_pkey PRIMARY KEY (job, org_id, slot)
);

ALTER TABLE public.notification_org_slots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_org_slots FROM public, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_org_slots TO service_role;

COMMENT ON TABLE public.notification_org_slots IS
  'Which orgs have had a scheduled notification job''s sends for a slot settled (MINT-108): one row per (job, org_id, slot). For followup-digest the slot is the org''s local date, and a row means that day''s digest is done, so a later hourly run skips the org. No row after a failed or retryable run, so the next hourly run catches it up. Ids, the slot and a timestamp only, never PHI. service_role only; written by complete_notification_org_slot.';
COMMENT ON COLUMN public.notification_org_slots.slot IS
  'The slot settled. For followup-digest, the org''s local date (YYYY-MM-DD), the same slot its notification_sends rows carry.';
COMMENT ON COLUMN public.notification_org_slots.completed_at IS
  'When the job recorded the slot settled.';

-- ---------------------------------------------------------------------------
-- claim_notification_send: claim one recipient's send for a slot.
-- Returns {"status":"claimed","id":<uuid>} for a new claimed row,
-- {"status":"taken"} when that send is already claimed or sent, or
-- {"status":"exhausted"} when it has already failed three times. jsonb, not
-- a uuid, so the job can tell "already sent" from "gave up".
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_notification_send(text, text, uuid, uuid);
CREATE FUNCTION public.claim_notification_send(
  p_job text,
  p_slot text,
  p_org_id uuid,
  p_recipient_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_failed integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_failed
    FROM public.notification_sends
   WHERE job = p_job
     AND slot = p_slot
     AND org_id = p_org_id
     AND recipient_user_id = p_recipient_user_id
     AND outcome = 'failed';
  IF v_failed >= 3 THEN
    RETURN pg_catalog.jsonb_build_object('status', 'exhausted');
  END IF;

  -- A live send for the key makes this insert a no-op, which leaves v_id
  -- NULL. The target names the partial index, so any other conflict raises.
  -- Two concurrent claims after a failure: one inserts, the other is taken.
  INSERT INTO public.notification_sends (job, slot, org_id, recipient_user_id)
  VALUES (p_job, p_slot, p_org_id, p_recipient_user_id)
  ON CONFLICT (job, slot, org_id, recipient_user_id)
    WHERE outcome IN ('claimed', 'sent') DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'taken');
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'claimed', 'id', v_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- finish_notification_send: record sent (with the provider's message id, if
-- any) or failed (a definite rejection, with a closed error code) on a
-- claimed row. Returns false when the row is not claimed. A send that may
-- have been delivered is never finished: it stays claimed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_notification_send(
  p_id uuid,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'finish_notification_send: outcome must be sent or failed'
      USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NOT NULL
     AND p_error_code NOT IN ('misconfigured', 'invalid_input', 'provider_rejected') THEN
    RAISE EXCEPTION 'finish_notification_send: error code is not in the closed set'
      USING ERRCODE = '22023';
  END IF;

  -- The table CHECKs pair the outcome with the code and the message id.
  UPDATE public.notification_sends
     SET outcome = p_outcome,
         provider_message_id = p_provider_message_id,
         error_code = p_error_code,
         finished_at = now()
   WHERE id = p_id
     AND outcome = 'claimed';

  RETURN FOUND;
END;
$function$;

-- ---------------------------------------------------------------------------
-- complete_notification_org_slot: record an org's sends for a slot settled.
-- Returns true for a new row, false when the slot was already recorded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_notification_org_slot(
  p_job text,
  p_org_id uuid,
  p_slot text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- The target names the primary key, so any other conflict raises.
  INSERT INTO public.notification_org_slots (job, org_id, slot)
  VALUES (p_job, p_org_id, p_slot)
  ON CONFLICT (job, org_id, slot) DO NOTHING;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_notification_send(text, text, uuid, uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification_send(uuid, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_send(text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_send(uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_notification_org_slot(text, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_org_slot(text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.claim_notification_send(text, text, uuid, uuid) IS
  'MINT-108: claim one recipient''s send for a slot (for followup-digest, the org''s local date). Returns {"status":"claimed","id":...}, {"status":"taken"} (already claimed or sent) or {"status":"exhausted"} (three failed rows already). service_role only.';
COMMENT ON FUNCTION public.finish_notification_send(uuid, text, text, text) IS
  'MINT-108: record sent (optional provider message id) or failed (error code misconfigured, invalid_input or provider_rejected) on a claimed row. Returns false when the row is not claimed. service_role only.';
COMMENT ON FUNCTION public.complete_notification_org_slot(text, uuid, text) IS
  'MINT-108: record that an org''s sends for a slot are settled (for followup-digest, its local date). Returns true for a new row, false when already recorded. service_role only.';

NOTIFY pgrst, 'reload schema';

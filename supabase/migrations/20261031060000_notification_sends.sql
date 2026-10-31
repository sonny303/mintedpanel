-- MINT-108 notification_sends: the per-recipient send ledger behind scheduled
-- notification jobs (src/server/jobs/), starting with the daily follow-up
-- digest (followup-digest).
--
-- A job run is at-least-once (job_runs, migration 20261031050000): a failed
-- or crashed run is run again. A job that emails people therefore claims each
-- send here first, keyed on (job, run_key, org_id, recipient_user_id), and
-- skips a recipient whose send for that slot is already claimed or sent.
--
-- Idempotency is the partial unique index notification_sends_one_live_send:
-- at most one row per key is claimed or sent. A failed row is outside it, so
-- the next attempt claims again with a new row and the failure stays on
-- record. A claimed row that never finishes (the function died mid-send) has
-- an unknown outcome and is left claimed: SendGrid has no idempotency key, so
-- the job never resends what may already have been delivered.
--
-- No PHI, ever: ids, the slot, timestamps, the provider's message id (a
-- token, CHECK-limited to a short safe alphabet) and an error code from a
-- closed set. Never an address, a name, a subject or a body.
--
-- service_role only: RLS on with no policies, nothing granted to anon or
-- authenticated. service_role may read the table, and writes only through the
-- two SECURITY DEFINER RPCs below, so every row follows claimed -> sent or
-- claimed -> failed.
--
-- Additive and re-runnable. REPO-ONLY until an operator applies it, staging
-- first, after 20261031050000 and 20261031051500. Until then the digest job
-- cannot claim a send, so it sends nothing and its run is recorded failed.
-- Verify the OBJECTS, not a ledger filename (supabase-migrations skill):
--   SELECT to_regclass('public.notification_sends');               -- non-null
--   SELECT pg_get_function_identity_arguments(oid), prosecdef
--     FROM pg_proc WHERE proname IN ('claim_notification_send', 'finish_notification_send');
--     -> p_job text, p_run_key text, p_org_id uuid, p_recipient_user_id uuid | true
--     -> p_id uuid, p_outcome text, p_provider_message_id text, p_error_code text | true
--   Then run supabase/tests/mint108-notification-sends.sql (rolled back).

CREATE TABLE IF NOT EXISTS public.notification_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  run_key text NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- An actor id, not a foreign key (the notification_sequences.updated_by
  -- convention): removing a profile must not rewrite the send history.
  recipient_user_id uuid NOT NULL,
  outcome text NOT NULL DEFAULT 'claimed',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  provider_message_id text,
  error_code text,
  -- Same patterns as job_runs_job_check and job_runs_run_key_check.
  CONSTRAINT notification_sends_job_check CHECK (job ~ '^[a-z][a-z0-9-]{0,47}$'),
  CONSTRAINT notification_sends_run_key_check CHECK (run_key ~ '^[0-9A-Za-z:_-]{1,64}$'),
  CONSTRAINT notification_sends_outcome_check CHECK (outcome IN ('claimed', 'sent', 'failed')),
  CONSTRAINT notification_sends_provider_message_id_check CHECK (
    provider_message_id IS NULL OR provider_message_id ~ '^[A-Za-z0-9._=-]{1,128}$'
  ),
  CONSTRAINT notification_sends_error_code_check CHECK (
    error_code IS NULL
    OR error_code IN ('misconfigured', 'invalid_input', 'provider_rejected', 'network', 'send_error')
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
  ON public.notification_sends (job, run_key, org_id, recipient_user_id)
  WHERE outcome IN ('claimed', 'sent');
CREATE INDEX IF NOT EXISTS notification_sends_org_claimed_idx
  ON public.notification_sends (org_id, claimed_at DESC);

ALTER TABLE public.notification_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_sends FROM public, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notification_sends TO service_role;

COMMENT ON TABLE public.notification_sends IS
  'Per-recipient send ledger for scheduled notification jobs (MINT-108). At most one claimed or sent row per (job, run_key, org_id, recipient_user_id), so a rerun of the same slot never resends. Ids, timestamps and closed codes only, never PHI. service_role only; written by claim_notification_send and finish_notification_send.';
COMMENT ON COLUMN public.notification_sends.job IS
  'The registered job name that sent it, e.g. followup-digest.';
COMMENT ON COLUMN public.notification_sends.run_key IS
  'The job run slot, by default the UTC day (YYYY-MM-DD).';
COMMENT ON COLUMN public.notification_sends.recipient_user_id IS
  'The org member the message went to (an actor id, not a foreign key). Never an address.';
COMMENT ON COLUMN public.notification_sends.outcome IS
  'claimed (the job is sending, or died while sending: outcome unknown, never resent), then sent or failed. A failed send may be claimed again by a later attempt as a new row.';
COMMENT ON COLUMN public.notification_sends.finished_at IS
  'When the send was recorded sent (the provider accepted it) or failed. NULL while claimed.';
COMMENT ON COLUMN public.notification_sends.provider_message_id IS
  'SendGrid''s x-message-id for a sent row, when it returned one. Limited to [A-Za-z0-9._=-], at most 128 characters.';
COMMENT ON COLUMN public.notification_sends.error_code IS
  'Set exactly when outcome is failed: misconfigured, invalid_input, provider_rejected or network (the mailer''s error kinds), or send_error (anything else). Never an error message.';

-- ---------------------------------------------------------------------------
-- claim_notification_send: claim one recipient's send for a job slot. Returns
-- the new claimed row's id, or NULL when that send is already claimed or sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_notification_send(
  p_job text,
  p_run_key text,
  p_org_id uuid,
  p_recipient_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- A live send for the key makes this insert a no-op, which leaves v_id
  -- NULL. The target names the partial index, so any other conflict raises.
  INSERT INTO public.notification_sends (job, run_key, org_id, recipient_user_id)
  VALUES (p_job, p_run_key, p_org_id, p_recipient_user_id)
  ON CONFLICT (job, run_key, org_id, recipient_user_id)
    WHERE outcome IN ('claimed', 'sent') DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- finish_notification_send: record sent (with the provider's message id, if
-- any) or failed (with a closed error code) on a claimed row. Returns false
-- when the row is not claimed.
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
     AND p_error_code NOT IN ('misconfigured', 'invalid_input', 'provider_rejected', 'network', 'send_error') THEN
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

REVOKE ALL ON FUNCTION public.claim_notification_send(text, text, uuid, uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification_send(uuid, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_send(text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_send(uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.claim_notification_send(text, text, uuid, uuid) IS
  'MINT-108: claim one recipient''s send for a job slot. Returns the new claimed row id, or NULL when the send is already claimed or sent. service_role only.';
COMMENT ON FUNCTION public.finish_notification_send(uuid, text, text, text) IS
  'MINT-108: record sent (optional provider message id) or failed (error code misconfigured, invalid_input, provider_rejected, network or send_error) on a claimed row. Returns false when the row is not claimed. service_role only.';

NOTIFY pgrst, 'reload schema';

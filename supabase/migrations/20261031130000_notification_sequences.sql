-- MINT-107: organization notification sequences, email and SMS. Config only:
-- nothing in this migration, or in the PR that adds it, sends a message.
--
-- Reminder and digest cadence is configuration, never a constant. One row in
-- notification_sequences per (org, purpose) holds whether it is on and the
-- intake-only settings; its ordered notification_sequence_steps hold how many
-- messages, how often (offset_days after the anchor), what each says
-- (template_key, from the catalog in src/lib/notificationTemplates.ts) and
-- who is cc'd on it, in order (cc_recipients). Two purposes:
--
--   followup_digest  the daily coordinator follow-up digest (a later PR). At
--                    most one step; no stop conditions, target or
--                    compression.
--   intake_reminder  reminders to a provider with an open onboarding invite
--                    (after the intake back end merges). Up to 10 steps, plus
--                    stop conditions, target_days_to_ready (default 14) and
--                    compress_toward_start_date.
--
-- No row means the purpose is off. Nothing here creates a row, and a new row
-- defaults to enabled = false.
--
-- Product rules this schema encodes (MINT-107 decisions):
--   * No default escalation chain. cc_recipients is an ordered jsonb array of
--     {"kind":"user","user_id":<uuid>} | {"kind":"role","role":<org role>},
--     empty by default, validated by notification_cc_recipients_valid() in a
--     CHECK. A cc'd user must be a member of the org when the step is saved
--     (BEFORE trigger); membership can lapse later, so the sender re-checks.
--     cc'd copies are always emailed, whatever the step's channel.
--   * Channels email and sms. SMS needs recorded consent: sms_consents holds
--     who (provider), which number, when, how (source), which consent text
--     version, and when it was revoked. No UI writes it here; the intake form
--     will, through a service-role path. A row is evidence: the only change
--     allowed is stamping a revocation once.
--   * Stop conditions are a validated subset of submitted, paused, withdrawn,
--     provider_replied (intake only).
--   * A bounce on step 1 escalates to step 1's cc list. That is a fixed rule,
--     not a setting, so it has no column: the consumer applies it through
--     bounceEscalationRecipients() in src/lib/notificationSequences.ts.
--   * cc'd escalation messages never carry SSN, DOB or document contents. No
--     template exists yet; the rule is a constraint on the template catalog
--     (src/lib/notificationTemplates.ts), checked by its unit test.
--   * Organization-level only. Every row is org-scoped; there is no
--     cross-tenant read.
--
-- Access. RLS on all three tables. Any member of the org reads its sequences,
-- steps and consents; nobody reads another org's. Only an org admin
-- (user_role(org_id) = 'admin') writes sequences and steps. sms_consents has
-- no authenticated write grant at all. save_notification_sequence() is the
-- save path: SECURITY INVOKER (RLS stays the wall), admin-checked, one
-- transaction, revision-checked against concurrent editors, and it writes its
-- own audit_log row. Direct admin writes are possible but hit the same
-- CHECKs and triggers: offsets strictly increase with position, the digest
-- has at most one step, and a step's template_key starts with its
-- sequence's purpose.
--
-- Functions referenced by a CHECK or a trigger use CREATE OR REPLACE: a DROP
-- would fail on re-run because the constraint or trigger depends on it, and
-- their signatures are new, so no PostgREST overload can arise. The RPC is
-- DROP + CREATE.
--
-- Additive and re-runnable. REPO-ONLY until an operator applies it, staging
-- first. The app reads these tables from the Org Detail Notifications card;
-- until the apply, that card shows its load error and nothing else breaks.
-- Verify the OBJECTS, not a ledger filename (supabase-migrations skill):
--   SELECT to_regclass('public.notification_sequences'),
--          to_regclass('public.notification_sequence_steps'),
--          to_regclass('public.sms_consents');           -- all three non-null
--   SELECT pg_get_function_identity_arguments(oid), prosecdef
--     FROM pg_proc WHERE proname = 'save_notification_sequence';
--     -> p_org_id uuid, p_purpose text, p_payload jsonb | false
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('notification_sequences', 'notification_sequence_steps',
--                        'sms_consents') ORDER BY 1, 2;  -- 9 policies
--   Then run supabase/tests/mint107-notification-sequences.sql (rolled back).

-- ---------------------------------------------------------------------------
-- 0. The composite key sms_consents points at. Added by 20260925190537; kept
--    guarded here so a rebuild that skipped it still applies.
-- ---------------------------------------------------------------------------
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_org_id_id_key') THEN
    ALTER TABLE public.providers ADD CONSTRAINT providers_org_id_id_key UNIQUE (org_id, id);
  END IF;
END;
$migration$;

-- ---------------------------------------------------------------------------
-- 1. Validators used by CHECK constraints. IMMUTABLE, pure, no table reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_stop_conditions_valid(p_conditions text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT p_conditions IS NOT NULL
     AND COALESCE(pg_catalog.array_ndims(p_conditions), 1) = 1
     AND pg_catalog.array_position(p_conditions, NULL::text) IS NULL
     AND p_conditions <@ ARRAY['submitted', 'paused', 'withdrawn', 'provider_replied']::text[]
     AND pg_catalog.cardinality(p_conditions) = (
       SELECT pg_catalog.count(DISTINCT c.condition)
         FROM pg_catalog.unnest(p_conditions) AS c(condition)
     );
$function$;

CREATE OR REPLACE FUNCTION public.notification_cc_recipients_valid(p_recipients jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_recipients IS NULL OR pg_catalog.jsonb_typeof(p_recipients) <> 'array' THEN false
    WHEN pg_catalog.jsonb_array_length(p_recipients) > 20 THEN false
    ELSE (
      -- Every entry is exactly {"kind":"user","user_id":<lower-case uuid>}
      -- or exactly {"kind":"role","role":<org role>}: comparing with a
      -- rebuilt object rejects missing, extra and mistyped keys at once.
      NOT EXISTS (
        SELECT 1
          FROM pg_catalog.jsonb_array_elements(p_recipients) AS r(item)
         WHERE NOT (
           (
             r.item = pg_catalog.jsonb_build_object('kind', 'user', 'user_id', r.item -> 'user_id')
             AND pg_catalog.jsonb_typeof(r.item -> 'user_id') = 'string'
             AND (r.item ->> 'user_id')
                 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           )
           OR (
             r.item = pg_catalog.jsonb_build_object('kind', 'role', 'role', r.item -> 'role')
             AND pg_catalog.jsonb_typeof(r.item -> 'role') = 'string'
             AND (r.item ->> 'role') IN ('admin', 'specialist', 'billing')
           )
         )
      )
      -- No one listed twice.
      AND pg_catalog.jsonb_array_length(p_recipients) = (
        SELECT pg_catalog.count(DISTINCT r.item)
          FROM pg_catalog.jsonb_array_elements(p_recipients) AS r(item)
      )
    )
  END;
$function$;

-- A CHECK runs its function as the writing role, so both writers need EXECUTE.
REVOKE ALL ON FUNCTION public.notification_stop_conditions_valid(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notification_cc_recipients_valid(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_stop_conditions_valid(text[])
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_cc_recipients_valid(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.notification_stop_conditions_valid(text[]) IS
  'MINT-107: true when the array is a duplicate-free, NULL-free subset of submitted, paused, withdrawn, provider_replied. Used by notification_sequences_stop_conditions_check.';
COMMENT ON FUNCTION public.notification_cc_recipients_valid(jsonb) IS
  'MINT-107: true when the value is an array of at most 20 distinct entries, each exactly {"kind":"user","user_id":<lower-case uuid>} or {"kind":"role","role":"admin"|"specialist"|"billing"}. Used by notification_sequence_steps_cc_recipients_check. Membership is checked by a trigger, not here.';

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  stop_conditions text[] NOT NULL DEFAULT '{}'::text[],
  -- NULL for the digest. For intake, the BEFORE INSERT trigger fills 14.
  target_days_to_ready integer,
  compress_toward_start_date boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- An actor id, not a foreign key (the provider_intake_invites.created_by
  -- convention): deleting a profile must not rewrite settings history.
  updated_by uuid,
  CONSTRAINT notification_sequences_purpose_check
    CHECK (purpose IN ('followup_digest', 'intake_reminder')),
  CONSTRAINT notification_sequences_org_purpose_key UNIQUE (org_id, purpose),
  CONSTRAINT notification_sequences_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT notification_sequences_stop_conditions_check
    CHECK (public.notification_stop_conditions_valid(stop_conditions)),
  CONSTRAINT notification_sequences_target_days_check
    CHECK (target_days_to_ready IS NULL OR target_days_to_ready BETWEEN 1 AND 90),
  CONSTRAINT notification_sequences_purpose_settings_check CHECK (
    (purpose = 'intake_reminder' AND target_days_to_ready IS NOT NULL)
    OR (
      purpose = 'followup_digest'
      AND target_days_to_ready IS NULL
      AND cardinality(stop_conditions) = 0
      AND NOT compress_toward_start_date
    )
  ),
  CONSTRAINT notification_sequences_revision_check CHECK (revision >= 1)
);

CREATE TABLE IF NOT EXISTS public.notification_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL,
  org_id uuid NOT NULL,
  position integer NOT NULL,
  offset_days integer NOT NULL,
  channel text NOT NULL,
  template_key text NOT NULL,
  cc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The composite key proves a step's org is its sequence's org.
  CONSTRAINT notification_sequence_steps_sequence_fkey FOREIGN KEY (org_id, sequence_id)
    REFERENCES public.notification_sequences (org_id, id) ON DELETE CASCADE,
  CONSTRAINT notification_sequence_steps_position_key UNIQUE (sequence_id, position),
  CONSTRAINT notification_sequence_steps_position_check CHECK (position BETWEEN 1 AND 10),
  CONSTRAINT notification_sequence_steps_offset_days_check CHECK (offset_days BETWEEN 0 AND 90),
  CONSTRAINT notification_sequence_steps_channel_check CHECK (channel IN ('email', 'sms')),
  CONSTRAINT notification_sequence_steps_template_key_check
    CHECK (template_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT notification_sequence_steps_cc_recipients_check
    CHECK (public.notification_cc_recipients_valid(cc_recipients))
);

CREATE INDEX IF NOT EXISTS notification_sequence_steps_org_idx
  ON public.notification_sequence_steps (org_id);

CREATE TABLE IF NOT EXISTS public.sms_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  consent_text_version text NOT NULL,
  -- The staff member who recorded it, for staff_recorded; an actor id, not a
  -- foreign key, so the evidence row never changes when a profile goes.
  recorded_by uuid,
  revoked_at timestamptz,
  revoked_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_consents_provider_fkey FOREIGN KEY (org_id, provider_id)
    REFERENCES public.providers (org_id, id) ON DELETE CASCADE,
  CONSTRAINT sms_consents_phone_check CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT sms_consents_source_check
    CHECK (source IN ('intake_form', 'staff_recorded', 'sms_keyword')),
  CONSTRAINT sms_consents_text_version_check
    CHECK (consent_text_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  CONSTRAINT sms_consents_revoked_source_check
    CHECK (revoked_source IS NULL OR revoked_source IN ('sms_stop', 'provider_request', 'staff_recorded')),
  CONSTRAINT sms_consents_revocation_pair_check CHECK ((revoked_at IS NULL) = (revoked_source IS NULL)),
  CONSTRAINT sms_consents_revoked_after_check CHECK (revoked_at IS NULL OR revoked_at >= consented_at)
);

-- One live consent per provider and number; a revoked row stays as history.
CREATE UNIQUE INDEX IF NOT EXISTS sms_consents_one_active
  ON public.sms_consents (org_id, provider_id, phone_e164) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Triggers. Trigger functions live in `private` (off the API surface);
--    a trigger needs no EXECUTE grant to fire.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.notification_sequences_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.purpose = 'intake_reminder' AND NEW.target_days_to_ready IS NULL THEN
      NEW.target_days_to_ready := 14;
    END IF;
    NEW.revision := 1;
  ELSE
    -- (org_id, purpose) is the row's identity.
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.purpose IS DISTINCT FROM OLD.purpose THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_sequence_identity_immutable';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.revision := OLD.revision + 1;
  END IF;
  NEW.updated_at := pg_catalog.now();
  -- Browser writes are attributed to the verified caller, never to a value
  -- the client sent.
  IF current_user = 'authenticated' THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.notification_sequence_steps_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.sequence_id IS DISTINCT FROM OLD.sequence_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_step_identity_immutable';
    END IF;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := pg_catalog.now();

  -- A cc'd user must be a member of the step's org. Malformed entries are
  -- left for notification_sequence_steps_cc_recipients_check to reject.
  IF pg_catalog.jsonb_typeof(NEW.cc_recipients) = 'array' AND EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(NEW.cc_recipients) AS r(item)
     WHERE pg_catalog.jsonb_typeof(r.item) = 'object'
       AND r.item ->> 'kind' = 'user'
       AND (r.item ->> 'user_id')
           ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND NOT EXISTS (
         SELECT 1
           FROM public.memberships AS m
          WHERE m.org_id = NEW.org_id
            AND m.user_id = (r.item ->> 'user_id')::uuid
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'notification_cc_user_not_member';
  END IF;
  RETURN NEW;
END;
$function$;

-- Cross-row rules, checked at commit (or at SET CONSTRAINTS ... IMMEDIATE)
-- so a save may delete and re-insert every step in one transaction.
CREATE OR REPLACE FUNCTION private.notification_sequence_steps_check_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_sequence_id uuid;
  v_purpose text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_sequence_id := OLD.sequence_id;
  ELSE
    v_sequence_id := NEW.sequence_id;
  END IF;

  SELECT s.purpose INTO v_purpose
    FROM public.notification_sequences AS s
   WHERE s.id = v_sequence_id;
  IF NOT FOUND THEN
    RETURN NULL;  -- the sequence itself was deleted (cascade)
  END IF;

  IF v_purpose = 'followup_digest' AND (
    SELECT pg_catalog.count(*) FROM public.notification_sequence_steps AS st
     WHERE st.sequence_id = v_sequence_id
  ) > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_digest_single_step';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        SELECT st.offset_days,
               pg_catalog.lag(st.offset_days) OVER (ORDER BY st.position) AS previous_offset
          FROM public.notification_sequence_steps AS st
         WHERE st.sequence_id = v_sequence_id
      ) AS ordered
     WHERE ordered.previous_offset IS NOT NULL
       AND ordered.offset_days <= ordered.previous_offset
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_step_offsets_not_increasing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_sequence_steps AS st
     WHERE st.sequence_id = v_sequence_id
       AND NOT pg_catalog.starts_with(st.template_key, v_purpose || '_')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_step_template_purpose_mismatch';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION private.sms_consents_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  -- Consent is evidence. The one allowed change is stamping a revocation on
  -- a live row; everything else, and any change to a revoked row, is refused.
  IF OLD.revoked_at IS NOT NULL
     OR (NEW.id, NEW.org_id, NEW.provider_id, NEW.phone_e164, NEW.consented_at, NEW.source,
         NEW.consent_text_version, NEW.recorded_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.org_id, OLD.provider_id, OLD.phone_e164, OLD.consented_at, OLD.source,
         OLD.consent_text_version, OLD.recorded_by, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'sms_consent_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.notification_sequences_stamp()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notification_sequence_steps_stamp()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notification_sequence_steps_check_set()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sms_consents_guard_update()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS notification_sequences_stamp ON public.notification_sequences;
CREATE TRIGGER notification_sequences_stamp
  BEFORE INSERT OR UPDATE ON public.notification_sequences
  FOR EACH ROW EXECUTE FUNCTION private.notification_sequences_stamp();

DROP TRIGGER IF EXISTS notification_sequence_steps_stamp ON public.notification_sequence_steps;
CREATE TRIGGER notification_sequence_steps_stamp
  BEFORE INSERT OR UPDATE ON public.notification_sequence_steps
  FOR EACH ROW EXECUTE FUNCTION private.notification_sequence_steps_stamp();

DROP TRIGGER IF EXISTS notification_sequence_steps_set_check ON public.notification_sequence_steps;
CREATE CONSTRAINT TRIGGER notification_sequence_steps_set_check
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_sequence_steps
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.notification_sequence_steps_check_set();

DROP TRIGGER IF EXISTS sms_consents_guard_update ON public.sms_consents;
CREATE TRIGGER sms_consents_guard_update
  BEFORE UPDATE ON public.sms_consents
  FOR EACH ROW EXECUTE FUNCTION private.sms_consents_guard_update();

-- ---------------------------------------------------------------------------
-- 4. RLS and grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_sequences_select_member ON public.notification_sequences;
CREATE POLICY notification_sequences_select_member ON public.notification_sequences
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

DROP POLICY IF EXISTS notification_sequences_insert_admin ON public.notification_sequences;
CREATE POLICY notification_sequences_insert_admin ON public.notification_sequences
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = 'admin');

DROP POLICY IF EXISTS notification_sequences_update_admin ON public.notification_sequences;
CREATE POLICY notification_sequences_update_admin ON public.notification_sequences
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = 'admin')
  WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = 'admin');

DROP POLICY IF EXISTS notification_sequence_steps_select_member ON public.notification_sequence_steps;
CREATE POLICY notification_sequence_steps_select_member ON public.notification_sequence_steps
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

DROP POLICY IF EXISTS notification_sequence_steps_insert_admin ON public.notification_sequence_steps;
CREATE POLICY notification_sequence_steps_insert_admin ON public.notification_sequence_steps
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = 'admin');

DROP POLICY IF EXISTS notification_sequence_steps_update_admin ON public.notification_sequence_steps;
CREATE POLICY notification_sequence_steps_update_admin ON public.notification_sequence_steps
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = 'admin')
  WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = 'admin');

DROP POLICY IF EXISTS notification_sequence_steps_delete_admin ON public.notification_sequence_steps;
CREATE POLICY notification_sequence_steps_delete_admin ON public.notification_sequence_steps
  FOR DELETE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = 'admin');

DROP POLICY IF EXISTS sms_consents_select_member ON public.sms_consents;
CREATE POLICY sms_consents_select_member ON public.sms_consents
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

-- A sequence row is never deleted by the app (turning it off is enabled =
-- false), so authenticated has no DELETE on it. Steps are replaced on save.
REVOKE ALL ON TABLE public.notification_sequences FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.notification_sequence_steps FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sms_consents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_sequences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequence_steps TO authenticated;
GRANT SELECT ON TABLE public.sms_consents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequence_steps TO service_role;
-- No DELETE: consent rows are evidence. Org and provider cascades still
-- remove them (referential actions run as the table owner).
GRANT SELECT, INSERT, UPDATE ON TABLE public.sms_consents TO service_role;

-- ---------------------------------------------------------------------------
-- 5. save_notification_sequence: the save path.
--    p_payload: {
--      enabled: boolean,
--      steps: [{ offset_days: int, channel: text, template_key: text,
--                cc_recipients: [...] }, ...],         -- 1..10, digest 1
--      stop_conditions: text[],                       -- intake only
--      target_days_to_ready: int | null,              -- intake only, null = 14
--      compress_toward_start_date: boolean,           -- intake only
--      expected_revision: int | null                  -- null when creating
--    }
--    Returns { sequence: <row>, steps: [<row>, ...] }.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_notification_sequence(uuid, text, jsonb);
CREATE FUNCTION public.save_notification_sequence(
  p_org_id uuid,
  p_purpose text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.notification_sequences%ROWTYPE;
  v_saved public.notification_sequences%ROWTYPE;
  v_found boolean;
  v_steps jsonb;
  v_step jsonb;
  v_enabled boolean;
  v_stop text[] := '{}'::text[];
  v_target integer;
  v_compress boolean := false;
  v_expected integer;
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- Admin of this org, as the verified caller. Under the service key
  -- auth.uid() is NULL and this refuses, by design.
  IF v_actor IS NULL OR p_org_id IS NULL
     OR public.user_role(p_org_id) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_sequence_not_authorized';
  END IF;

  IF p_purpose IS NULL OR p_purpose NOT IN ('followup_digest', 'intake_reminder') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: purpose';
  END IF;
  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: payload';
  END IF;

  IF pg_catalog.jsonb_typeof(p_payload -> 'enabled') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: enabled';
  END IF;
  v_enabled := (p_payload ->> 'enabled')::boolean;

  v_steps := p_payload -> 'steps';
  IF pg_catalog.jsonb_typeof(v_steps) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(v_steps) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: steps';
  END IF;
  IF p_purpose = 'followup_digest' AND pg_catalog.jsonb_array_length(v_steps) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_digest_single_step';
  END IF;
  FOR v_step IN SELECT s.value FROM pg_catalog.jsonb_array_elements(v_steps) AS s(value) LOOP
    IF pg_catalog.jsonb_typeof(v_step) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(v_step -> 'offset_days') IS DISTINCT FROM 'number'
       OR (v_step ->> 'offset_days') !~ '^[0-9]{1,3}$'
       OR pg_catalog.jsonb_typeof(v_step -> 'channel') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_step -> 'template_key') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_step -> 'cc_recipients') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: step';
    END IF;
  END LOOP;

  IF p_purpose = 'intake_reminder' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'stop_conditions') IS DISTINCT FROM 'array'
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload -> 'stop_conditions') AS c(value)
          WHERE pg_catalog.jsonb_typeof(c.value) <> 'string'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: stop_conditions';
    END IF;
    v_stop := ARRAY(
      SELECT pg_catalog.jsonb_array_elements_text(p_payload -> 'stop_conditions')
    );

    IF COALESCE(pg_catalog.jsonb_typeof(p_payload -> 'target_days_to_ready'), 'null') = 'null' THEN
      v_target := NULL;  -- the insert trigger fills 14; an update keeps the saved value
    ELSIF pg_catalog.jsonb_typeof(p_payload -> 'target_days_to_ready') = 'number'
          AND (p_payload ->> 'target_days_to_ready') ~ '^[0-9]{1,3}$' THEN
      v_target := (p_payload ->> 'target_days_to_ready')::integer;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: target_days_to_ready';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload -> 'compress_toward_start_date') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: compress_toward_start_date';
    END IF;
    v_compress := (p_payload ->> 'compress_toward_start_date')::boolean;
  ELSE
    -- The digest has none of the intake settings; refuse rather than drop them.
    IF COALESCE(pg_catalog.jsonb_array_length(
         CASE WHEN pg_catalog.jsonb_typeof(p_payload -> 'stop_conditions') = 'array'
              THEN p_payload -> 'stop_conditions' END), 0) > 0
       OR COALESCE(pg_catalog.jsonb_typeof(p_payload -> 'target_days_to_ready'), 'null') <> 'null'
       OR COALESCE(p_payload -> 'compress_toward_start_date', 'false'::jsonb) <> 'false'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: digest_has_no_intake_settings';
    END IF;
  END IF;

  IF COALESCE(pg_catalog.jsonb_typeof(p_payload -> 'expected_revision'), 'null') = 'null' THEN
    v_expected := NULL;
  ELSIF pg_catalog.jsonb_typeof(p_payload -> 'expected_revision') = 'number'
        AND (p_payload ->> 'expected_revision') ~ '^[0-9]{1,9}$' THEN
    v_expected := (p_payload ->> 'expected_revision')::integer;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'notification_sequence_invalid: expected_revision';
  END IF;

  -- Lock the row so two admins saving at once are serialized; the revision
  -- then turns the slower one into a conflict instead of a silent overwrite.
  SELECT * INTO v_existing
    FROM public.notification_sequences AS s
   WHERE s.org_id = p_org_id AND s.purpose = p_purpose
   FOR UPDATE;
  v_found := FOUND;

  IF v_found THEN
    IF v_expected IS DISTINCT FROM v_existing.revision THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_sequence_conflict';
    END IF;

    SELECT pg_catalog.jsonb_build_object(
             'sequence', pg_catalog.to_jsonb(s),
             'steps', COALESCE((
               SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(st) ORDER BY st.position)
                 FROM public.notification_sequence_steps AS st
                WHERE st.sequence_id = s.id
             ), '[]'::jsonb))
      INTO v_before
      FROM public.notification_sequences AS s
     WHERE s.id = v_existing.id;

    UPDATE public.notification_sequences AS s
       SET enabled = v_enabled,
           stop_conditions = v_stop,
           target_days_to_ready = CASE
             WHEN p_purpose = 'intake_reminder' THEN COALESCE(v_target, s.target_days_to_ready)
             ELSE NULL
           END,
           compress_toward_start_date = v_compress
     WHERE s.id = v_existing.id
     RETURNING * INTO v_saved;
  ELSE
    IF v_expected IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_sequence_conflict';
    END IF;
    BEGIN
      INSERT INTO public.notification_sequences
        (org_id, purpose, enabled, stop_conditions, target_days_to_ready,
         compress_toward_start_date)
        VALUES (p_org_id, p_purpose, v_enabled, v_stop, v_target, v_compress)
        RETURNING * INTO v_saved;
    EXCEPTION WHEN unique_violation THEN
      -- Another admin created it first.
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_sequence_conflict';
    END;
  END IF;

  DELETE FROM public.notification_sequence_steps AS st WHERE st.sequence_id = v_saved.id;

  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key, cc_recipients)
  SELECT v_saved.id,
         p_org_id,
         s.ordinal::integer,
         (s.value ->> 'offset_days')::integer,
         s.value ->> 'channel',
         s.value ->> 'template_key',
         s.value -> 'cc_recipients'
    FROM pg_catalog.jsonb_array_elements(v_steps) WITH ORDINALITY AS s(value, ordinal);

  -- Run the cross-row step rules now rather than at commit, so a bad save
  -- fails inside this call with its own message.
  SET CONSTRAINTS public.notification_sequence_steps_set_check IMMEDIATE;

  SELECT pg_catalog.jsonb_build_object(
           'sequence', pg_catalog.to_jsonb(s),
           'steps', COALESCE((
             SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(st) ORDER BY st.position)
               FROM public.notification_sequence_steps AS st
              WHERE st.sequence_id = s.id
           ), '[]'::jsonb))
    INTO v_after
    FROM public.notification_sequences AS s
   WHERE s.id = v_saved.id;

  -- Config only (purposes, offsets, template keys, member ids); no PHI.
  -- audit_log_actor_integrity_before_insert stamps the verified actor.
  INSERT INTO public.audit_log
    (org_id, user_id, action_type, entity_type, entity_id, before, after, description)
    VALUES (
      p_org_id,
      v_actor,
      CASE WHEN v_found THEN 'UPDATE' ELSE 'CREATE' END,
      'notification_sequence',
      v_saved.id,
      v_before,
      v_after,
      CASE p_purpose
        WHEN 'intake_reminder' THEN 'Saved provider intake reminder settings'
        ELSE 'Saved daily follow-up digest settings'
      END
    );

  RETURN v_after;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_notification_sequence(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_notification_sequence(uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Comments.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.notification_sequences IS
  'MINT-107: one org''s notification settings for one purpose (followup_digest | intake_reminder). No row = off. Members read; admins write, normally through save_notification_sequence. Config only; nothing sends from this table yet.';
COMMENT ON COLUMN public.notification_sequences.enabled IS
  'Whether the purpose sends at all. Defaults to false; nothing auto-enables it.';
COMMENT ON COLUMN public.notification_sequences.stop_conditions IS
  'Intake only: the events that end an intake reminder sequence early, a subset of submitted, paused, withdrawn, provider_replied. Always empty for the digest.';
COMMENT ON COLUMN public.notification_sequences.target_days_to_ready IS
  'Intake only: days from invite to ready, 1 to 90, default 14 (filled by the insert trigger). NULL for the digest.';
COMMENT ON COLUMN public.notification_sequences.compress_toward_start_date IS
  'Intake only: when true and the provider has a start date sooner than the schedule''s end, reminders are pulled closer together so the last lands no later than the day before the start date. The rule is scheduleSequenceSends() in src/lib/notificationSequences.ts.';
COMMENT ON COLUMN public.notification_sequences.revision IS
  'Optimistic-concurrency counter: 1 on insert, +1 on every update (trigger). save_notification_sequence refuses a save whose expected_revision is stale.';
COMMENT ON COLUMN public.notification_sequences.updated_by IS
  'The last browser writer (auth.uid(), stamped by trigger). An actor id, not a foreign key.';

COMMENT ON TABLE public.notification_sequence_steps IS
  'MINT-107: the ordered messages of a notification sequence. offset_days strictly increase with position; the digest has at most one step; template_key starts with the sequence''s purpose (deferred constraint trigger notification_sequence_steps_set_check).';
COMMENT ON COLUMN public.notification_sequence_steps.offset_days IS
  'Days after the anchor (the invite, for intake reminders) that this step goes out, before any start-date compression. 0 to 90.';
COMMENT ON COLUMN public.notification_sequence_steps.channel IS
  'email or sms. An sms step reaches only a provider with a live sms_consents row for the number; cc''d copies are always emailed.';
COMMENT ON COLUMN public.notification_sequence_steps.template_key IS
  'A key from the template catalog (src/lib/notificationTemplates.ts), registered in src/server/email/templates.ts by the PR that sends it. No free-form body.';
COMMENT ON COLUMN public.notification_sequence_steps.cc_recipients IS
  'Ordered escalation list for this step, empty by default: [{"kind":"user","user_id":uuid} | {"kind":"role","role":"admin"|"specialist"|"billing"}]. Users must be org members when saved. A cc''d copy never carries SSN, date of birth or document contents.';

COMMENT ON TABLE public.sms_consents IS
  'MINT-107: a provider''s recorded agreement to receive texts at one number: when, how (source), which consent text version, and revocation. Evidence: the only allowed update stamps revoked_at + revoked_source once. Members read; only service_role writes (the intake form, later).';
COMMENT ON COLUMN public.sms_consents.phone_e164 IS 'The consented number in E.164 form, e.g. +15555550123.';
COMMENT ON COLUMN public.sms_consents.consent_text_version IS
  'The version id of the exact consent wording the provider agreed to.';
COMMENT ON COLUMN public.sms_consents.source IS
  'How consent was given: intake_form, staff_recorded (paper or verbal, with recorded_by), or sms_keyword (a START reply).';

COMMENT ON FUNCTION public.save_notification_sequence(uuid, text, jsonb) IS
  'MINT-107: admin-only, SECURITY INVOKER. Creates or replaces one purpose''s sequence and all its steps in one transaction, checks expected_revision (40001 notification_sequence_conflict when stale), and writes one audit_log row. Returns {sequence, steps}. Never call it with the service key.';

NOTIFY pgrst, 'reload schema';

-- MINT-107: organization notification sequences, email and SMS, with Minted's
-- platform defaults. Config only: nothing in this migration, or in the PR that
-- adds it, sends a message.
--
-- Reminder and digest cadence is configuration, never a constant. Two purposes:
--
--   followup_digest  the daily coordinator follow-up digest (a later PR). One
--                    step, sent to coordinators only (no cc list), at a local
--                    send hour in a time zone that Minted sets.
--   intake_reminder  reminders to a provider with an open onboarding invite
--                    (after the intake back end merges). Up to 10 steps with
--                    ordered cc lists, plus stop conditions, a target number of
--                    days from invite to ready, and start-date compression.
--
-- Two layers (MINT-107 decisions, Oct 30):
--
--   * Minted's platform default, one per purpose: notification_sequence_defaults
--     and its notification_sequence_default_steps. Seeded below. No org, no
--     PHI, no cc list (a default names no one), and no `enabled` column, so a
--     default can never switch every org on. Read by any member of any org;
--     written by service_role only. Mission Control M6 adds the platform-admin
--     write policy and grant.
--   * An org's own row, one per (org, purpose): notification_sequences and its
--     notification_sequence_steps. It overrides the default field by field: a
--     NULL setting means "use Minted's default", and an org with no steps of
--     its own uses the default steps. `enabled` is never inherited: an org is
--     on only when its own row says so, and no row means off.
--
--   The resolution (org row + default -> effective sequence) is
--   resolveNotificationSequence() in src/lib/notificationSequences.ts. Every
--   consumer calls it rather than re-deriving it.
--
-- Platform-managed settings. Org admins never set these, by any path; Minted
-- sets them (Mission Control later), on the default or as an org override
-- written with the service key:
--   * compress_toward_start_date (intake). Off in R1: the default is false.
--   * send_hour (0-23) and send_time_zone (an IANA zone) (digest). The default
--     is 8 in America/Chicago, the old fixed cron's 13:00 UTC in CDT.
-- On notification_sequences, authenticated holds no INSERT or UPDATE privilege
-- on those three columns (column grants), the stamp trigger refuses a change
-- to them from authenticated as a second wall, and save_notification_sequence
-- refuses a payload that names them.
--
-- Other product rules this schema encodes:
--   * No default escalation chain. cc_recipients is an ordered jsonb array of
--     {"kind":"user","user_id":<uuid>} | {"kind":"role","role":<org role>},
--     empty by default, validated by notification_cc_recipients_valid() in a
--     CHECK. A cc'd user must be a member of the org when the step is saved
--     (BEFORE trigger); membership can lapse later, so the sender re-checks.
--     cc'd copies are always emailed, whatever the step's channel.
--   * The digest has no cc list: a digest step's cc_recipients must be empty.
--   * Channels email and sms. SMS needs recorded consent: sms_consents holds
--     who (provider), which number, when, how (source), which consent text
--     version, and when it was revoked. No UI writes it here; the intake form
--     will, through a service-role path. A row is evidence: the only change
--     allowed is stamping a revocation once.
--   * Stop conditions are a validated subset of submitted, paused, withdrawn,
--     provider_replied (intake only). Each is switchable per org, submitted
--     included.
--   * A bounce on intake step 1 escalates to step 1's cc list. That is a fixed
--     rule, not a setting, so it has no column: the consumer applies it through
--     bounceEscalationRecipients() in src/lib/notificationSequences.ts.
--   * cc'd escalation messages never carry SSN, DOB or document contents. No
--     template exists yet; the rule is a constraint on the template catalog
--     (src/lib/notificationTemplates.ts), checked by its unit test.
--
-- Access. RLS on all five tables. Any member of an org reads its own
-- sequences, steps and consents, and nobody reads another org's. Any member of
-- any org reads the platform defaults. Only an org admin
-- (user_role(org_id) = 'admin') writes the org's sequences and steps.
-- sms_consents and the defaults have no authenticated write grant at all.
-- save_notification_sequence() is the save path: SECURITY INVOKER (RLS stays
-- the wall), admin-checked, one transaction, revision-checked against
-- concurrent editors, and it writes its own audit_log row. Direct admin writes
-- are possible but hit the same grants, CHECKs and triggers: offsets strictly
-- increase with position, the digest has at most one step and no cc, and a
-- step's template_key starts with its sequence's purpose. A direct step write
-- also bumps its sequence's revision (once per transaction), so a concurrent
-- save gets the conflict instead of overwriting it. Direct writes are NOT
-- audited; only the RPC writes audit_log.
--
-- Functions referenced by a CHECK or a trigger use CREATE OR REPLACE: a DROP
-- would fail on re-run because the constraint or trigger depends on it, and
-- their signatures are new, so no PostgREST overload can arise. The RPC is
-- DROP + CREATE.
--
-- Additive and re-runnable. REPO-ONLY until an operator applies it, staging
-- first. The app reads these tables from the Org Detail Notifications card;
-- until the apply, PostgREST reports the tables missing (PGRST205 / 42P01)
-- and the card says notification settings are not switched on yet
-- (isMissingNotificationSequenceTablesError in src/lib/dbErrors.ts).
-- Verify the OBJECTS, not a ledger filename (supabase-migrations skill):
--   SELECT to_regclass('public.notification_sequences'),
--          to_regclass('public.notification_sequence_steps'),
--          to_regclass('public.notification_sequence_defaults'),
--          to_regclass('public.notification_sequence_default_steps'),
--          to_regclass('public.sms_consents');           -- all five non-null
--   SELECT purpose, send_hour, send_time_zone, compress_toward_start_date
--     FROM public.notification_sequence_defaults ORDER BY 1;
--     -> followup_digest | 8 | America/Chicago | NULL
--        intake_reminder | NULL | NULL | false
--   SELECT pg_get_function_identity_arguments(oid), prosecdef
--     FROM pg_proc WHERE proname = 'save_notification_sequence';
--     -> p_org_id uuid, p_purpose text, p_payload jsonb | false
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename LIKE 'notification_sequence%' OR tablename = 'sms_consents'
--    ORDER BY 1, 2;                                     -- 11 policies
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
-- 1. Validators used by CHECK constraints. No writes. They live in `private`
--    so PostgREST never exposes them as /rpc/ endpoints. A CHECK runs its
--    function as the writing role, which needs EXECUTE on it but no USAGE on
--    the schema (USAGE governs name lookup, and the constraint stores the
--    function's oid).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.notification_stop_conditions_valid(p_conditions text[])
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

CREATE OR REPLACE FUNCTION private.notification_cc_recipients_valid(p_recipients jsonb)
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

-- An IANA zone name ("America/Chicago", "America/Argentina/Buenos_Aires",
-- "UTC") that this server's tz database knows. The pattern keeps out
-- abbreviations ("CST"), POSIX strings ("EST5EDT", "+05:00") and the
-- lower-case posix/ and right/ trees, which JavaScript's Intl, the other
-- reader of this value, does not take. STABLE, not IMMUTABLE: it reads
-- pg_timezone_names.
CREATE OR REPLACE FUNCTION private.notification_time_zone_valid(p_zone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT p_zone IS NOT NULL
     AND p_zone ~ '^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2})$'
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name = p_zone
     );
$function$;

-- A CHECK runs its function as the writing role, so both writers need EXECUTE.
REVOKE ALL ON FUNCTION private.notification_stop_conditions_valid(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.notification_cc_recipients_valid(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.notification_time_zone_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.notification_stop_conditions_valid(text[])
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.notification_cc_recipients_valid(jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.notification_time_zone_valid(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION private.notification_stop_conditions_valid(text[]) IS
  'MINT-107: true when the array is a duplicate-free, NULL-free subset of submitted, paused, withdrawn, provider_replied. Used by the stop_conditions CHECKs.';
COMMENT ON FUNCTION private.notification_cc_recipients_valid(jsonb) IS
  'MINT-107: true when the value is an array of at most 20 distinct entries, each exactly {"kind":"user","user_id":<lower-case uuid>} or {"kind":"role","role":"admin"|"specialist"|"billing"}. Used by notification_sequence_steps_cc_recipients_check. Membership is checked by a trigger, not here.';
COMMENT ON FUNCTION private.notification_time_zone_valid(text) IS
  'MINT-107: true when the value is an IANA zone name (Area/Location, or UTC) listed in pg_timezone_names. Used by the send_time_zone CHECKs.';

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------

-- Minted's platform default, one row per purpose. No org_id and no enabled.
CREATE TABLE IF NOT EXISTS public.notification_sequence_defaults (
  purpose text PRIMARY KEY,
  -- Intake: the default stop conditions, target and compression.
  stop_conditions text[],
  target_days_to_ready integer,
  compress_toward_start_date boolean,
  -- Digest: the local hour and the zone it goes out in.
  send_hour smallint,
  send_time_zone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_sequence_defaults_purpose_check
    CHECK (purpose IN ('followup_digest', 'intake_reminder')),
  CONSTRAINT notification_sequence_defaults_stop_conditions_check
    CHECK (stop_conditions IS NULL OR private.notification_stop_conditions_valid(stop_conditions)),
  CONSTRAINT notification_sequence_defaults_target_days_check
    CHECK (target_days_to_ready IS NULL OR target_days_to_ready BETWEEN 1 AND 90),
  CONSTRAINT notification_sequence_defaults_send_hour_check
    CHECK (send_hour IS NULL OR send_hour BETWEEN 0 AND 23),
  CONSTRAINT notification_sequence_defaults_send_time_zone_check
    CHECK (send_time_zone IS NULL OR private.notification_time_zone_valid(send_time_zone)),
  -- A default is complete for its purpose and carries nothing of the other's.
  CONSTRAINT notification_sequence_defaults_purpose_settings_check CHECK (
    (
      purpose = 'intake_reminder'
      AND stop_conditions IS NOT NULL
      AND target_days_to_ready IS NOT NULL
      AND compress_toward_start_date IS NOT NULL
      AND send_hour IS NULL
      AND send_time_zone IS NULL
    )
    OR (
      purpose = 'followup_digest'
      AND stop_conditions IS NULL
      AND target_days_to_ready IS NULL
      AND compress_toward_start_date IS NULL
      AND send_hour IS NOT NULL
      AND send_time_zone IS NOT NULL
    )
  )
);

-- The default's ordered steps. No cc_recipients: a default names no one.
CREATE TABLE IF NOT EXISTS public.notification_sequence_default_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  position integer NOT NULL,
  offset_days integer NOT NULL,
  channel text NOT NULL,
  template_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_sequence_default_steps_purpose_fkey FOREIGN KEY (purpose)
    REFERENCES public.notification_sequence_defaults (purpose) ON DELETE CASCADE,
  CONSTRAINT notification_sequence_default_steps_position_key UNIQUE (purpose, position),
  CONSTRAINT notification_sequence_default_steps_position_check CHECK (position BETWEEN 1 AND 10),
  CONSTRAINT notification_sequence_default_steps_offset_days_check
    CHECK (offset_days BETWEEN 0 AND 90),
  CONSTRAINT notification_sequence_default_steps_channel_check CHECK (channel IN ('email', 'sms')),
  CONSTRAINT notification_sequence_default_steps_template_key_check
    CHECK (template_key ~ '^[a-z][a-z0-9_]{2,63}$' AND starts_with(template_key, purpose || '_'))
);

-- An org's own settings for one purpose. A NULL setting uses Minted's default.
CREATE TABLE IF NOT EXISTS public.notification_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  -- Never inherited.
  enabled boolean NOT NULL DEFAULT false,
  -- Intake, set by org admins. NULL: Minted's default.
  stop_conditions text[],
  target_days_to_ready integer,
  -- Platform-managed (service_role only). NULL: Minted's default.
  compress_toward_start_date boolean,
  send_hour smallint,
  send_time_zone text,
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
    CHECK (stop_conditions IS NULL OR private.notification_stop_conditions_valid(stop_conditions)),
  CONSTRAINT notification_sequences_target_days_check
    CHECK (target_days_to_ready IS NULL OR target_days_to_ready BETWEEN 1 AND 90),
  CONSTRAINT notification_sequences_send_hour_check
    CHECK (send_hour IS NULL OR send_hour BETWEEN 0 AND 23),
  CONSTRAINT notification_sequences_send_time_zone_check
    CHECK (send_time_zone IS NULL OR private.notification_time_zone_valid(send_time_zone)),
  -- Each purpose's row carries only its own settings.
  CONSTRAINT notification_sequences_purpose_settings_check CHECK (
    (purpose = 'intake_reminder' AND send_hour IS NULL AND send_time_zone IS NULL)
    OR (
      purpose = 'followup_digest'
      AND stop_conditions IS NULL
      AND target_days_to_ready IS NULL
      AND compress_toward_start_date IS NULL
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
    CHECK (private.notification_cc_recipients_valid(cc_recipients))
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
  -- CASCADE, not RESTRICT: the staging UAT reseed (supabase/seed-uat.sql,
  -- reset mode 'all') hard-deletes its synthetic providers, and RESTRICT would
  -- fail it once any of them has a consent row. No app path deletes a
  -- provider; terminating one keeps its row and its consent history.
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
  CONSTRAINT sms_consents_revoked_after_check CHECK (revoked_at IS NULL OR revoked_at >= consented_at),
  -- Paper or verbal consent names the staff member who took it.
  CONSTRAINT sms_consents_staff_recorded_by_check
    CHECK (source <> 'staff_recorded' OR recorded_by IS NOT NULL)
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
  -- The platform-managed settings are Minted's to set (service_role now,
  -- Mission Control later). authenticated holds no column grant on them;
  -- this is the second wall, should a grant ever widen.
  IF TG_OP = 'INSERT' THEN
    IF current_user = 'authenticated'
       AND (NEW.compress_toward_start_date IS NOT NULL
            OR NEW.send_hour IS NOT NULL
            OR NEW.send_time_zone IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_platform_setting';
    END IF;
    NEW.revision := 1;
  ELSE
    -- (org_id, purpose) is the row's identity.
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.purpose IS DISTINCT FROM OLD.purpose THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_sequence_identity_immutable';
    END IF;
    IF current_user = 'authenticated'
       AND (NEW.compress_toward_start_date IS DISTINCT FROM OLD.compress_toward_start_date
            OR NEW.send_hour IS DISTINCT FROM OLD.send_hour
            OR NEW.send_time_zone IS DISTINCT FROM OLD.send_time_zone) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_platform_setting';
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

-- A step write changes its sequence, so it bumps the sequence's revision: a
-- concurrent save_notification_sequence holding the old revision then gets
-- the conflict instead of overwriting the edit. One bump per transaction:
-- now() is the transaction's start time, and the sequences stamp trigger
-- sets updated_at := now(), so a sequence already stamped in this
-- transaction (by the save RPC, which updates the sequence before touching
-- its steps, or by an earlier step write) is left alone. Touching the row
-- runs that stamp trigger, which bumps revision and records updated_by.
CREATE OR REPLACE FUNCTION private.notification_sequence_steps_touch_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_sequence_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_sequence_id := OLD.sequence_id;
  ELSE
    v_sequence_id := NEW.sequence_id;
  END IF;
  -- Zero rows when the sequence is being deleted itself (cascade).
  UPDATE public.notification_sequences AS s
     SET updated_at = pg_catalog.now()
   WHERE s.id = v_sequence_id
     AND s.updated_at IS DISTINCT FROM pg_catalog.now();
  RETURN NULL;
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

  -- The digest goes to coordinators only: nobody is cc'd on it.
  IF v_purpose = 'followup_digest' AND EXISTS (
    SELECT 1 FROM public.notification_sequence_steps AS st
     WHERE st.sequence_id = v_sequence_id
       AND st.cc_recipients <> '[]'::jsonb
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_digest_has_no_cc';
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

-- Both default tables: purpose is the identity, created_at is kept.
CREATE OR REPLACE FUNCTION private.notification_defaults_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.purpose IS DISTINCT FROM OLD.purpose THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_default_identity_immutable';
    END IF;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

-- The default steps' cross-row rules, as for an org's steps (the template
-- prefix is a row CHECK here, since the purpose is on the row).
CREATE OR REPLACE FUNCTION private.notification_sequence_default_steps_check_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_purpose text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_purpose := OLD.purpose;
  ELSE
    v_purpose := NEW.purpose;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_sequence_defaults AS d WHERE d.purpose = v_purpose
  ) THEN
    RETURN NULL;  -- the default itself was deleted (cascade)
  END IF;

  IF v_purpose = 'followup_digest' AND (
    SELECT pg_catalog.count(*) FROM public.notification_sequence_default_steps AS st
     WHERE st.purpose = v_purpose
  ) > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_digest_single_step';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        SELECT st.offset_days,
               pg_catalog.lag(st.offset_days) OVER (ORDER BY st.position) AS previous_offset
          FROM public.notification_sequence_default_steps AS st
         WHERE st.purpose = v_purpose
      ) AS ordered
     WHERE ordered.previous_offset IS NOT NULL
       AND ordered.offset_days <= ordered.previous_offset
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_step_offsets_not_increasing';
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
REVOKE ALL ON FUNCTION private.notification_sequence_steps_touch_parent()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notification_defaults_stamp()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notification_sequence_default_steps_check_set()
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

DROP TRIGGER IF EXISTS notification_sequence_steps_touch_parent ON public.notification_sequence_steps;
CREATE TRIGGER notification_sequence_steps_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_sequence_steps
  FOR EACH ROW EXECUTE FUNCTION private.notification_sequence_steps_touch_parent();

DROP TRIGGER IF EXISTS notification_sequence_steps_set_check ON public.notification_sequence_steps;
CREATE CONSTRAINT TRIGGER notification_sequence_steps_set_check
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_sequence_steps
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.notification_sequence_steps_check_set();

DROP TRIGGER IF EXISTS notification_sequence_defaults_stamp ON public.notification_sequence_defaults;
CREATE TRIGGER notification_sequence_defaults_stamp
  BEFORE INSERT OR UPDATE ON public.notification_sequence_defaults
  FOR EACH ROW EXECUTE FUNCTION private.notification_defaults_stamp();

DROP TRIGGER IF EXISTS notification_sequence_default_steps_stamp
  ON public.notification_sequence_default_steps;
CREATE TRIGGER notification_sequence_default_steps_stamp
  BEFORE INSERT OR UPDATE ON public.notification_sequence_default_steps
  FOR EACH ROW EXECUTE FUNCTION private.notification_defaults_stamp();

DROP TRIGGER IF EXISTS notification_sequence_default_steps_set_check
  ON public.notification_sequence_default_steps;
CREATE CONSTRAINT TRIGGER notification_sequence_default_steps_set_check
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_sequence_default_steps
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.notification_sequence_default_steps_check_set();

DROP TRIGGER IF EXISTS sms_consents_guard_update ON public.sms_consents;
CREATE TRIGGER sms_consents_guard_update
  BEFORE UPDATE ON public.sms_consents
  FOR EACH ROW EXECUTE FUNCTION private.sms_consents_guard_update();

-- ---------------------------------------------------------------------------
-- 4. RLS and grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_sequence_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_sequence_default_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_consents ENABLE ROW LEVEL SECURITY;

-- The defaults: any member of any org reads them (they carry no org and no
-- PHI); a signed-in user with no membership reads nothing. No write policy:
-- service_role (BYPASSRLS) is the only writer for now. Mission Control M6
-- adds the platform-admin write policy and grant.
DROP POLICY IF EXISTS notification_sequence_defaults_select_member
  ON public.notification_sequence_defaults;
CREATE POLICY notification_sequence_defaults_select_member ON public.notification_sequence_defaults
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_org_ids()));

DROP POLICY IF EXISTS notification_sequence_default_steps_select_member
  ON public.notification_sequence_default_steps;
CREATE POLICY notification_sequence_default_steps_select_member
  ON public.notification_sequence_default_steps
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_org_ids()));

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

-- REVOKE ALL ON TABLE also clears column grants, so a re-run starts clean.
REVOKE ALL ON TABLE public.notification_sequence_defaults
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.notification_sequence_default_steps
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.notification_sequences FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.notification_sequence_steps FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sms_consents FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.notification_sequence_defaults TO authenticated;
GRANT SELECT ON TABLE public.notification_sequence_default_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequence_defaults TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequence_default_steps
  TO service_role;

-- An org admin writes only the org-owned columns. The platform-managed ones
-- (compress_toward_start_date, send_hour, send_time_zone), and the columns
-- the stamp trigger owns (id, revision, created_at, updated_by), have no
-- authenticated grant. updated_at is granted because a step write touches
-- its sequence (notification_sequence_steps_touch_parent runs as the caller);
-- the stamp trigger overwrites it anyway. A sequence row is never deleted by
-- the app (turning it off is enabled = false), so there is no DELETE grant.
GRANT SELECT ON TABLE public.notification_sequences TO authenticated;
GRANT INSERT (org_id, purpose, enabled, stop_conditions, target_days_to_ready)
  ON TABLE public.notification_sequences TO authenticated;
GRANT UPDATE (enabled, stop_conditions, target_days_to_ready, updated_at)
  ON TABLE public.notification_sequences TO authenticated;
-- Steps are replaced on save.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequence_steps TO authenticated;
GRANT SELECT ON TABLE public.sms_consents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_sequence_steps TO service_role;
-- No DELETE: consent rows are evidence. Org and provider cascades still
-- remove them (referential actions run as the table owner).
GRANT SELECT, INSERT, UPDATE ON TABLE public.sms_consents TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Seed Minted's defaults. Only when the purpose has no default yet, so a
--    re-run never overwrites an edited default or re-adds a removed step.
--    No PHI and no org: offsets, channels, catalog keys and platform settings.
-- ---------------------------------------------------------------------------
DO $seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_sequence_defaults WHERE purpose = 'intake_reminder'
  ) THEN
    -- Three emails on days 2, 4 and 7, stopping on any of the four events,
    -- a 14-day target, and compression off (R1).
    INSERT INTO public.notification_sequence_defaults
      (purpose, stop_conditions, target_days_to_ready, compress_toward_start_date)
    VALUES
      ('intake_reminder', ARRAY['submitted', 'paused', 'withdrawn', 'provider_replied']::text[],
       14, false);
    INSERT INTO public.notification_sequence_default_steps
      (purpose, position, offset_days, channel, template_key)
    VALUES
      ('intake_reminder', 1, 2, 'email', 'intake_reminder_first'),
      ('intake_reminder', 2, 4, 'email', 'intake_reminder_second'),
      ('intake_reminder', 3, 7, 'email', 'intake_reminder_final');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_sequence_defaults WHERE purpose = 'followup_digest'
  ) THEN
    -- One email a day at 8 am Central (13:00 UTC in CDT, the old fixed cron).
    INSERT INTO public.notification_sequence_defaults (purpose, send_hour, send_time_zone)
    VALUES ('followup_digest', 8, 'America/Chicago');
    INSERT INTO public.notification_sequence_default_steps
      (purpose, position, offset_days, channel, template_key)
    VALUES ('followup_digest', 1, 0, 'email', 'followup_digest_daily');
  END IF;
END;
$seed$;

-- ---------------------------------------------------------------------------
-- 6. save_notification_sequence: the org admin's save path.
--    p_payload: {
--      enabled: boolean,                              -- required, the org's own
--      steps: [{ offset_days: int, channel: text, template_key: text,
--                cc_recipients: [...] }, ...] | null, -- 1..10, digest 1 with
--                                                     -- no cc; null = Minted's
--                                                     -- default steps
--      stop_conditions: text[] | null,                -- intake; null = default
--      target_days_to_ready: int | null,              -- intake; null = default
--      expected_revision: int | null                  -- null when creating
--    }
--    Any other key is refused. Naming compress_toward_start_date, send_hour or
--    send_time_zone is refused with 42501 notification_platform_setting:
--    Minted sets those. Returns { sequence: <row>, steps: [<row>, ...] }.
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
  v_key text;
  v_steps jsonb;
  v_step jsonb;
  v_enabled boolean;
  v_stop text[];
  v_target integer;
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

  -- Only the org's own settings. The platform-managed ones are Minted's.
  FOR v_key IN SELECT k.setting FROM pg_catalog.jsonb_object_keys(p_payload) AS k(setting) LOOP
    IF v_key IN ('compress_toward_start_date', 'send_hour', 'send_time_zone') THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'notification_platform_setting: ' || v_key;
    END IF;
    IF v_key NOT IN ('enabled', 'steps', 'stop_conditions', 'target_days_to_ready',
                     'expected_revision') THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: unknown setting ' || v_key;
    END IF;
  END LOOP;

  IF pg_catalog.jsonb_typeof(p_payload -> 'enabled') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: enabled';
  END IF;
  v_enabled := (p_payload ->> 'enabled')::boolean;

  -- null (or absent): no steps of its own, so the org uses Minted's default steps.
  v_steps := p_payload -> 'steps';
  IF COALESCE(pg_catalog.jsonb_typeof(v_steps), 'null') = 'null' THEN
    v_steps := NULL;
  ELSIF pg_catalog.jsonb_typeof(v_steps) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: steps';
  ELSIF pg_catalog.jsonb_array_length(v_steps) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_sequence_invalid: steps';
  END IF;

  IF v_steps IS NOT NULL THEN
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
      -- The digest goes to coordinators only.
      IF p_purpose = 'followup_digest'
         AND pg_catalog.jsonb_array_length(v_step -> 'cc_recipients') > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'notification_digest_has_no_cc';
      END IF;
    END LOOP;
  END IF;

  IF p_purpose = 'intake_reminder' THEN
    -- null: Minted's default stop conditions. [] is a real choice: never stop early.
    IF COALESCE(pg_catalog.jsonb_typeof(p_payload -> 'stop_conditions'), 'null') = 'null' THEN
      v_stop := NULL;
    ELSIF pg_catalog.jsonb_typeof(p_payload -> 'stop_conditions') <> 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: stop_conditions';
    ELSIF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload -> 'stop_conditions') AS c(value)
       WHERE pg_catalog.jsonb_typeof(c.value) <> 'string'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: stop_conditions';
    ELSE
      v_stop := ARRAY(
        SELECT pg_catalog.jsonb_array_elements_text(p_payload -> 'stop_conditions')
      );
    END IF;

    -- null: Minted's default target.
    IF COALESCE(pg_catalog.jsonb_typeof(p_payload -> 'target_days_to_ready'), 'null') = 'null' THEN
      v_target := NULL;
    ELSIF pg_catalog.jsonb_typeof(p_payload -> 'target_days_to_ready') = 'number'
          AND (p_payload ->> 'target_days_to_ready') ~ '^[0-9]{1,3}$' THEN
      v_target := (p_payload ->> 'target_days_to_ready')::integer;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: target_days_to_ready';
    END IF;
  ELSE
    -- The digest has none of the intake settings; refuse rather than drop them.
    IF COALESCE(pg_catalog.jsonb_typeof(p_payload -> 'stop_conditions'), 'null') <> 'null'
       OR COALESCE(pg_catalog.jsonb_typeof(p_payload -> 'target_days_to_ready'), 'null') <> 'null' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'notification_sequence_invalid: digest_has_no_intake_settings';
    END IF;
    v_stop := NULL;
    v_target := NULL;
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
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'notification_sequence_conflict';
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

    -- The platform-managed columns are not named, so an override Minted set
    -- stays as it is.
    UPDATE public.notification_sequences AS s
       SET enabled = v_enabled,
           stop_conditions = v_stop,
           target_days_to_ready = v_target
     WHERE s.id = v_existing.id
     RETURNING * INTO v_saved;
  ELSE
    IF v_expected IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'notification_sequence_conflict';
    END IF;
    BEGIN
      INSERT INTO public.notification_sequences
        (org_id, purpose, enabled, stop_conditions, target_days_to_ready)
        VALUES (p_org_id, p_purpose, v_enabled, v_stop, v_target)
        RETURNING * INTO v_saved;
    EXCEPTION WHEN unique_violation THEN
      -- Another admin created it first.
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'notification_sequence_conflict';
    END;
  END IF;

  DELETE FROM public.notification_sequence_steps AS st WHERE st.sequence_id = v_saved.id;

  IF v_steps IS NOT NULL THEN
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
  END IF;

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
-- 7. Comments.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.notification_sequence_defaults IS
  'MINT-107: Minted''s platform default for one purpose (followup_digest | intake_reminder), which every org inherits field by field. No org, no PHI, no enabled column: a default never switches an org on. Any member of any org reads it; only service_role writes it (Mission Control M6 adds the platform-admin write policy). Seeded by migration 20261031051500.';
COMMENT ON COLUMN public.notification_sequence_defaults.compress_toward_start_date IS
  'Intake: whether reminders tighten toward a near start date (scheduleSequenceSends). Platform-managed; false in R1.';
COMMENT ON COLUMN public.notification_sequence_defaults.send_hour IS
  'Digest: the local hour (0 to 23) the digest goes out, in send_time_zone. Platform-managed; 8 by default.';
COMMENT ON COLUMN public.notification_sequence_defaults.send_time_zone IS
  'Digest: the IANA time zone of send_hour. Platform-managed; America/Chicago by default.';
COMMENT ON TABLE public.notification_sequence_default_steps IS
  'MINT-107: the ordered steps of a platform default. An org with no steps of its own uses these. No cc list: a default names no one. Same bounds as notification_sequence_steps; offsets strictly increase and the digest has at most one step (deferred constraint trigger).';

COMMENT ON TABLE public.notification_sequences IS
  'MINT-107: one org''s notification settings for one purpose (followup_digest | intake_reminder). No row = off. A NULL setting uses Minted''s default (notification_sequence_defaults); enabled is never inherited. Members read; admins write the org-owned columns, normally through save_notification_sequence. Config only; nothing sends from this table yet.';
COMMENT ON COLUMN public.notification_sequences.enabled IS
  'Whether the purpose sends at all for this org. Defaults to false; never inherited from Minted''s default.';
COMMENT ON COLUMN public.notification_sequences.stop_conditions IS
  'Intake only: the events that end an intake reminder sequence early, a subset of submitted, paused, withdrawn, provider_replied. NULL uses Minted''s default; an empty array never stops early. Always NULL for the digest.';
COMMENT ON COLUMN public.notification_sequences.target_days_to_ready IS
  'Intake only: days from invite to ready, 1 to 90. NULL uses Minted''s default (14). Always NULL for the digest.';
COMMENT ON COLUMN public.notification_sequences.compress_toward_start_date IS
  'Intake only, platform-managed: an org override Minted sets with the service key; org admins cannot write it. When true and the provider has a start date sooner than the schedule''s end, reminders are pulled closer together so the last lands no later than the day before the start date (scheduleSequenceSends() in src/lib/notificationSequences.ts). NULL uses Minted''s default (false in R1).';
COMMENT ON COLUMN public.notification_sequences.send_hour IS
  'Digest only, platform-managed: an org override of the local send hour (0 to 23). NULL uses Minted''s default (8).';
COMMENT ON COLUMN public.notification_sequences.send_time_zone IS
  'Digest only, platform-managed: an org override of the IANA zone of send_hour. NULL uses Minted''s default (America/Chicago).';
COMMENT ON COLUMN public.notification_sequences.revision IS
  'Optimistic-concurrency counter: 1 on insert, +1 on every update (trigger), and +1 when a direct write changes its steps (once per transaction). save_notification_sequence refuses a save whose expected_revision is stale with PT409 (HTTP 409).';
COMMENT ON COLUMN public.notification_sequences.updated_by IS
  'The last browser writer (auth.uid(), stamped by trigger). An actor id, not a foreign key.';

COMMENT ON TABLE public.notification_sequence_steps IS
  'MINT-107: an org''s own ordered messages for a sequence; none means the org uses Minted''s default steps. offset_days strictly increase with position; the digest has at most one step and no cc; template_key starts with the sequence''s purpose (deferred constraint trigger notification_sequence_steps_set_check).';
COMMENT ON COLUMN public.notification_sequence_steps.offset_days IS
  'Days after the anchor (the invite, for intake reminders) that this step goes out, before any start-date compression. 0 to 90.';
COMMENT ON COLUMN public.notification_sequence_steps.channel IS
  'email or sms. An sms step reaches only a provider with a live sms_consents row for the number; cc''d copies are always emailed.';
COMMENT ON COLUMN public.notification_sequence_steps.template_key IS
  'A key from the template catalog (src/lib/notificationTemplates.ts), registered in src/server/email/templates.ts by the PR that sends it. No free-form body. The database checks only the format and the purpose prefix, so a sender must look the key up in NOTIFICATION_TEMPLATES (and require selectable) before rendering.';
COMMENT ON COLUMN public.notification_sequence_steps.cc_recipients IS
  'Ordered escalation list for this step, empty by default and always empty for the digest: [{"kind":"user","user_id":uuid} | {"kind":"role","role":"admin"|"specialist"|"billing"}]. Users must be org members when saved. A cc''d copy never carries SSN, date of birth or document contents.';

COMMENT ON TABLE public.sms_consents IS
  'MINT-107: a provider''s recorded agreement to receive texts at one number: when, how (source), which consent text version, and revocation. Evidence: the only allowed update stamps revoked_at + revoked_source once; no DELETE grant. Members read; only service_role writes (the intake form, later). staff_recorded rows name recorded_by.';
COMMENT ON COLUMN public.sms_consents.phone_e164 IS 'The consented number in E.164 form, e.g. +15555550123.';
COMMENT ON COLUMN public.sms_consents.consent_text_version IS
  'The version id of the exact consent wording the provider agreed to.';
COMMENT ON COLUMN public.sms_consents.source IS
  'How consent was given: intake_form, staff_recorded (paper or verbal, with recorded_by), or sms_keyword (a START reply).';

COMMENT ON FUNCTION public.save_notification_sequence(uuid, text, jsonb) IS
  'MINT-107: admin-only, SECURITY INVOKER. Creates or replaces one purpose''s org sequence and its own steps in one transaction (steps null = use Minted''s default steps; a null setting = use Minted''s default), checks expected_revision (PT409, HTTP 409, notification_sequence_conflict when stale), and writes one audit_log row. Refuses the platform-managed settings (42501 notification_platform_setting) and any unknown key. Returns {sequence, steps}. Never call it with the service key.';

NOTIFY pgrst, 'reload schema';

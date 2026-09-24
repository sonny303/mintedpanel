-- AUTHOR-ONLY staging alignment packet; never run against production.
-- Slice 5 aligns the people/contact role model on a qualified staging target.
-- Required session settings are external so the identity guard cannot self-pass:
--   SET minted.release_target_kind = 'hosted_staging';
--   SET minted.release_project_ref = 'vmznysvietfaddakkegt';
--   SET minted.release_source_sha = 'ae7aff60cac28ee9e2ac5a7a30a8bb7bce6c5c3b';
-- A local adapter may use qualified_local_restore only after independently
-- checking current_database=minted_recovery, the exact qualified receipt and
-- its pg_control_system identifier, then setting restore_* session values.
-- This packet is additive/reconciliation SQL, not a migration-ledger write.

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtextextended('mintedpanel:staging-alignment:slice-5', 0));

DO $guard$
DECLARE
  target_kind text := current_setting('minted.release_target_kind', true);
  actual_system_identifier bigint;
BEGIN
  IF target_kind = 'hosted_staging' THEN
    IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'ALIGNMENT_HOSTED_DATABASE_REJECTED'; END IF;
    BEGIN
      SELECT system_identifier INTO actual_system_identifier
      FROM pg_catalog.pg_control_system();
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'ALIGNMENT_HOSTED_SYSTEM_ID_UNAVAILABLE';
    END;
    IF actual_system_identifier IS DISTINCT FROM 7662742571317219726::bigint THEN
      RAISE EXCEPTION 'ALIGNMENT_HOSTED_SYSTEM_ID_REJECTED';
    END IF;
  ELSIF target_kind = 'qualified_local_restore' THEN
    IF current_database() <> 'minted_recovery'
       OR current_setting('minted.restore_status', true) IS DISTINCT FROM 'LOCAL_APPLICATION_BASELINE_VERIFIED'
       OR current_setting('minted.restore_receipt_id', true) IS NULL
       OR current_setting('minted.restore_receipt_id', true) !~ '^[a-f0-9]{16}$'
       OR current_setting('minted.restore_capture_digest', true) IS DISTINCT FROM '9cd07f296ce4eab010bfa1391094c02e7299e4edc8872965e0e08b9eefb8e0de'
       OR current_setting('minted.restore_system_identifier', true) IS DISTINCT FROM '7689139001490436135'
       OR current_setting('minted.restore_system_identifier', true) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'ALIGNMENT_LOCAL_RECEIPT_REJECTED';
    END IF;
    BEGIN
      SELECT system_identifier INTO actual_system_identifier
      FROM pg_catalog.pg_control_system();
    EXCEPTION
      WHEN undefined_function OR insufficient_privilege THEN
        RAISE EXCEPTION 'ALIGNMENT_LOCAL_SYSTEM_ID_UNAVAILABLE';
    END;
    IF actual_system_identifier IS DISTINCT FROM current_setting('minted.restore_system_identifier')::bigint THEN
      RAISE EXCEPTION 'ALIGNMENT_LOCAL_SYSTEM_ID_REJECTED';
    END IF;
  ELSE
    RAISE EXCEPTION 'ALIGNMENT_TARGET_KIND_REJECTED';
  END IF;

  IF current_setting('minted.release_project_ref', true) IS DISTINCT FROM 'vmznysvietfaddakkegt'
     OR current_setting('minted.release_source_sha', true) IS DISTINCT FROM 'ae7aff60cac28ee9e2ac5a7a30a8bb7bce6c5c3b' THEN
    RAISE EXCEPTION 'ALIGNMENT_IDENTITY_REJECTED';
  END IF;
  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'ALIGNMENT_READ_ONLY_SESSION';
  END IF;
  IF to_regclass('public.portal_field_maps_aetna_backup_20260904') IS NOT NULL
     OR to_regclass('public.portal_field_maps_aetna_direct_backup_20260812') IS NOT NULL
     OR to_regclass('public.portals_aetna_backup_20260904') IS NOT NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_OPERATOR_BACKUP_PRESENT';
  END IF;
END
$guard$;

DO $prestate$
BEGIN
  IF (SELECT count(*) FROM public.parties) <> 17 THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_PARTY_COUNT_DRIFT';
  END IF;
  IF (SELECT count(*) FROM public.party_role_types
      WHERE role_key IN ('billing_contact','contracting_signer','credentialing_contact')) <> 3 THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_ROLE_TYPE_DRIFT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'parties'
       AND column_name IN ('org_id','first_name','last_name','title','fax','phone_extension')
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'party_role_assignments'
       AND column_name = 'is_default'
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_SLICE_ALREADY_APPLIED_OR_PARTIAL';
  END IF;
  IF to_regclass('pg_temp.minted_alignment_party_guard') IS NOT NULL
     OR to_regclass('pg_temp.minted_alignment_assignment_guard') IS NOT NULL
     OR to_regclass('pg_temp.minted_alignment_capture_link_guard') IS NOT NULL
     OR to_regclass('pg_temp.minted_alignment_audit_guard') IS NOT NULL
     OR to_regclass('pg_temp.minted_alignment_role_type_guard') IS NOT NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_GUARD_ALREADY_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.party_role_assignments a
     WHERE a.org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_PRESTATE_NULL_ORG';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.party_capture_links l
     WHERE l.state = 'active'
       AND NOT EXISTS (
         SELECT 1
           FROM public.party_role_assignments a
          WHERE a.party_id = l.party_id
            AND a.org_id = l.org_id
       )
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_ACTIVE_CAPTURE_LINK_ORG_UNRESOLVED';
  END IF;
  IF to_regprocedure('public.insert_contact_party(jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_LEGACY_HELPER_SIGNATURE_MISSING';
  END IF;
END
$prestate$;

-- Hash every preserved row by primary key. The allowed changes are removed from
-- party, assignment, and role-type digests; capture links and audit rows are
-- byte-for-byte row guarded.
CREATE TEMP TABLE pg_temp.minted_alignment_party_guard ON COMMIT PRESERVE ROWS AS
SELECT p.id,
       md5((to_jsonb(p) - ARRAY[
         'org_id','first_name','last_name','title','fax','phone_extension'
       ])::text) AS row_digest
  FROM public.parties p;

CREATE TEMP TABLE pg_temp.minted_alignment_assignment_guard ON COMMIT PRESERVE ROWS AS
SELECT a.id,
       md5((to_jsonb(a) - ARRAY['is_default'])::text) AS row_digest
  FROM public.party_role_assignments a;

CREATE TEMP TABLE pg_temp.minted_alignment_capture_link_guard ON COMMIT PRESERVE ROWS AS
SELECT l.id, md5(to_jsonb(l)::text) AS row_digest
  FROM public.party_capture_links l;

CREATE TEMP TABLE pg_temp.minted_alignment_audit_guard ON COMMIT PRESERVE ROWS AS
SELECT a.id, md5(to_jsonb(a)::text) AS row_digest
  FROM public.audit_log a;

CREATE TEMP TABLE pg_temp.minted_alignment_role_type_guard ON COMMIT PRESERVE ROWS AS
SELECT t.role_key,
       md5((to_jsonb(t) - ARRAY['label','is_active'])::text) AS row_digest
  FROM public.party_role_types t;

-- People contact roles + contact tokens — the schema half.
--
-- Decision record: docs/redesign/DECISION-RECORD-2026-08-07-people-contact-roles.md
-- (PM decisions D1–D14, 2026-08-07). Activates the three reserved party roles
-- and gives contacts the shape a payer form actually asks for.
--
-- Everything here is additive DDL (new columns / new constraints). No column is
-- renamed, restructured, or dropped.
--
-- What lands:
--   D1  party_role_assignments.is_default + ONE default per (org, role)
--   D2  scope_type CHECK widened with 'group' (schema only — the UI still
--       writes 'org'; the grain is prepared now because retrofitting it after
--       the tokens are a live wire contract means re-resolving every mapping)
--   D3  parties.title            D7  parties.fax / phone_extension
--   D6  parties.first_name / last_name (backfilled by last-space split)
--   D8  parties.org_id NOT NULL + RLS rewritten onto membership (retires the
--       cross-org reuse pool F0.3.4 and the created_by visibility disjunct)
--   --  party_role_types.is_active = true for the three reserved roles
--
-- APPLY ORDER MATTERS: the companion 20260807130100_people_contact_role_rpcs.sql
-- reissues every SECURITY DEFINER function that writes `parties` so it carries
-- org_id. Between this file and that one, org intake and capture-link issuing
-- would 23502 on the new NOT NULL — apply the pair together.

-- ---------------------------------------------------------------------------
-- 0. Name-split helpers. Mirrored in TS by src/lib/personName.ts splitFullName
--    — keep the two in lockstep (the same last-space rule).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._party_first_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_name, '')) = '' THEN ''
    WHEN position(' ' IN btrim(p_name)) = 0 THEN btrim(p_name)
    ELSE btrim(regexp_replace(btrim(p_name), '\s+\S+$', ''))
  END;
$$;

CREATE OR REPLACE FUNCTION public._party_last_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_name, '')) = '' THEN ''
    WHEN position(' ' IN btrim(p_name)) = 0 THEN ''
    ELSE btrim(substring(btrim(p_name) FROM '\S+$'))
  END;
$$;

REVOKE ALL ON FUNCTION public._party_first_name(text) FROM public;
REVOKE ALL ON FUNCTION public._party_last_name(text) FROM public;

-- ---------------------------------------------------------------------------
-- 1. parties — new columns (D3, D6, D7, D8).
-- ---------------------------------------------------------------------------
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS phone_extension text;

-- D6 backfill: split the existing single name column. `name` is RETAINED as the
-- display value (never dropped) and stays the value every legacy reader sees.
UPDATE public.parties
   SET first_name = nullif(public._party_first_name(name), ''),
       last_name  = nullif(public._party_last_name(name), '')
 WHERE first_name IS NULL AND last_name IS NULL;

-- Bounded staging backfill: assignment evidence is mandatory. The
-- creator-membership fallback and historical orphan cleanup are intentionally
-- excluded; an unresolved row aborts the transaction.
DO $party_org_preflight$
DECLARE
  v_unresolved bigint;
  v_multi_org bigint;
BEGIN
  SELECT count(*)
    INTO v_unresolved
    FROM public.parties p
   WHERE NOT EXISTS (
     SELECT 1 FROM public.party_role_assignments a WHERE a.party_id = p.id
   );

  SELECT count(*)
    INTO v_multi_org
    FROM (
      SELECT p.id
        FROM public.parties p
        JOIN public.party_role_assignments a ON a.party_id = p.id
       GROUP BY p.id
      HAVING count(DISTINCT a.org_id) <> 1
    ) q;

  IF v_unresolved <> 0 THEN
    RAISE EXCEPTION 'ALIGNMENT_PARTY_WITHOUT_ASSIGNMENT: %', v_unresolved;
  END IF;
  IF v_multi_org <> 0 THEN
    RAISE EXCEPTION 'ALIGNMENT_PARTY_MULTI_ORG_ASSIGNMENT: %', v_multi_org;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.party_role_assignments a
     WHERE a.org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_ASSIGNMENT_ORG_NULL';
  END IF;
END
$party_org_preflight$;

UPDATE public.parties p
   SET org_id = resolved.org_id
  FROM (
    SELECT a.party_id, min(a.org_id::text)::uuid AS org_id
      FROM public.party_role_assignments a
     GROUP BY a.party_id
     HAVING count(DISTINCT a.org_id) = 1
  ) resolved
 WHERE p.id = resolved.party_id
   AND p.org_id IS NULL;

DO $party_org_postbackfill$
BEGIN
  IF EXISTS (SELECT 1 FROM public.parties WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'ALIGNMENT_PARTY_ORG_UNRESOLVED';
  END IF;
END
$party_org_postbackfill$;

ALTER TABLE public.parties ALTER COLUMN org_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parties_org_id_fkey'
  ) THEN
    ALTER TABLE public.parties
      ADD CONSTRAINT parties_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS parties_org_id_idx ON public.parties (org_id);

-- ---------------------------------------------------------------------------
-- 2. parties RLS — rewritten onto membership (D8).
--
-- Supersedes the E0.1 shape (`created_by = auth.uid() OR assigned in one of my
-- orgs`), which is exactly what let one party row span orgs. A party now belongs
-- to precisely one org and is visible to that org's members; writers in that org
-- may write it. created_by is RETAINED as provenance — it is simply no longer a
-- visibility grant.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS parties_select ON public.parties;
CREATE POLICY parties_select ON public.parties
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

DROP POLICY IF EXISTS parties_insert ON public.parties;
CREATE POLICY parties_insert ON public.parties
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
  );

DROP POLICY IF EXISTS parties_update ON public.parties;
CREATE POLICY parties_update ON public.parties
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
  );

DROP POLICY IF EXISTS parties_delete ON public.parties;
CREATE POLICY parties_delete ON public.parties
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
  );

-- ---------------------------------------------------------------------------
-- 3. party_role_assignments — is_default (D1) + the 'group' grain (D2).
-- ---------------------------------------------------------------------------
ALTER TABLE public.party_role_assignments
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

DO $default_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.party_role_assignments
     WHERE is_default
     GROUP BY org_id, role_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_MULTIPLE_DEFAULTS';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.party_role_assignments a
      JOIN public.parties p ON p.id = a.party_id
     WHERE p.org_id IS DISTINCT FROM a.org_id
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_CROSS_ORG_PRESTATE';
  END IF;
END
$default_preflight$;

-- Backfill: the earliest assignment per (org, role) becomes that role's default,
-- so every existing role already resolves a token holder.
UPDATE public.party_role_assignments a
   SET is_default = true
  FROM (
    SELECT DISTINCT ON (org_id, role_key) id
      FROM public.party_role_assignments
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.party_role_assignments existing
        WHERE existing.org_id = party_role_assignments.org_id
          AND existing.role_key = party_role_assignments.role_key
          AND existing.is_default
     )
     ORDER BY org_id, role_key, created_at, id
  ) d
 WHERE d.id = a.id
   AND a.is_default = false
   AND NOT EXISTS (
     SELECT 1
       FROM public.party_role_assignments existing
      WHERE existing.org_id = a.org_id
        AND existing.role_key = a.role_key
        AND existing.is_default
   );

-- ONE default holder per (org, role) — the resolution target for the contact
-- token families. Mirrors uq_payer_contacts_default_purpose.
CREATE UNIQUE INDEX IF NOT EXISTS uq_party_role_assignments_default
  ON public.party_role_assignments (org_id, role_key)
  WHERE is_default;

-- D2: prepare the group grain. Additive widening of an existing CHECK — the
-- old domain stays valid, so every existing row and writer is unaffected.
ALTER TABLE public.party_role_assignments
  DROP CONSTRAINT IF EXISTS party_role_assignments_scope_type_check;
ALTER TABLE public.party_role_assignments
  ADD CONSTRAINT party_role_assignments_scope_type_check
  CHECK (scope_type IN ('org', 'group', 'facility', 'case'));

-- ---------------------------------------------------------------------------
-- 4. Activate the three reserved roles. The reject_inactive_role_assignment
--    trigger is what has been blocking them; this flips the governed rows it
--    reads. Labels match the E0.8/2026-07-21 terminology already in use.
-- ---------------------------------------------------------------------------
UPDATE public.party_role_types
   SET is_active = true
 WHERE role_key IN ('billing_contact', 'contracting_signer', 'credentialing_contact');

UPDATE public.party_role_types
   SET label = 'Authorized contact'
 WHERE role_key = 'owner';

UPDATE public.party_role_types
   SET label = 'Organization contact'
 WHERE role_key = 'customer_escalation_contact';
-- People contact roles + contact tokens — the FUNCTION half.
--
-- Companion to 20260807130000_people_contact_roles.sql (same decision record:
-- docs/redesign/DECISION-RECORD-2026-08-07-people-contact-roles.md). Split out
-- so the schema change and the function reissues apply as separate, individually
-- reviewable units.
--
-- Four SECURITY DEFINER functions insert or update `parties`. After the schema
-- half makes parties.org_id NOT NULL, every one of them would 23502 on the next
-- org intake or capture-link issue, so all four are reissued here to carry
-- org_id and the new name/contact columns.
-- 5. insert_contact_party — 3-arg overload carrying org_id + the new fields.
--    The 2-arg form is RETAINED (additive rule) but has no caller after this
--    migration; it cannot satisfy the NOT NULL and must not be used again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_contact_party(p jsonb, p_uid uuid, p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_name text := btrim(p->>'name');
BEGIN
  INSERT INTO public.parties (
    org_id, party_type, name, first_name, last_name, title,
    email, phone_office, phone_extension, phone_mobile, fax,
    address_line1, address_line2, city, state, postal_code, country, created_by
  ) VALUES (
    p_org_id,
    'person',
    v_name,
    coalesce(nullif(btrim(coalesce(p->>'first_name', '')), ''),
             nullif(public._party_first_name(v_name), '')),
    coalesce(nullif(btrim(coalesce(p->>'last_name', '')), ''),
             nullif(public._party_last_name(v_name), '')),
    nullif(btrim(coalesce(p->>'title', '')), ''),
    btrim(p->>'email'),
    nullif(btrim(coalesce(p->>'phone_office', '')), ''),
    nullif(btrim(coalesce(p->>'phone_extension', '')), ''),
    nullif(btrim(coalesce(p->>'phone_mobile', '')), ''),
    nullif(btrim(coalesce(p->>'fax', '')), ''),
    nullif(btrim(coalesce(p->>'address_line1', '')), ''),
    nullif(btrim(coalesce(p->>'address_line2', '')), ''),
    nullif(btrim(coalesce(p->>'city', '')), ''),
    nullif(btrim(coalesce(p->>'state', '')), ''),
    nullif(btrim(coalesce(p->>'postal_code', '')), ''),
    nullif(btrim(coalesce(p->>'country', '')), ''),
    p_uid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_contact_party(jsonb, uuid, uuid) FROM public;

-- ---------------------------------------------------------------------------
-- 6. create_organization 5-arg — reissued so both intake parties carry org_id +
--    split names, and the owner/customer assignments are marked default.
--    Signature unchanged; the 2026-08-07 no-default-sales-rep behavior is
--    preserved exactly (NULL / JSON null / {} ⇒ no party, no assignment).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_owner_name text,
  p_owner_email text,
  p_customer jsonb,
  p_sales_rep jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_party_id uuid;
  v_name text := btrim(p_name);
  v_owner_name text := btrim(p_owner_name);
  v_owner_email text := btrim(p_owner_email);
  v_norm text;
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_sales jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF v_owner_name = '' THEN
    RAISE EXCEPTION 'Owner name is required';
  END IF;
  IF v_owner_email = '' THEN
    RAISE EXCEPTION 'Owner email is required';
  END IF;
  IF v_owner_email !~ v_email_re THEN
    RAISE EXCEPTION 'Owner email is not valid';
  END IF;

  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'Customer contact is required';
  END IF;
  PERFORM public.assert_contact_valid(p_customer, 'Customer contact');

  -- Sales rep stays genuinely optional (hotfix 20260807120000): NULL, JSON null
  -- and {} all mean "no sales rep", and no placeholder identity is substituted.
  v_sales := NULL;
  IF p_sales_rep IS NOT NULL
     AND jsonb_typeof(p_sales_rep) = 'object'
     AND p_sales_rep <> '{}'::jsonb THEN
    v_sales := p_sales_rep;
    PERFORM public.assert_contact_valid(v_sales, 'Sales rep');
  END IF;

  v_norm := lower(regexp_replace(v_name, '\s+', '', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'An organization named "%" already exists. Please use a different name.', v_name;
  END IF;

  INSERT INTO public.organizations (name, lifecycle_state)
    VALUES (v_name, 'prospect')
    RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

  INSERT INTO public.status_configs (org_id, track, label, color, sort_order, action_bucket) VALUES
    (v_org_id, 'credentialing', 'Not Started',          '#9CA3AF',  5, 'ours'),
    (v_org_id, 'credentialing', 'In-Network',           '#059669', 10, 'complete'),
    (v_org_id, 'credentialing', 'OON',                  '#DC2626', 20, 'complete'),
    (v_org_id, 'credentialing', 'In Progress',          '#2563EB', 30, 'ours'),
    (v_org_id, 'credentialing', 'Waiting on Provider',  '#D97706', 31, 'waiting_provider'),
    (v_org_id, 'credentialing', 'Submitted',            '#0891B2', 32, 'waiting_payer'),
    (v_org_id, 'credentialing', 'Approved',             '#059669', 35, 'complete'),
    (v_org_id, 'credentialing', 'Denied',               '#DC2626', 40, 'ours'),
    (v_org_id, 'credentialing', 'Not Required',         '#9CA3AF', 45, 'complete'),
    (v_org_id, 'contracting',   'Not Started',          '#9CA3AF', 10, 'ours'),
    (v_org_id, 'contracting',   'In Progress',          '#2563EB', 20, 'ours'),
    (v_org_id, 'contracting',   'Denied',               '#DC2626', 30, 'ours'),
    (v_org_id, 'contracting',   'Contracted',           '#0891B2', 40, 'waiting_payer'),
    (v_org_id, 'contracting',   'In-Network',           '#059669', 50, 'complete'),
    (v_org_id, 'contracting',   'OON',                  '#DC2626', 60, 'complete'),
    (v_org_id, 'location',      'Prospect',             '#9CA3AF', 10, 'ours'),
    (v_org_id, 'location',      'Planned',              '#2563EB', 20, 'ours'),
    (v_org_id, 'location',      'Interviewing',         '#0891B2', 30, 'ours'),
    (v_org_id, 'location',      'Pending Fulfillment',  '#D97706', 40, 'ours'),
    (v_org_id, 'location',      'Ready for Launch',     '#059669', 50, 'ours'),
    (v_org_id, 'location',      'Live',                 '#059669', 60, 'complete'),
    (v_org_id, 'location',      'Inactive',             '#9CA3AF', 70, 'complete');

  -- Owner / authorized contact (name + email only, E0.1).
  INSERT INTO public.parties (org_id, party_type, name, first_name, last_name, email, created_by)
    VALUES (v_org_id, 'person', v_owner_name,
            nullif(public._party_first_name(v_owner_name), ''),
            nullif(public._party_last_name(v_owner_name), ''),
            v_owner_email, v_uid)
    RETURNING id INTO v_party_id;
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'owner', 'org', true);

  -- Organization contact.
  v_party_id := public.insert_contact_party(p_customer, v_uid, v_org_id);
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'customer_escalation_contact', 'org', true);

  IF v_sales IS NOT NULL THEN
    v_party_id := public.insert_contact_party(v_sales, v_uid, v_org_id);
    INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
      VALUES (v_org_id, v_party_id, 'sales_rep', 'org', true);
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. create_organization 3-arg — reissued for the same NOT NULL reason. It has
--    no app caller (the 5-arg is the live intake path) but must not be left
--    able to 23502.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_owner_name text,
  p_owner_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_party_id uuid;
  v_name text := btrim(p_name);
  v_owner_name text := btrim(p_owner_name);
  v_owner_email text := btrim(p_owner_email);
  v_norm text;
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Organization name is required'; END IF;
  IF v_owner_name = '' THEN RAISE EXCEPTION 'Owner name is required'; END IF;
  IF v_owner_email = '' THEN RAISE EXCEPTION 'Owner email is required'; END IF;
  IF v_owner_email !~ v_email_re THEN RAISE EXCEPTION 'Owner email is not valid'; END IF;

  v_norm := lower(regexp_replace(v_name, '\s+', '', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'An organization named "%" already exists. Please use a different name.', v_name;
  END IF;

  INSERT INTO public.organizations (name, lifecycle_state)
    VALUES (v_name, 'prospect')
    RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

  INSERT INTO public.status_configs (org_id, track, label, color, sort_order, action_bucket) VALUES
    (v_org_id, 'credentialing', 'Not Started',          '#9CA3AF',  5, 'ours'),
    (v_org_id, 'credentialing', 'In-Network',           '#059669', 10, 'complete'),
    (v_org_id, 'credentialing', 'OON',                  '#DC2626', 20, 'complete'),
    (v_org_id, 'credentialing', 'In Progress',          '#2563EB', 30, 'ours'),
    (v_org_id, 'credentialing', 'Waiting on Provider',  '#D97706', 31, 'waiting_provider'),
    (v_org_id, 'credentialing', 'Submitted',            '#0891B2', 32, 'waiting_payer'),
    (v_org_id, 'credentialing', 'Approved',             '#059669', 35, 'complete'),
    (v_org_id, 'credentialing', 'Denied',               '#DC2626', 40, 'ours'),
    (v_org_id, 'credentialing', 'Not Required',         '#9CA3AF', 45, 'complete'),
    (v_org_id, 'contracting',   'Not Started',          '#9CA3AF', 10, 'ours'),
    (v_org_id, 'contracting',   'In Progress',          '#2563EB', 20, 'ours'),
    (v_org_id, 'contracting',   'Denied',               '#DC2626', 30, 'ours'),
    (v_org_id, 'contracting',   'Contracted',           '#0891B2', 40, 'waiting_payer'),
    (v_org_id, 'contracting',   'In-Network',           '#059669', 50, 'complete'),
    (v_org_id, 'contracting',   'OON',                  '#DC2626', 60, 'complete'),
    (v_org_id, 'location',      'Prospect',             '#9CA3AF', 10, 'ours'),
    (v_org_id, 'location',      'Planned',              '#2563EB', 20, 'ours'),
    (v_org_id, 'location',      'Interviewing',         '#0891B2', 30, 'ours'),
    (v_org_id, 'location',      'Pending Fulfillment',  '#D97706', 40, 'ours'),
    (v_org_id, 'location',      'Ready for Launch',     '#059669', 50, 'ours'),
    (v_org_id, 'location',      'Live',                 '#059669', 60, 'complete'),
    (v_org_id, 'location',      'Inactive',             '#9CA3AF', 70, 'complete');

  INSERT INTO public.parties (org_id, party_type, name, first_name, last_name, email, created_by)
    VALUES (v_org_id, 'person', v_owner_name,
            nullif(public._party_first_name(v_owner_name), ''),
            nullif(public._party_last_name(v_owner_name), ''),
            v_owner_email, v_uid)
    RETURNING id INTO v_party_id;
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'owner', 'org', true);

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. create_capture_link — the ad-hoc recipient party now carries org_id, and
--    the existing-party check is ORG-SCOPED (was `created_by = me OR assigned
--    here`, the other half of the cross-org identity problem).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_capture_link(
  p_org_id uuid,
  p_party_id uuid,
  p_recipient_email text,
  p_recipient_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_party_id uuid;
  v_recipient_name text;
  v_org_name text;
  v_token text;
  v_hash text;
  v_link_id uuid;
  v_expires timestamptz := now() + interval '7 days';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = p_org_id AND m.user_id = v_uid
      AND m.role = ANY (ARRAY['specialist'::text, 'admin'::text])
  ) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'Recipient email is required';
  END IF;
  IF v_email !~ v_email_re THEN
    RAISE EXCEPTION 'Recipient email is not valid';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = p_org_id;

  IF p_party_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.parties p WHERE p.id = p_party_id AND p.org_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'Recipient party not found for this organization';
    END IF;
    v_party_id := p_party_id;
    SELECT name INTO v_recipient_name FROM public.parties WHERE id = v_party_id;
  ELSE
    v_recipient_name := coalesce(nullif(btrim(coalesce(p_recipient_name, '')), ''), v_email);
    INSERT INTO public.parties (
      org_id, party_type, name, first_name, last_name, email, created_by
    )
    VALUES (
      p_org_id, 'person', v_recipient_name,
      nullif(public._party_first_name(v_recipient_name), ''),
      nullif(public._party_last_name(v_recipient_name), ''),
      v_email, v_uid
    )
    RETURNING id INTO v_party_id;
  END IF;

  UPDATE public.party_capture_links
    SET state = 'revoked'
    WHERE org_id = p_org_id AND state = 'active';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  INSERT INTO public.party_capture_links (
    org_id, party_id, token_hash, recipient_email, state, expires_at, created_by
  )
  VALUES (p_org_id, v_party_id, v_hash, v_email, 'active', v_expires, v_uid)
  RETURNING id INTO v_link_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (p_org_id, v_uid, 'CREATE', 'party_capture_link', v_link_id,
            'Issued one-time data capture link');

  RETURN jsonb_build_object(
    'token', v_token,
    'link_id', v_link_id,
    'party_id', v_party_id,
    'recipient_name', v_recipient_name,
    'recipient_email', v_email,
    'org_name', v_org_name,
    'expires_at', v_expires
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. submit_capture — persists first/last/title/fax/extension so a captured
--    contact resolves the token families. Without this the capture form would
--    collect split names and silently drop them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_capture(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
  v_name text;
BEGIN
  IF NOT public.check_rpc_throttle('submit_capture', 20, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link
    FROM public.party_capture_links
   WHERE token_hash = v_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  -- Lock the party row before marking the token valid or inspecting state.
  -- D8 makes org_id immutable; the lock closes the delete/change race.
  PERFORM 1
    FROM public.parties p
   WHERE p.id = v_link.party_id
     AND p.org_id = v_link.org_id
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('submit_capture');

  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links
       SET state = 'expired'
     WHERE id = v_link.id
       AND org_id = v_link.org_id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  PERFORM public.assert_contact_valid(p_payload, 'This form');
  v_name := btrim(p_payload->>'name');

  UPDATE public.parties SET
    name = v_name,
    first_name = coalesce(nullif(btrim(coalesce(p_payload->>'first_name', '')), ''),
                          nullif(public._party_first_name(v_name), '')),
    last_name = coalesce(nullif(btrim(coalesce(p_payload->>'last_name', '')), ''),
                         nullif(public._party_last_name(v_name), '')),
    title = nullif(btrim(coalesce(p_payload->>'title', '')), ''),
    email = btrim(p_payload->>'email'),
    phone_office = nullif(btrim(coalesce(p_payload->>'phone_office', '')), ''),
    phone_extension = nullif(btrim(coalesce(p_payload->>'phone_extension', '')), ''),
    phone_mobile = nullif(btrim(coalesce(p_payload->>'phone_mobile', '')), ''),
    fax = nullif(btrim(coalesce(p_payload->>'fax', '')), ''),
    address_line1 = nullif(btrim(coalesce(p_payload->>'address_line1', '')), ''),
    address_line2 = nullif(btrim(coalesce(p_payload->>'address_line2', '')), ''),
    city = nullif(btrim(coalesce(p_payload->>'city', '')), ''),
    state = nullif(btrim(coalesce(p_payload->>'state', '')), ''),
    postal_code = nullif(btrim(coalesce(p_payload->>'postal_code', '')), ''),
    country = nullif(btrim(coalesce(p_payload->>'country', '')), '')
  WHERE id = v_link.party_id
    AND org_id = v_link.org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  UPDATE public.party_capture_links
     SET state = 'used', used_at = now()
   WHERE id = v_link.id
     AND org_id = v_link.org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'UPDATE', 'party', v_link.party_id,
            'Party data captured via one-time link');

  RETURN jsonb_build_object('ok', true, 'state', 'used');
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. validate_capture_token — `current` gains the new fields so the public
--     form prefills them (additive keys; every existing key is unchanged).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_capture_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
  v_state text;
  v_org_name text;
  v_party public.parties%ROWTYPE;
BEGIN
  IF NOT public.check_rpc_throttle('validate_capture_token', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link
    FROM public.party_capture_links
   WHERE token_hash = v_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM 1
    FROM public.parties p
   WHERE p.id = v_link.party_id
     AND p.org_id = v_link.org_id
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('validate_capture_token');

  v_state := v_link.state;
  IF v_state = 'active' AND v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links
       SET state = 'expired'
     WHERE id = v_link.id
       AND org_id = v_link.org_id;
    v_state := 'expired';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT * INTO v_party FROM public.parties WHERE id = v_link.party_id AND org_id = v_link.org_id;

  IF v_state <> 'active' THEN
    RETURN jsonb_build_object(
      'state', v_state,
      'org_name', v_org_name,
      'recipient_name', v_party.name
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'active',
    'org_name', v_org_name,
    'recipient_name', v_party.name,
    'recipient_email', v_link.recipient_email,
    'expires_at', v_link.expires_at,
    'required_fields', jsonb_build_array(
      'name', 'email', 'phone_office', 'address_line1', 'city', 'state', 'postal_code'),
    'current', jsonb_build_object(
      'name', v_party.name,
      'first_name', v_party.first_name,
      'last_name', v_party.last_name,
      'title', v_party.title,
      'email', v_party.email,
      'phone_office', v_party.phone_office,
      'phone_extension', v_party.phone_extension,
      'phone_mobile', v_party.phone_mobile,
      'fax', v_party.fax,
      'address_line1', v_party.address_line1,
      'address_line2', v_party.address_line2,
      'city', v_party.city,
      'state', v_party.state,
      'postal_code', v_party.postal_code,
      'country', v_party.country
    )
  );
END;
$$;
-- Follow-up hardening for D8. The hosted project already has the two
-- 2026080713* people/contact migrations, so this migration closes the tenant
-- gap without rewriting applied history.

-- Refuse to hide legacy cross-org links. A rebuild or hosted apply with a
-- mismatch must stop with a count before constraints or policies are changed.
DO $$
DECLARE
  v_mismatch_count bigint;
BEGIN
  SELECT count(*)
    INTO v_mismatch_count
    FROM public.party_role_assignments pra
    JOIN public.parties p ON p.id = pra.party_id
   WHERE p.org_id IS DISTINCT FROM pra.org_id;

  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'party_role_tenant_mismatch: % assignment(s) link a party from another organization',
      v_mismatch_count;
  END IF;
END;
$$;

-- A composite FK makes same-org identity structural, including for service-role
-- writes that bypass RLS. Keep (org_id, id) unique so it is a valid FK target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_org_id_id
  ON public.parties (org_id, id);

ALTER TABLE public.party_role_assignments
  DROP CONSTRAINT IF EXISTS party_role_assignments_party_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.party_role_assignments'::regclass
       AND conname = 'party_role_assignments_org_party_fkey'
  ) THEN
    ALTER TABLE public.party_role_assignments
      ADD CONSTRAINT party_role_assignments_org_party_fkey
      FOREIGN KEY (org_id, party_id)
      REFERENCES public.parties (org_id, id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

-- D8 makes a party's organization part of its identity. RLS cannot compare OLD
-- and NEW, so a trigger enforces immutability for every database role.
CREATE OR REPLACE FUNCTION public.reject_party_org_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'party_org_id_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parties_org_id_immutable ON public.parties;
CREATE TRIGGER parties_org_id_immutable
  BEFORE UPDATE OF org_id ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.reject_party_org_change();

REVOKE ALL ON FUNCTION public.reject_party_org_change() FROM public, anon, authenticated;

-- Keep the tenant join visible in the browser-write policies as defense in
-- depth. The composite FK remains the final authority for every database role.
DROP POLICY IF EXISTS pra_insert_writer ON public.party_role_assignments;
CREATE POLICY pra_insert_writer ON public.party_role_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
    AND EXISTS (
      SELECT 1
        FROM public.parties p
       WHERE p.id = party_role_assignments.party_id
         AND p.org_id = party_role_assignments.org_id
    )
  );

DROP POLICY IF EXISTS pra_update_writer ON public.party_role_assignments;
CREATE POLICY pra_update_writer ON public.party_role_assignments
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids() AS user_org_ids)
    AND user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
    AND EXISTS (
      SELECT 1
        FROM public.parties p
       WHERE p.id = party_role_assignments.party_id
         AND p.org_id = party_role_assignments.org_id
    )
  );

-- One Postgres function call is one transaction. Validate and lock the target
-- before demoting the old default so any error preserves the prior default.
CREATE OR REPLACE FUNCTION public.set_default_party_role(
  p_org_id uuid,
  p_party_id uuid,
  p_role_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF public.user_role(p_org_id) IS NULL
     OR public.user_role(p_org_id) NOT IN ('specialist', 'admin') THEN
    RAISE EXCEPTION 'party_role_default_not_authorized';
  END IF;

  -- Serialize promotions for this organization/role pair. The target row lock
  -- then protects the assignment from concurrent update/delete.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_org_id::text || ':' || p_role_key, 0)
  );

  SELECT id
    INTO v_target_id
    FROM public.party_role_assignments
   WHERE org_id = p_org_id
     AND party_id = p_party_id
     AND role_key = p_role_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'party_role_default_assignment_not_found';
  END IF;

  UPDATE public.party_role_assignments
     SET is_default = false
   WHERE org_id = p_org_id
     AND role_key = p_role_key
     AND is_default
     AND id <> v_target_id;

  UPDATE public.party_role_assignments
     SET is_default = true
   WHERE id = v_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'party_role_default_assignment_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_party_role(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_default_party_role(uuid, uuid, text) TO authenticated;

DO $poststate$
DECLARE
  v_bad bigint;
BEGIN
  IF (SELECT count(*) FROM public.parties) <> 17 THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_PARTY_COUNT_POSTSTATE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.parties WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_PARTY_ORG_NULL_POSTSTATE';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.parties p
      WHERE NOT EXISTS (
        SELECT 1 FROM public.party_role_assignments a WHERE a.party_id = p.id
      )
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_PARTY_ASSIGNMENT_LOST';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.parties p
      JOIN public.party_role_assignments a ON a.party_id = p.id
     GROUP BY p.id
    HAVING count(DISTINCT a.org_id) <> 1
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_PARTY_ORG_RESOLUTION_CHANGED';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.party_role_assignments a
      JOIN public.parties p ON p.id = a.party_id
     WHERE a.org_id IS DISTINCT FROM p.org_id
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_CROSS_ORG_POSTSTATE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.party_capture_links l
    JOIN public.parties p ON p.id = l.party_id
    WHERE l.state = 'active'
      AND l.org_id IS DISTINCT FROM p.org_id
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_CAPTURE_LINK_CROSS_ORG';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.party_capture_links l
     WHERE l.state = 'active'
       AND NOT EXISTS (
         SELECT 1
           FROM public.parties p
           JOIN public.party_role_assignments a
             ON a.party_id = p.id
            AND a.org_id = p.org_id
          WHERE p.id = l.party_id
            AND p.org_id = l.org_id
            AND a.org_id = l.org_id
       )
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_ACTIVE_CAPTURE_LINK_ORG_UNRESOLVED_POSTSTATE';
  END IF;

  SELECT count(*) INTO v_bad
    FROM (
      SELECT g.id, g.row_digest, p.id AS current_id,
             md5((to_jsonb(p) - ARRAY[
               'org_id','first_name','last_name','title','fax','phone_extension'
             ])::text) AS current_digest
        FROM pg_temp.minted_alignment_party_guard g
        FULL JOIN public.parties p ON p.id = g.id
    ) q
   WHERE q.id IS NULL OR q.current_id IS NULL OR q.row_digest IS DISTINCT FROM q.current_digest;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'ALIGNMENT_CONTACT_PARTY_PRESERVATION_FAILED: %', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM (
      SELECT g.id, g.row_digest, a.id AS current_id,
             md5((to_jsonb(a) - ARRAY['is_default'])::text) AS current_digest
        FROM pg_temp.minted_alignment_assignment_guard g
        FULL JOIN public.party_role_assignments a ON a.id = g.id
    ) q
   WHERE q.id IS NULL OR q.current_id IS NULL OR q.row_digest IS DISTINCT FROM q.current_digest;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'ALIGNMENT_CONTACT_ASSIGNMENT_PRESERVATION_FAILED: %', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM (
      SELECT g.id, g.row_digest, l.id AS current_id,
             md5(to_jsonb(l)::text) AS current_digest
        FROM pg_temp.minted_alignment_capture_link_guard g
        FULL JOIN public.party_capture_links l ON l.id = g.id
    ) q
   WHERE q.id IS NULL OR q.current_id IS NULL OR q.row_digest IS DISTINCT FROM q.current_digest;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'ALIGNMENT_CONTACT_CAPTURE_LINK_PRESERVATION_FAILED: %', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM (
      SELECT g.id, g.row_digest, a.id AS current_id,
             md5(to_jsonb(a)::text) AS current_digest
        FROM pg_temp.minted_alignment_audit_guard g
        FULL JOIN public.audit_log a ON a.id = g.id
    ) q
   WHERE q.id IS NULL OR q.current_id IS NULL OR q.row_digest IS DISTINCT FROM q.current_digest;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'ALIGNMENT_CONTACT_AUDIT_PRESERVATION_FAILED: %', v_bad; END IF;

  SELECT count(*) INTO v_bad
    FROM (
      SELECT g.role_key, g.row_digest, t.role_key AS current_key,
             md5((to_jsonb(t) - ARRAY['label','is_active'])::text) AS current_digest
        FROM pg_temp.minted_alignment_role_type_guard g
        FULL JOIN public.party_role_types t ON t.role_key = g.role_key
    ) q
   WHERE q.role_key IS NULL OR q.current_key IS NULL OR q.row_digest IS DISTINCT FROM q.current_digest;
  IF v_bad <> 0 THEN RAISE EXCEPTION 'ALIGNMENT_CONTACT_ROLE_TYPE_PRESERVATION_FAILED: %', v_bad; END IF;

  IF EXISTS (
    SELECT 1
      FROM public.party_role_assignments
     GROUP BY org_id, role_key
    HAVING count(*) FILTER (WHERE is_default) <> 1
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_DEFAULTS_INVALID';
  END IF;
  IF (SELECT count(*) FROM public.party_role_types
      WHERE role_key IN ('billing_contact','contracting_signer','credentialing_contact')
        AND is_active) <> 3 THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_RESERVED_ROLES_INACTIVE';
  END IF;
  IF (SELECT label FROM public.party_role_types WHERE role_key = 'owner')
       IS DISTINCT FROM 'Authorized contact'
     OR (SELECT label FROM public.party_role_types WHERE role_key = 'customer_escalation_contact')
       IS DISTINCT FROM 'Organization contact' THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_ROLE_LABELS_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.party_role_assignments'::regclass
       AND conname = 'party_role_assignments_org_party_fkey'
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_COMPOSITE_FK_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.parties'::regclass
       AND tgname = 'parties_org_id_immutable'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_ORG_IMMUTABILITY_TRIGGER_MISSING';
  END IF;
  IF to_regprocedure('public.insert_contact_party(jsonb,uuid,uuid)') IS NULL
     OR to_regprocedure('public.create_organization(text,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.create_organization(text,text,text)') IS NULL
     OR to_regprocedure('public.create_capture_link(uuid,uuid,text,text)') IS NULL
     OR to_regprocedure('public.submit_capture(text,jsonb)') IS NULL
     OR to_regprocedure('public.validate_capture_token(text)') IS NULL
     OR to_regprocedure('public.set_default_party_role(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_CONTACT_FUNCTION_SIGNATURE_MISSING';
  END IF;
END
$poststate$;


-- Explicit signature-specific ACLs for the final contact functions. The legacy
-- two-argument insert_contact_party helper is retained untouched when present;
-- it is intentionally not callable by browser roles and is not recreated here.
REVOKE ALL ON FUNCTION public._party_first_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._party_last_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_contact_party(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_contact_party(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_organization(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_capture_link(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_capture_link(uuid, uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_capture(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_capture(text, jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_capture_token(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_capture_token(text) TO anon, authenticated;

-- Reconcile the captured browser/PUBLIC grants on existing throttle helpers.
-- SECURITY DEFINER callers retain owner access. Keep helper bodies, owners,
-- argument defaults and the pre-existing service_role helper grants unchanged.
REVOKE ALL ON FUNCTION public.check_rpc_throttle(text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_rpc_attempt_valid(text) FROM PUBLIC, anon, authenticated;

-- Verify effective privileges after every final REVOKE/GRANT. has_function_privilege
-- includes PUBLIC grants, so checking both browser roles proves the private
-- helpers are unreachable and the public/authenticated RPC contracts are exact.
DO $acl_poststate$
DECLARE
  v_signature text;
  v_caller record;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public._party_first_name(text)',
    'public._party_last_name(text)',
    'public.insert_contact_party(jsonb, uuid)',
    'public.insert_contact_party(jsonb, uuid, uuid)',
    'public.reject_party_org_change()'
  ]::text[] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'ALIGNMENT_CONTACT_PRIVATE_RPC_ACL_EXPOSED: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_organization(text, text, text)',
    'public.create_organization(text, text, text, jsonb, jsonb)',
    'public.create_capture_link(uuid, uuid, text, text)',
    'public.set_default_party_role(uuid, uuid, text)'
  ]::text[] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'ALIGNMENT_CONTACT_AUTHENTICATED_RPC_ACL_INVALID: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.submit_capture(text, jsonb)',
    'public.validate_capture_token(text)'
  ]::text[] LOOP
    IF NOT has_function_privilege('anon', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'ALIGNMENT_CONTACT_PUBLIC_RPC_ACL_INVALID: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.check_rpc_throttle(text, integer, integer, boolean)',
    'public.mark_rpc_attempt_valid(text)'
  ]::text[] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'ALIGNMENT_CAPTURE_HELPER_ACL_EXPOSED: %', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid IN ('public.submit_capture(text,jsonb)'::regprocedure,
                    'public.validate_capture_token(text)'::regprocedure,
                    'public.check_rpc_throttle(text,integer,integer,boolean)'::regprocedure,
                    'public.mark_rpc_attempt_valid(text)'::regprocedure)
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ALIGNMENT_CAPTURE_PUBLIC_EXECUTE_EXPOSED';
  END IF;

  -- These existing consumers call the helpers as their actual function owners.
  FOR v_caller IN
    SELECT p.proname, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('submit_capture', 'validate_capture_token', 'validate_report_share',
                       'submit_inbound_lead', 'validate_ssn_intake_token', 'submit_ssn_intake')
  LOOP
    IF NOT has_function_privilege(v_caller.proowner, 'public.check_rpc_throttle(text,integer,integer,boolean)'::regprocedure, 'EXECUTE')
       OR (v_caller.proname <> 'submit_inbound_lead' AND NOT has_function_privilege(v_caller.proowner, 'public.mark_rpc_attempt_valid(text)'::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'ALIGNMENT_CAPTURE_HELPER_OWNER_EXECUTE_MISSING: %', v_caller.proname;
    END IF;
  END LOOP;
END
$acl_poststate$;

COMMIT;

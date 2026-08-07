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

-- D8 backfill, in order of certainty:
--   (a) the org of the party's earliest role assignment — definitive;
--   (b) else the creator's SOLE org membership — unambiguous for a party
--       created but never assigned (the create-before-assign window).
UPDATE public.parties p
   SET org_id = a.org_id
  FROM (
    SELECT DISTINCT ON (party_id) party_id, org_id
      FROM public.party_role_assignments
     ORDER BY party_id, created_at, id
  ) a
 WHERE a.party_id = p.id AND p.org_id IS NULL;

UPDATE public.parties p
   SET org_id = m.org_id
  FROM (
    SELECT user_id, min(org_id::text)::uuid AS org_id
      FROM public.memberships
     GROUP BY user_id
    HAVING count(DISTINCT org_id) = 1
  ) m
 WHERE m.user_id = p.created_by AND p.org_id IS NULL;

-- Anything still unresolved has no assignment anywhere AND no unambiguous
-- creator org, so it is unreachable from every org surface once the created_by
-- visibility disjunct is retired below. No-op on hosted (verified: the single
-- orphan resolves through (b)); this is the guard for a rebuild from an odd
-- snapshot, not a routine deletion path.
DELETE FROM public.parties WHERE org_id IS NULL;

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

-- Backfill: the earliest assignment per (org, role) becomes that role's default,
-- so every existing role already resolves a token holder.
UPDATE public.party_role_assignments a
   SET is_default = true
  FROM (
    SELECT DISTINCT ON (org_id, role_key) id
      FROM public.party_role_assignments
     ORDER BY org_id, role_key, created_at, id
  ) d
 WHERE d.id = a.id AND a.is_default = false;

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

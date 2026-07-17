-- Redesign Stage 0 — Full Party model foundation (canonical schema, E0.3 §5).
--
-- Landed in the E0.1 PR (owner capture must write into this model from day one),
-- but defined per the E0.3 §5 canonical spec so E0.2/E0.3 extend rather than
-- replace it. Additive + idempotent (safe for a repo-only rebuild and for
-- re-application to the already-migrated hosted project).
--
-- Three tables:
--   party_role_types        (TE-2) governed role reference list, read-only
--   parties                 (TE-1) person/entity records, NO org_id (cross-org
--                                  reuse is the point) — RLS via assignment
--                                  membership OR created_by
--   party_role_assignments  (TE-3) org-scoped rows linking party↔role↔scope
--
-- Cross-org parties are the one approved exception to the "every table
-- org-scoped" convention (CLARIFICATIONS_NEEDED.md, PM visibility item).

-- ---------------------------------------------------------------------------
-- TE-2 — party_role_types: governed role reference list (no org scope).
-- Read-only to authenticated; the PM governs it. New roles are data inserts
-- (a seed migration), never a schema change (F0.3.5).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.party_role_types (
  role_key text PRIMARY KEY,
  label text NOT NULL,
  is_active boolean NOT NULL
);

INSERT INTO public.party_role_types (role_key, label, is_active) VALUES
  ('owner',                       'Owner',                       true),
  ('customer_escalation_contact', 'Customer Escalation Contact', true),
  ('sales_rep',                   'Sales Rep',                   true),
  ('billing_contact',             'Billing Contact',             false),
  ('contracting_signer',          'Contracting Signer',          false),
  ('credentialing_contact',       'Credentialing Contact',       false)
ON CONFLICT (role_key) DO NOTHING;

ALTER TABLE public.party_role_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_role_types_select ON public.party_role_types;
CREATE POLICY party_role_types_select ON public.party_role_types
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.party_role_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_role_types TO service_role;

-- ---------------------------------------------------------------------------
-- TE-1 — parties: person (Stage 0) / organization (reserved) records.
-- No org_id: a single Party is reused across orgs (F0.3.4). created_by carries
-- no FK (seed fixtures use a fixed placeholder id, mirroring seed.sql).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL DEFAULT 'person' CHECK (party_type IN ('person', 'organization')),
  name text NOT NULL,
  email text,
  phone_office text,
  phone_mobile text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parties_created_by_idx ON public.parties (created_by);

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parties TO service_role;

-- ---------------------------------------------------------------------------
-- TE-3 — party_role_assignments: org-scoped party↔role↔scope rows.
-- Stage 0 writes only scope_type='org' (scope_id NULL). The unique constraint
-- uses NULLS NOT DISTINCT (PG15+) so org-scoped duplicates (scope_id NULL) are
-- actually rejected — a plain UNIQUE would treat NULL scope_ids as distinct and
-- let the same (org, party, role) assignment be inserted twice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.party_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES public.party_role_types(role_key),
  scope_type text NOT NULL DEFAULT 'org' CHECK (scope_type IN ('org', 'facility', 'case')),
  scope_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_role_assignments_unique
    UNIQUE NULLS NOT DISTINCT (org_id, party_id, role_key, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS party_role_assignments_org_id_idx ON public.party_role_assignments (org_id);
CREATE INDEX IF NOT EXISTS party_role_assignments_party_id_idx ON public.party_role_assignments (party_id);
CREATE INDEX IF NOT EXISTS party_role_assignments_role_key_idx ON public.party_role_assignments (role_key);

-- Reject assignments of inactive (reserved) roles (F0.3.2 / F0.3.5). Reserved
-- roles exist in the reference list but are not assignable until their stage.
CREATE OR REPLACE FUNCTION public.reject_inactive_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.party_role_types t
    WHERE t.role_key = NEW.role_key AND t.is_active
  ) THEN
    RAISE EXCEPTION 'Role % is not active and cannot be assigned', NEW.role_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS party_role_assignments_active_role ON public.party_role_assignments;
CREATE TRIGGER party_role_assignments_active_role
  BEFORE INSERT OR UPDATE ON public.party_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.reject_inactive_role_assignment();

ALTER TABLE public.party_role_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pra_select_org ON public.party_role_assignments;
CREATE POLICY pra_select_org ON public.party_role_assignments
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

DROP POLICY IF EXISTS pra_insert_writer ON public.party_role_assignments;
CREATE POLICY pra_insert_writer ON public.party_role_assignments
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids() AS user_org_ids))
              AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

DROP POLICY IF EXISTS pra_update_writer ON public.party_role_assignments;
CREATE POLICY pra_update_writer ON public.party_role_assignments
  FOR UPDATE TO authenticated
  USING ((org_id IN (SELECT user_org_ids() AS user_org_ids))
         AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))
  WITH CHECK ((org_id IN (SELECT user_org_ids() AS user_org_ids))
              AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

DROP POLICY IF EXISTS pra_delete_writer ON public.party_role_assignments;
CREATE POLICY pra_delete_writer ON public.party_role_assignments
  FOR DELETE TO authenticated
  USING ((org_id IN (SELECT user_org_ids() AS user_org_ids))
         AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_role_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_role_assignments TO service_role;

-- ---------------------------------------------------------------------------
-- parties RLS (declared after party_role_assignments exists — the policy joins
-- it). Access where the caller CREATED the party (covers create-before-assign)
-- OR is a member of an org the party is assigned to. Writes additionally
-- require a writer role in one of those orgs.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS parties_select ON public.parties;
CREATE POLICY parties_select ON public.parties
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.party_role_assignments pra
      WHERE pra.party_id = parties.id
        AND pra.org_id IN (SELECT user_org_ids() AS user_org_ids)
    )
  );

DROP POLICY IF EXISTS parties_insert ON public.parties;
CREATE POLICY parties_insert ON public.parties
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS parties_update ON public.parties;
CREATE POLICY parties_update ON public.parties
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.party_role_assignments pra
      WHERE pra.party_id = parties.id
        AND pra.org_id IN (SELECT user_org_ids() AS user_org_ids)
        AND user_role(pra.org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.party_role_assignments pra
      WHERE pra.party_id = parties.id
        AND pra.org_id IN (SELECT user_org_ids() AS user_org_ids)
        AND user_role(pra.org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
    )
  );

DROP POLICY IF EXISTS parties_delete ON public.parties;
CREATE POLICY parties_delete ON public.parties
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.party_role_assignments pra
      WHERE pra.party_id = parties.id
        AND pra.org_id IN (SELECT user_org_ids() AS user_org_ids)
        AND user_role(pra.org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])
    )
  );

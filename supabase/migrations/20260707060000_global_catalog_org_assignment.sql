-- P2 — Global payer/SOP catalog + per-org assignment.
--
-- Global catalog rows are payers/sop_templates with org_id NULL (mirrors the
-- proven portal_field_maps global pattern). Unlike portal_field_maps (blanket
-- global SELECT), a global payer/SOP is visible to an org ONLY when the org has
-- an explicit row in org_payer_assignments — global definitions, never global
-- tenant data. Writes stay own-org-only; global rows are platform-managed via
-- the service-role client (RLS-bypassing), never by org users.
--
-- This migration is ADDITIVE and inert for existing data: the own-org SELECT
-- disjunct is preserved verbatim, and there are zero global rows today, so no
-- existing payer/SOP changes visibility. The new global-and-assigned path only
-- activates once a global row is created (a separate, human-supervised step).
-- Converting existing org payers to global rows is deliberately NOT done here.

-- 1. Allow global rows (org_id NULL) on the two catalog tables.
ALTER TABLE public.payers ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE public.sop_templates ALTER COLUMN org_id DROP NOT NULL;

-- 2. Per-org assignment / subscription join table. Also carries the
--    starter/common flag Epic 1c (starter-pack auto-attach) needs.
CREATE TABLE IF NOT EXISTS public.org_payer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  starter boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_payer_assignments_org_payer_key UNIQUE (org_id, payer_id)
);
CREATE INDEX IF NOT EXISTS org_payer_assignments_payer_idx
  ON public.org_payer_assignments (payer_id);
CREATE INDEX IF NOT EXISTS org_payer_assignments_org_idx
  ON public.org_payer_assignments (org_id);

ALTER TABLE public.org_payer_assignments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_payer_assignments TO authenticated;

-- Member SELECT own-org; admin INSERT/UPDATE/DELETE own-org.
DROP POLICY IF EXISTS org_payer_assignments_select ON public.org_payer_assignments;
CREATE POLICY org_payer_assignments_select ON public.org_payer_assignments
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS org_payer_assignments_insert ON public.org_payer_assignments;
CREATE POLICY org_payer_assignments_insert ON public.org_payer_assignments
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

DROP POLICY IF EXISTS org_payer_assignments_update ON public.org_payer_assignments;
CREATE POLICY org_payer_assignments_update ON public.org_payer_assignments
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

DROP POLICY IF EXISTS org_payer_assignments_delete ON public.org_payer_assignments;
CREATE POLICY org_payer_assignments_delete ON public.org_payer_assignments
  FOR DELETE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

-- 3. Extend SELECT to (own-org OR global-and-assigned). The first disjunct is
--    the exact prior policy; writes (INSERT/UPDATE) are left untouched, so org
--    users still cannot create or edit global rows (org_id NULL fails their
--    WITH CHECK).
DROP POLICY IF EXISTS payers_select ON public.payers;
CREATE POLICY payers_select ON public.payers
  FOR SELECT USING (
    (org_id IN (SELECT user_org_ids()))
    OR (
      org_id IS NULL AND EXISTS (
        SELECT 1 FROM public.org_payer_assignments opa
        WHERE opa.payer_id = payers.id
          AND opa.org_id IN (SELECT user_org_ids())
      )
    )
  );

-- A global SOP is visible when the org is assigned the SOP's payer. A global
-- SOP with payer_id NULL is visible to no org (safe default: invisible, never
-- leaked).
DROP POLICY IF EXISTS sop_templates_select ON public.sop_templates;
CREATE POLICY sop_templates_select ON public.sop_templates
  FOR SELECT USING (
    (org_id IN (SELECT user_org_ids()))
    OR (
      org_id IS NULL AND payer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.org_payer_assignments opa
        WHERE opa.payer_id = sop_templates.payer_id
          AND opa.org_id IN (SELECT user_org_ids())
      )
    )
  );

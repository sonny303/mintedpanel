-- E1.5 (redesign) — payer_network_targets: the group×state payer-attachment
-- grain (TE-1). org_payer_assignments (unique (org_id, payer_id)) stays the
-- org-level visibility/subscription layer and structurally cannot carry
-- group×state rows; this child table stores which provider group pursues
-- which payer in which state. Attach = intent: no attachment-status workflow
-- (real status lives on contracts/cases once generated); removal is a status
-- flip to 'archived' (history kept, re-attach restores), never a DELETE.
-- E2.x case generation reads status='active' rows; E1.8 readiness evaluates
-- against them. Additive only; inert until the Payer Network wizard section
-- writes rows.

CREATE TABLE IF NOT EXISTS public.payer_network_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.provider_groups (id) ON DELETE CASCADE,
  -- E0.10 state-format floor, plain form (the column is NOT NULL).
  state text NOT NULL
    CONSTRAINT payer_network_targets_state_format CHECK (state ~ '^[A-Z]{2}$'),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT payer_network_targets_status_check CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The epic's stated grain — group-keyed, so an org's two groups can target
  -- the same payer/state independently. Its leading column doubles as the
  -- FK cover index for group_id (E0.10 TE-4 reasoning).
  CONSTRAINT payer_network_targets_group_payer_state_key UNIQUE (group_id, payer_id, state)
);

-- FK cover indexes (E0.10 convention); group_id is covered above.
CREATE INDEX IF NOT EXISTS payer_network_targets_payer_idx
  ON public.payer_network_targets (payer_id);
CREATE INDEX IF NOT EXISTS payer_network_targets_org_idx
  ON public.payer_network_targets (org_id);

ALTER TABLE public.payer_network_targets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payer_network_targets TO authenticated;

-- RLS mirrors org_payer_assignments' roles (member SELECT, admin-only write)
-- with stricter WITH CHECKs (TE-2): a written row must reference a group of
-- the SAME org and a payer that org is actually assigned via
-- org_payer_assignments, so a multi-org admin cannot cross tenant references.
DROP POLICY IF EXISTS payer_network_targets_select ON public.payer_network_targets;
CREATE POLICY payer_network_targets_select ON public.payer_network_targets
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS payer_network_targets_insert ON public.payer_network_targets;
CREATE POLICY payer_network_targets_insert ON public.payer_network_targets
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = payer_network_targets.group_id
        AND g.org_id = payer_network_targets.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.org_payer_assignments opa
      WHERE opa.org_id = payer_network_targets.org_id
        AND opa.payer_id = payer_network_targets.payer_id
    )
  );

DROP POLICY IF EXISTS payer_network_targets_update ON public.payer_network_targets;
CREATE POLICY payer_network_targets_update ON public.payer_network_targets
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = payer_network_targets.group_id
        AND g.org_id = payer_network_targets.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.org_payer_assignments opa
      WHERE opa.org_id = payer_network_targets.org_id
        AND opa.payer_id = payer_network_targets.payer_id
    )
  );

DROP POLICY IF EXISTS payer_network_targets_delete ON public.payer_network_targets;
CREATE POLICY payer_network_targets_delete ON public.payer_network_targets
  FOR DELETE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

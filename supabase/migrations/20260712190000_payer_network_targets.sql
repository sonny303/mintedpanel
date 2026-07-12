-- E1.5 TE-1/TE-2 — payer_network_targets: the group × payer × state attachment
-- grain under the org-level "we work with this payer" intent. Distinct from
-- org_payer_assignments (the Minted-curated visibility/subscription layer,
-- UNIQUE (org_id, payer_id), which structurally cannot carry this grain — a
-- locked [stage-1b] split). Attachment carries no status workflow of its own:
-- attach = intend to pursue; archive is the removal semantic (deny → reapply
-- is a normal payer cycle) and real status lives on contracts/cases. E2.x
-- case generation reads status = 'active' rows.
--
-- org_id is deliberately denormalized (derivable via group_id) so RLS filters
-- on org_id like every other org-scoped table — keep it, set it on insert.

CREATE TABLE IF NOT EXISTS public.payer_network_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.provider_groups (id) ON DELETE CASCADE,
  state text NOT NULL CONSTRAINT payer_network_targets_state_format_check CHECK (state ~ '^[A-Z]{2}$'),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT payer_network_targets_status_check CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_network_targets_group_payer_state_key UNIQUE (group_id, payer_id, state)
);

-- FK cover indexes per the E0.10 convention (group_id is covered by the
-- unique index's leading column).
CREATE INDEX IF NOT EXISTS idx_payer_network_targets_payer_id
  ON public.payer_network_targets (payer_id);
CREATE INDEX IF NOT EXISTS idx_payer_network_targets_org_id
  ON public.payer_network_targets (org_id);

ALTER TABLE public.payer_network_targets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payer_network_targets TO authenticated;
REVOKE ALL ON public.payer_network_targets FROM anon;

-- Member SELECT own-org; admin writes own-org — mirroring
-- org_payer_assignments — with STRICTER WITH CHECKs: the group must belong to
-- the same org and the org must actually be subscribed to the payer (an
-- org_payer_assignments row exists), so a multi-org admin cannot cross tenant
-- references or attach outside the curated shortlist.
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
      WHERE g.id = group_id AND g.org_id = payer_network_targets.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.org_payer_assignments a
      WHERE a.org_id = payer_network_targets.org_id
        AND a.payer_id = payer_network_targets.payer_id
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
      WHERE g.id = group_id AND g.org_id = payer_network_targets.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.org_payer_assignments a
      WHERE a.org_id = payer_network_targets.org_id
        AND a.payer_id = payer_network_targets.payer_id
    )
  );

DROP POLICY IF EXISTS payer_network_targets_delete ON public.payer_network_targets;
CREATE POLICY payer_network_targets_delete ON public.payer_network_targets
  FOR DELETE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

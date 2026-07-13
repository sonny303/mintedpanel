-- E2.0 TE-1/TE-2/TE-3 — case_generation_exclusions: the persistent, reasoned
-- per-key exclusion the generation preview honors (an excluded provider ×
-- group × payer × state is never re-proposed until the exclusion is voided).
-- Restore is a VOID (status flip + voided_by/at stamp), never a DELETE —
-- E2.4 run detail links exclusion records, and the grant layer enforces it
-- (no DELETE grant). A later re-exclusion inserts a fresh active row; the
-- partial unique index (active rows only) permits that while still enforcing
-- the epic's "unique on the 4-part key" for live exclusions.
--
-- The reason "enum" is text + CHECK (the payer_network_targets_status_check
-- precedent — no Postgres enum types in this schema); 'other' requires a
-- non-blank note. org_id is deliberately denormalized (derivable via
-- provider_id/group_id) so RLS filters on it directly.

CREATE TABLE IF NOT EXISTS public.case_generation_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.provider_groups (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  state text NOT NULL
    CONSTRAINT case_generation_exclusions_state_format_check CHECK (state ~ '^[A-Z]{2}$'),
  reason text NOT NULL
    CONSTRAINT case_generation_exclusions_reason_check
    CHECK (reason IN ('already_credentialed', 'panel_closed', 'not_pursuing', 'other')),
  note text NULL,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT case_generation_exclusions_status_check CHECK (status IN ('active', 'voided')),
  created_by uuid NOT NULL REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_by uuid NULL REFERENCES public.profiles (id),
  voided_at timestamptz NULL,
  -- 'other' always carries its note (the epic's "other + note").
  CONSTRAINT case_generation_exclusions_other_note_check
    CHECK (reason <> 'other' OR (note IS NOT NULL AND btrim(note) <> ''))
);

-- The epic's "unique on the 4-part key", realized as a partial unique on
-- ACTIVE rows so voided history never blocks a later re-exclusion (TE-2).
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_generation_exclusions_active_key
  ON public.case_generation_exclusions (provider_id, group_id, payer_id, state)
  WHERE status = 'active';

-- FK cover indexes per the E0.10 convention (provider_id leads the partial
-- unique above).
CREATE INDEX IF NOT EXISTS idx_case_generation_exclusions_group_id
  ON public.case_generation_exclusions (group_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_exclusions_payer_id
  ON public.case_generation_exclusions (payer_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_exclusions_org_id
  ON public.case_generation_exclusions (org_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_exclusions_created_by
  ON public.case_generation_exclusions (created_by);
CREATE INDEX IF NOT EXISTS idx_case_generation_exclusions_voided_by
  ON public.case_generation_exclusions (voided_by);

ALTER TABLE public.case_generation_exclusions ENABLE ROW LEVEL SECURITY;

-- Deliberately NO DELETE grant: restore is a void, never a row delete (TE-2),
-- enforced at the grant layer as well as by policy absence.
GRANT SELECT, INSERT, UPDATE ON public.case_generation_exclusions TO authenticated;
REVOKE ALL ON public.case_generation_exclusions FROM anon;

-- Member SELECT own-org; INSERT/UPDATE admin-only ([r4-review] Q2, mirroring
-- payer_network_targets) with its stricter WITH CHECKs: provider and group
-- must each belong to the same org, so a multi-org admin cannot cross tenant
-- references. payer_id needs no org check — the payers catalog is shared and
-- a payer id is not a tenant secret; the org-scoped key rides provider_id.
DROP POLICY IF EXISTS case_generation_exclusions_select ON public.case_generation_exclusions;
CREATE POLICY case_generation_exclusions_select ON public.case_generation_exclusions
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS case_generation_exclusions_insert ON public.case_generation_exclusions;
CREATE POLICY case_generation_exclusions_insert ON public.case_generation_exclusions
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.org_id = case_generation_exclusions.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = group_id AND g.org_id = case_generation_exclusions.org_id
    )
  );

DROP POLICY IF EXISTS case_generation_exclusions_update ON public.case_generation_exclusions;
CREATE POLICY case_generation_exclusions_update ON public.case_generation_exclusions
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.org_id = case_generation_exclusions.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = group_id AND g.org_id = case_generation_exclusions.org_id
    )
  );

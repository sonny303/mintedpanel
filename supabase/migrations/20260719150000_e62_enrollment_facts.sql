-- E6.2 F6.2.5 — enrollment facts: the migration-capture model. A fact records
-- "this provider is already enrolled with this payer, in this state, UNDER THIS
-- GROUP'S CONTRACT" — reality captured, never casework. Facts count a payer
-- row toward Active on the group's fulfillment board (F6.2.3, consumed through
-- the E6.0 caseRollups derivations), suppress generation candidates (the E6.3
-- buffer math subtracts them), and NEVER create cases.
--
-- Grain: provider × group × payer × state — the case key's grain, because the
-- fact answers the same question a case would ("is this combination enrolled").
-- Expiry is a FLIP (`expired_at`/`expired_by`), never a DELETE: an expired fact
-- is history, and expiring re-opens the combination as a generation candidate
-- immediately. The partial unique below allows a fresh fact to be recorded
-- after an expiry (new row) while at most ONE live fact exists per combination.
--
-- source is a closed one-value set today ('migration' — the capture UI ships in
-- E6.4 for migrated/onboard-existing enrollment); widening the CHECK later is
-- additive. RLS: member SELECT; writer (admin|specialist) INSERT/UPDATE with
-- same-org provider+group WITH CHECKs; NO DELETE policy and no DELETE grant.
--
-- Repo-file ONLY per the E6 build rule — hosted apply is an OPERATOR step
-- (dry-run: rollback-wrapped probe on hosted, see the PR body).

CREATE TABLE IF NOT EXISTS public.enrollment_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.provider_groups (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  state text NOT NULL
    CONSTRAINT enrollment_facts_state_check CHECK (state ~ '^[A-Z]{2}$'),
  -- When the enrollment became effective, when known ("Active since ...").
  effective_date date NULL,
  source text NOT NULL DEFAULT 'migration'
    CONSTRAINT enrollment_facts_source_check CHECK (source IN ('migration')),
  -- Expiry is a flip, never a delete. Both set together by the expire path.
  expired_at timestamptz NULL,
  expired_by uuid NULL,
  created_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one LIVE fact per combination; expired rows remain as history so a
-- re-recorded fact after an expiry inserts a fresh row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_facts_live
  ON public.enrollment_facts (provider_id, group_id, payer_id, state)
  WHERE expired_at IS NULL;

-- FK-cover indexes per the E0.10 convention.
CREATE INDEX IF NOT EXISTS idx_enrollment_facts_org_id
  ON public.enrollment_facts (org_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_facts_provider_id
  ON public.enrollment_facts (provider_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_facts_group_id
  ON public.enrollment_facts (group_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_facts_payer_id
  ON public.enrollment_facts (payer_id);

ALTER TABLE public.enrollment_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enrollment_facts_select ON public.enrollment_facts;
CREATE POLICY enrollment_facts_select ON public.enrollment_facts
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

-- Writers record facts (E6.4 capture UI: provider record + onboarding); the
-- WITH CHECKs pin the provider and group to the caller's org so a multi-org
-- writer can't stamp a fact across tenants.
DROP POLICY IF EXISTS enrollment_facts_insert ON public.enrollment_facts;
CREATE POLICY enrollment_facts_insert ON public.enrollment_facts
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) IN ('admin', 'specialist')
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.org_id = enrollment_facts.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = group_id AND g.org_id = enrollment_facts.org_id
    )
  );

-- UPDATE exists for the expiry flip (and effective-date corrections); there is
-- deliberately NO DELETE policy and no DELETE grant — facts are history.
DROP POLICY IF EXISTS enrollment_facts_update ON public.enrollment_facts;
CREATE POLICY enrollment_facts_update ON public.enrollment_facts
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) IN ('admin', 'specialist')
  ) WITH CHECK (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) IN ('admin', 'specialist')
  );

GRANT SELECT, INSERT, UPDATE ON public.enrollment_facts TO authenticated;
REVOKE ALL ON public.enrollment_facts FROM anon;

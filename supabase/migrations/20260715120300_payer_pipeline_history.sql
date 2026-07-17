-- E4.0 TE-2 — payer_pipeline_history: the append-only audit trail of every
-- payer-pipeline transition (who / when / from -> to), mirroring the
-- status_history pattern. It CANNOT ride status_history: that table's
-- from_status_id / to_status_id are FKs to status_configs (which must not hold
-- the fixed payer enum) and its track CHECK is credentialing|contracting. So
-- this is a dedicated sibling.
--
-- Append-only is enforced by POLICY SHAPE and GRANT floor (the audit_log /
-- status_history posture): member SELECT + writer INSERT only — NO UPDATE and
-- NO DELETE policy or grant. A wrong row is never edited; it is annotated by a
-- later is_correction row (Edge Cases & Corrections). is_correction rows carry
-- a required justification (also the store for a Denied-"Other" single-line
-- context); reason_code_id carries the F4.0.4 structured denial/RFI reason.

CREATE TABLE IF NOT EXISTS public.payer_pipeline_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.credential_cases (id) ON DELETE CASCADE,
  -- Same nine-value domain as credential_cases.payer_pipeline_state (TE-1).
  -- from_state is NULL only for the very first row of a case's history.
  from_state text NULL
    CONSTRAINT payer_pipeline_history_from_state_check
    CHECK (from_state IS NULL OR from_state IN (
      'not_started', 'assigned', 'drafting', 'submitted', 'in_review',
      'action_required', 'approved', 'denied', 'oon')),
  to_state text NOT NULL
    CONSTRAINT payer_pipeline_history_to_state_check
    CHECK (to_state IN (
      'not_started', 'assigned', 'drafting', 'submitted', 'in_review',
      'action_required', 'approved', 'denied', 'oon')),
  reason_code_id uuid NULL REFERENCES public.denial_reason_codes (id) ON DELETE SET NULL,
  is_correction boolean NOT NULL DEFAULT false,
  -- Required on a correction row; also holds the Denied-"Other" context.
  justification text NULL,
  changed_by uuid NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_pipeline_history_justification_check
    CHECK (NOT is_correction OR justification IS NOT NULL)
);

-- FK-cover indexes per the E0.10 convention.
CREATE INDEX IF NOT EXISTS idx_payer_pipeline_history_case_id
  ON public.payer_pipeline_history (case_id);
CREATE INDEX IF NOT EXISTS idx_payer_pipeline_history_org_id
  ON public.payer_pipeline_history (org_id);
CREATE INDEX IF NOT EXISTS idx_payer_pipeline_history_reason_code_id
  ON public.payer_pipeline_history (reason_code_id)
  WHERE reason_code_id IS NOT NULL;

ALTER TABLE public.payer_pipeline_history ENABLE ROW LEVEL SECURITY;

-- Append-only at the grant layer too: SELECT + INSERT only.
REVOKE ALL ON public.payer_pipeline_history FROM PUBLIC;
REVOKE ALL ON public.payer_pipeline_history FROM anon;
GRANT SELECT, INSERT ON public.payer_pipeline_history TO authenticated;

-- Member SELECT own-org (the visible timeline is read-only to ALL org roles,
-- including billing — F4.0.1); WRITER (admin|specialist) INSERT, mirroring
-- credential_cases_update, with the stricter WITH CHECK that the case belongs
-- to the same org so a multi-org writer cannot cross tenants. Deliberately NO
-- UPDATE/DELETE policies (append-only). The admin-only correction gate lives in
-- advance_payer_pipeline (TE-5) — RLS alone cannot express "only admin when
-- is_correction".
DROP POLICY IF EXISTS payer_pipeline_history_select ON public.payer_pipeline_history;
CREATE POLICY payer_pipeline_history_select ON public.payer_pipeline_history
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS payer_pipeline_history_insert ON public.payer_pipeline_history;
CREATE POLICY payer_pipeline_history_insert ON public.payer_pipeline_history
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) IN ('admin', 'specialist')
    AND EXISTS (
      SELECT 1 FROM public.credential_cases c
      WHERE c.id = case_id AND c.org_id = payer_pipeline_history.org_id
    )
  );

-- E6.0 F6.0.1 — the unified, canonical case status (decision record
-- 2026-07-19, decision 1): every credential case carries exactly ONE status
-- from the fixed eight-value list
--   not_started → in_progress → submitted → in_review → action_required
--   → approved | denied | not_pursuing
-- replacing the org-configurable credentialing track, the payer pipeline, the
-- contracting track, and the location track as user-facing state machines.
-- The list is code-owned (src/lib/caseStatus.ts mirrors it — keep in step).
--
-- REPO-ONLY: NOT applied to hosted by the build session. Hosted apply is an
-- operator step (listed in the E6.0 PR body), in file order 120000 → 120100
-- → 120200.
--
-- This file: the canonical column + the append-only case_status_history
-- ledger + the deterministic legacy backfill. The transition RPC is 120100;
-- the evidence-based AUTO transition triggers are 120200.

-- 1) credential_cases.case_status — THE status. Additive, NOT NULL with a
-- default so every existing row is valid before the backfill runs.
ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS case_status text NOT NULL DEFAULT 'not_started';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credential_cases_case_status_check'
  ) THEN
    ALTER TABLE public.credential_cases
      ADD CONSTRAINT credential_cases_case_status_check
      CHECK (case_status IN (
        'not_started', 'in_progress', 'submitted', 'in_review',
        'action_required', 'approved', 'denied', 'not_pursuing'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credential_cases_case_status
  ON public.credential_cases (org_id, case_status);

-- 2) Contract execution date as a plain case field (F6.0.1: "Contract
-- execution/effective dates become plain fields on the case (set at
-- Approved)"). The effective date reuses the existing
-- confirmed_effective_date; execution gains its own column. The contracting
-- status machine is retired as user-facing; the contracts table itself is
-- retained untouched (additive rule).
ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS contract_executed_date date;

-- 3) case_status_history — the append-only trail of every unified-status
-- transition (the payer_pipeline_history template). status_history cannot
-- hold it: its from/to columns are FKs into status_configs, which must not
-- carry the fixed canonical enum. Old ledgers (status_history,
-- payer_pipeline_history) are retained read-only, untouched.
--
-- actor_kind attributes the transition: 'system' = the action was the proof
-- (creation, first recorded work, extension-logged submission); 'user' = a
-- person set what they learned. evidence_touch_id links the touch that
-- evidenced the transition (F6.0.3 — the Add-touch bump); reason_code_id
-- carries the required denial reason; is_correction + note is the F6.0.4
-- admin correction (appends, never rewrites).
CREATE TABLE IF NOT EXISTS public.case_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.credential_cases (id) ON DELETE CASCADE,
  -- from_status is NULL only for the very first row of a case's history.
  from_status text NULL
    CONSTRAINT case_status_history_from_status_check
    CHECK (from_status IS NULL OR from_status IN (
      'not_started', 'in_progress', 'submitted', 'in_review',
      'action_required', 'approved', 'denied', 'not_pursuing')),
  to_status text NOT NULL
    CONSTRAINT case_status_history_to_status_check
    CHECK (to_status IN (
      'not_started', 'in_progress', 'submitted', 'in_review',
      'action_required', 'approved', 'denied', 'not_pursuing')),
  actor_kind text NOT NULL DEFAULT 'user'
    CONSTRAINT case_status_history_actor_kind_check
    CHECK (actor_kind IN ('system', 'user')),
  reason_code_id uuid NULL REFERENCES public.denial_reason_codes (id) ON DELETE SET NULL,
  evidence_touch_id uuid NULL REFERENCES public.touches (id) ON DELETE SET NULL,
  is_correction boolean NOT NULL DEFAULT false,
  -- Required on a correction (F6.0.4) and on Not Pursuing; also holds the
  -- Denied-"Other" single-line context.
  note text NULL,
  changed_by uuid NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_status_history_correction_note_check
    CHECK (NOT is_correction OR note IS NOT NULL)
);

-- FK-cover indexes per the E0.10 convention.
CREATE INDEX IF NOT EXISTS idx_case_status_history_case_id
  ON public.case_status_history (case_id);
CREATE INDEX IF NOT EXISTS idx_case_status_history_org_id
  ON public.case_status_history (org_id);
CREATE INDEX IF NOT EXISTS idx_case_status_history_reason_code_id
  ON public.case_status_history (reason_code_id)
  WHERE reason_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_status_history_evidence_touch_id
  ON public.case_status_history (evidence_touch_id)
  WHERE evidence_touch_id IS NOT NULL;

ALTER TABLE public.case_status_history ENABLE ROW LEVEL SECURITY;

-- Append-only at the grant layer too: SELECT + INSERT only (the audit_log /
-- status_history / payer_pipeline_history posture). No UPDATE, no DELETE,
-- anywhere.
REVOKE ALL ON public.case_status_history FROM PUBLIC;
REVOKE ALL ON public.case_status_history FROM anon;
GRANT SELECT, INSERT ON public.case_status_history TO authenticated;

-- Member SELECT own-org (the timeline is readable by ALL org roles including
-- billing); WRITER (admin|specialist) INSERT with the stricter same-org case
-- WITH CHECK. The admin-only correction gate lives in set_case_status —
-- RLS alone cannot express "only admin when is_correction".
DROP POLICY IF EXISTS case_status_history_select ON public.case_status_history;
CREATE POLICY case_status_history_select ON public.case_status_history
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS case_status_history_insert ON public.case_status_history;
CREATE POLICY case_status_history_insert ON public.case_status_history
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) IN ('admin', 'specialist')
    AND EXISTS (
      SELECT 1 FROM public.credential_cases c
      WHERE c.id = case_id AND c.org_id = case_status_history.org_id
    )
  );

-- 4) THE deterministic backfill (F6.0.1 acceptance: every existing case's
-- (credentialing status, pipeline state) pair maps to one canonical status;
-- live customer data maps, never wipes). The mapping table — mirrored and
-- exhaustively unit-tested in src/lib/caseStatus.ts mapLegacyCaseStatus:
--
--   PIPELINE WINS once it progressed past not_started (it is the payer's
--   own truth):
--     assigned | drafting          → in_progress
--     submitted                    → submitted
--     in_review                    → in_review
--     action_required              → action_required
--     approved                     → approved
--     denied                       → denied
--     oon                          → not_pursuing
--   ELSE by internal credentialing label:
--     Not Started                  → not_started
--     In Progress                  → in_progress
--     Waiting on Provider          → in_progress
--     Submitted                    → submitted
--     Approved | In-Network        → approved
--     Denied                       → denied
--     OON | Not Required           → not_pursuing
--     (null / unknown label)       → not_started
--
-- Idempotent by construction: the set_case_status RPC keeps the two legacy
-- mirrors in lockstep with case_status, and the mirror → mapping round-trip
-- is the identity (pinned in caseStatus.test.ts), so re-running this UPDATE
-- over post-E6.0 rows recomputes the same values.
UPDATE public.credential_cases c
SET case_status = CASE
  WHEN c.payer_pipeline_state IN ('assigned', 'drafting') THEN 'in_progress'
  WHEN c.payer_pipeline_state = 'submitted' THEN 'submitted'
  WHEN c.payer_pipeline_state = 'in_review' THEN 'in_review'
  WHEN c.payer_pipeline_state = 'action_required' THEN 'action_required'
  WHEN c.payer_pipeline_state = 'approved' THEN 'approved'
  WHEN c.payer_pipeline_state = 'denied' THEN 'denied'
  WHEN c.payer_pipeline_state = 'oon' THEN 'not_pursuing'
  ELSE CASE COALESCE(
      (SELECT s.label FROM public.status_configs s WHERE s.id = c.credentialing_status_id), '')
    WHEN 'In Progress' THEN 'in_progress'
    WHEN 'Waiting on Provider' THEN 'in_progress'
    WHEN 'Submitted' THEN 'submitted'
    WHEN 'Approved' THEN 'approved'
    WHEN 'In-Network' THEN 'approved'
    WHEN 'Denied' THEN 'denied'
    WHEN 'OON' THEN 'not_pursuing'
    WHEN 'Not Required' THEN 'not_pursuing'
    ELSE 'not_started'
  END
END;

-- 5) Contracting → case-field mapping: an approved case whose (group, payer,
-- state) contract carries an effective date inherits it where the case has
-- none of its own. The contracts table's unique (group_id, payer_id, state)
-- makes the join single-row. Idempotent (the filled column drops the row out
-- of the WHERE on re-run).
UPDATE public.credential_cases c
SET confirmed_effective_date = ct.effective_date
FROM public.contracts ct
WHERE c.case_status = 'approved'
  AND c.confirmed_effective_date IS NULL
  AND ct.org_id = c.org_id
  AND ct.group_id = c.group_id
  AND ct.payer_id = c.payer_id
  AND ct.state = c.state
  AND ct.effective_date IS NOT NULL;

-- 6) Every case arrives on the new list with a readable first history row
-- naming the migration (actor system). Idempotent: only cases with no
-- unified history yet.
INSERT INTO public.case_status_history (org_id, case_id, from_status, to_status, actor_kind, note)
SELECT c.org_id, c.id, NULL, c.case_status, 'system', 'Unified case status migration (E6.0)'
FROM public.credential_cases c
WHERE NOT EXISTS (
  SELECT 1 FROM public.case_status_history h WHERE h.case_id = c.id
);

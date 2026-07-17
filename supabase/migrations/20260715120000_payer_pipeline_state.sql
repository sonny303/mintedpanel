-- E4.0 TE-1 — payer_pipeline_state on credential_cases: the EXTERNAL state
-- machine, additive and parallel to the internal status machine. It must NOT
-- touch credentialing_status_id / status_configs / status_history (A3
-- decoupling): a case now carries two independent states — where OUR internal
-- work is (unchanged) and where the PAYER is (this column).
--
-- The nine-value domain is the PM-updated 2026-07-14 vocabulary: the forward
-- spine Not Started -> Assigned -> Drafting -> Submitted -> In Review <->
-- Action Required (RFI), plus the three terminal closes Approved / Denied /
-- OON. Existing rows default to 'not_started' (no backfill, no re-map of the
-- internal statuses — F4.0.1 "existing internal case statuses untouched").
--
-- The label/edge vocabulary lives in the pure src/lib/payerPipeline.ts; this
-- CHECK is only the domain floor. Transitions ride the atomic
-- advance_payer_pipeline RPC (TE-5) — a bare UPDATE here would bypass the edge
-- rules and the append-only history, so nothing but the RPC should write it.

ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS payer_pipeline_state text NOT NULL DEFAULT 'not_started';

DO $$
BEGIN
  ALTER TABLE public.credential_cases
    ADD CONSTRAINT credential_cases_payer_pipeline_state_check
    CHECK (payer_pipeline_state IN (
      'not_started', 'assigned', 'drafting', 'submitted', 'in_review',
      'action_required', 'approved', 'denied', 'oon'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

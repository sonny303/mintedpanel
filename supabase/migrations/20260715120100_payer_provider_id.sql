-- E4.0 TE-6 — payer_provider_id on credential_cases: the payer-issued
-- enrollment identifier captured at Approved (Aetna's welcome-letter "Provider
-- PIN", BCBS's "Provider ID", etc.). Additive, nullable — set by the approval
-- step of advance_payer_pipeline (TE-5), cleared by an admin approval-reversal
-- correction on the same RPC.
--
-- The effective date reuses the shipped credential_cases.confirmed_effective_date
-- column (TE-6 — no new network_effective_date), and the tracking ID reuses the
-- shipped payer_reference_id (TE-3): the approved case IS the enrollment record
-- for that provider x payer x state (the 4-part key), so no separate enrollment
-- table is added (TD-1).

ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS payer_provider_id text;

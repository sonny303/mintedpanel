-- E0.10 F0.10.4 (TE-4) -- FK index coverage.
--
-- Adds indexes to the FK columns that lack one, per the pinned TE-4 list
-- (verified against the live schema 2026-07-10). Unindexed FKs degrade joins
-- and make ON-DELETE cascades table-scan. Additive only; no behavior change.
--
-- Deliberately NOT added (per TE-4):
--   - state_licenses.provider_id -- covered by the leading column of the
--     composite uq_state_licenses_provider_state_number.
--   - credential_cases.credentialing_status_id and status_history.contract_id
--     -- optional extras left out per the epic's Non-Goals (PM opt-in only).
-- Note: contracts.group_id is the leading column of
-- contracts_group_id_payer_id_state_key, so its single-column index is
-- technically redundant by the same reasoning that excluded
-- state_licenses.provider_id; it is included here because TE-4's pinned
-- delivery set names it explicitly (flagged in the PR).

CREATE INDEX IF NOT EXISTS idx_credential_cases_payer_id
  ON public.credential_cases (payer_id);
CREATE INDEX IF NOT EXISTS idx_credential_cases_group_id
  ON public.credential_cases (group_id);
CREATE INDEX IF NOT EXISTS idx_credential_cases_mso_id
  ON public.credential_cases (mso_id);
CREATE INDEX IF NOT EXISTS idx_credential_cases_assigned_to
  ON public.credential_cases (assigned_to);

CREATE INDEX IF NOT EXISTS idx_contracts_group_id
  ON public.contracts (group_id);
CREATE INDEX IF NOT EXISTS idx_contracts_payer_id
  ON public.contracts (payer_id);

CREATE INDEX IF NOT EXISTS idx_touches_coordinator_id
  ON public.touches (coordinator_id);

CREATE INDEX IF NOT EXISTS idx_tasks_provider_id
  ON public.tasks (provider_id);

CREATE INDEX IF NOT EXISTS idx_status_history_changed_by
  ON public.status_history (changed_by);

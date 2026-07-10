-- E0.10 F0.10.3 (TE-3) -- structural-validity constraints.
--
-- Rejects rows the model can never act on:
--   1. tasks with neither a case nor a provider owner (CHECK ... NOT VALID;
--      same owner-CHECK shape provider_documents already ships).
--   2. a second is_primary facility per provider (partial unique index,
--      mirroring the party_capture_links_one_active pattern).
--   3. duplicate status labels within a track (UNIQUE (org_id, track, label);
--      all three columns are NOT NULL in the baseline, so no
--      NULLS NOT DISTINCT needed).
--
-- Unique mechanics (TE-3): PostgreSQL has no UNIQUE ... NOT VALID -- both
-- unique additions scan the table and fail on existing duplicates, so the
-- BD-1 duplicate audits ran FIRST (2026-07-10: zero duplicate primaries, zero
-- duplicate (org, track, label) rows -- recorded in the PR).
--
-- NO constraint on mso_routing_rules: the routing-rule uniqueness is DEFERRED
-- out of E0.10 (PM decision 2026-07-10; resolver wildcard precedence is a
-- product decision -- see CLARIFICATIONS_NEEDED.md [e0.10]).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_owner_check') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_owner_check
      CHECK (case_id IS NOT NULL OR provider_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_facility_assignments_one_primary
  ON public.provider_facility_assignments (provider_id)
  WHERE is_primary;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'status_configs_org_id_track_label_key') THEN
    ALTER TABLE public.status_configs
      ADD CONSTRAINT status_configs_org_id_track_label_key UNIQUE (org_id, track, label);
  END IF;
END $$;

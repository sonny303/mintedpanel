-- E6.2 F6.2.4 — the payer-attach CSV rides the EXISTING staged-import engine
-- (the E3.3 section-descriptor pattern; no second import pipeline), so
-- import_runs.entity_kind gains the 'payer_attach' kind. One row per
-- group × payer with ';'-delimited states; eligibility (states ⊆ payer states
-- ∩ group operating states) is validated at scan time by the descriptor's
-- context scan and the commit is idempotent (skip-on-match against existing
-- targets, restore for archived ones).
--
-- Widening a CHECK is additive: every existing row and every existing writer
-- stays valid. Guarded drop-then-add because ALTER CONSTRAINT can't edit a
-- CHECK expression in place.
--
-- Repo-file ONLY per the E6 build rule — hosted apply is an OPERATOR step.

ALTER TABLE public.import_runs
  DROP CONSTRAINT IF EXISTS import_runs_entity_kind_check;

ALTER TABLE public.import_runs
  ADD CONSTRAINT import_runs_entity_kind_check
  CHECK (entity_kind IN ('provider_group', 'facility', 'provider', 'combined', 'payer_attach'));

-- E4.2 F4.2.4 / TE-14 — release configuration is a selection layer on the E2.0
-- preview; the E2.4 run record additively carries the release scope it used
-- (all / none / subset by explicit provider selection, count cap, or location).
-- No generation rule changes; unreleased candidates stay eligible via existing
-- dedupe. NULL = a full (all-candidates) run, the pre-E4.2 default.
alter table public.case_generation_runs
  add column if not exists release_scope jsonb;

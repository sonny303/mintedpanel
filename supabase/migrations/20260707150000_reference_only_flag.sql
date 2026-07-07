-- P6 PR2 — reference-only data (Epic 2e).
--
-- Migrated (onboard-existing) providers/facilities are REFERENCE data: they
-- exist to be referenced, not worked — no action-engine surfacing, no Fix-it
-- queue, no scorecards, for ~the next 1.5 years. A boolean flag (default false)
-- keeps this additive and inert for all existing rows (every current provider/
-- facility stays false = fully worked). Guarded so a repo-only rebuild passes.
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS reference_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS reference_only boolean NOT NULL DEFAULT false;

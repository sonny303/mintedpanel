-- E3.3 TE-1 — import_runs.entity_kind: the additive discriminator that lets the
-- ONE E3.0 staging machine (gate -> chunked async scan -> import_runs/import_rows
-- -> E3.1 commit) serve the three per-section uploads (Provider Group, Facilities,
-- Providers) instead of one monolithic combined roster. The run/rows/RPC/commit
-- machinery is entity-agnostic (raw/mapped are opaque jsonb); this column is the
-- only thing that tells the sections apart.
--
-- 'combined' is the DEFAULT so every in-flight E3.0 run keeps a valid,
-- distinguishable kind with NO backfill (F3.3.3 "in-flight combined runs stay
-- reviewable/cancelable"). New per-section uploads write one of the three real
-- kinds. import_rows needs no change — its run_id inherits the kind.
--
-- Additive per docs/migration-baseline.md (repo + hosted); IF NOT EXISTS so a
-- repo-only rebuild after the E3.0 baseline is a no-op.

ALTER TABLE public.import_runs
  ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'combined'
    CONSTRAINT import_runs_entity_kind_check
    CHECK (entity_kind IN ('provider_group', 'facility', 'provider', 'combined'));

-- E1.6 TE-2 — additive catalog identity columns on payers.
-- All additive/nullable (or defaulted) so existing org-scoped payer rows are
-- unaffected. payer_kind government values + prerequisite_payer_id are dormant
-- schema until R10 (no workflow logic in E1.6). stedi_payer_id is retained as
-- the column name per the PM decision 2026-07-12 ([e1.6]): Stedi is withdrawn
-- and the column carries the professional 837P clearinghouse payer ID from the
-- in-repo reference dataset (docs/redesign/data/payer-catalog/).

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS payer_kind text NOT NULL DEFAULT 'commercial',
  ADD COLUMN IF NOT EXISTS prerequisite_payer_id uuid REFERENCES public.payers(id),
  ADD COLUMN IF NOT EXISTS stedi_payer_id text,
  ADD COLUMN IF NOT EXISTS cms_hios_id text,
  ADD COLUMN IF NOT EXISTS aliases text[],
  ADD COLUMN IF NOT EXISTS states text[],
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.payers(id),
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payers_payer_kind_check') THEN
    ALTER TABLE public.payers
      ADD CONSTRAINT payers_payer_kind_check CHECK (
        payer_kind IN ('commercial', 'medicare', 'medicaid', 'medicaid_mco', 'medicare_advantage', 'tricare')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payers_status_check') THEN
    ALTER TABLE public.payers
      ADD CONSTRAINT payers_status_check CHECK (status IN ('active', 'merged', 'retired'));
  END IF;
END $$;

-- Sync dedupe key (sparse — conflicted/unverified IDs are blank in the dataset)
-- + the two self-FKs per the E0.10 FK-index convention.
CREATE INDEX IF NOT EXISTS idx_payers_stedi_payer_id ON public.payers (stedi_payer_id);
CREATE INDEX IF NOT EXISTS idx_payers_prerequisite_payer_id ON public.payers (prerequisite_payer_id);
CREATE INDEX IF NOT EXISTS idx_payers_merged_into_id ON public.payers (merged_into_id);

-- Global-catalog name canonicality: one global row per normalized name. This is
-- the pipeline's dedupe backstop for rows whose external payer ID is blank
-- (per §5: dedupe on stedi_payer_id where present, else the canonical name) and
-- the ON CONFLICT target for idempotent seeding. Partial — org-scoped rows are
-- untouched (an org may legitimately shadow a global payer's name).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payers_global_name
  ON public.payers (lower(name))
  WHERE org_id IS NULL;

-- E1.6 TE-2 — additive catalog identity columns on payers.
-- All additive/nullable (or defaulted) so existing org-scoped payer rows are
-- unaffected. payer_kind government values + prerequisite_payer_id are dormant
-- schema until R10 (no workflow logic in E1.6). Per the FINAL [e1.6] shape
-- (PM decisions 2026-07-12): Stedi is withdrawn AND clearinghouse payer IDs
-- are dropped entirely — payer_slug, the canonical key from the reference
-- dataset (docs/redesign/data/payer-catalog/payers.csv), is the identity and
-- sync dedupe key (UNIQUE where not null).

ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS payer_kind text NOT NULL DEFAULT 'commercial',
  ADD COLUMN IF NOT EXISTS prerequisite_payer_id uuid REFERENCES public.payers(id),
  ADD COLUMN IF NOT EXISTS payer_slug text,
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

-- The sync dedupe key: canonical slug, unique where present (org-scoped
-- legacy rows keep NULL), and the seed pipeline's ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payers_payer_slug
  ON public.payers (payer_slug)
  WHERE payer_slug IS NOT NULL;

-- The two self-FKs per the E0.10 FK-index convention.
CREATE INDEX IF NOT EXISTS idx_payers_prerequisite_payer_id ON public.payers (prerequisite_payer_id);
CREATE INDEX IF NOT EXISTS idx_payers_merged_into_id ON public.payers (merged_into_id);

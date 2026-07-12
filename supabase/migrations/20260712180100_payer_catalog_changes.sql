-- E1.6 TE-3 — payer_catalog_changes: append-only diff log for catalog syncs.
-- A sync-detected difference lands here for human review instead of silently
-- overwriting curated data (locked). Catalog rows are global (org_id IS NULL),
-- so this table is NOT org-scoped: reads are gated to authenticated reviewers
-- (the inbound_leads shared-queue pattern, E0.5); ALL writes are service-role
-- or the review RPC — authenticated has no INSERT/UPDATE/DELETE grant, which
-- is also what enforces the append-only rule for the diff facts
-- (review_state/reviewed_by/reviewed_at are mutated only by the RPC).

CREATE TABLE IF NOT EXISTS public.payer_catalog_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid NOT NULL REFERENCES public.payers(id),
  field text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL DEFAULT 'sync'
    CONSTRAINT payer_catalog_changes_source_check CHECK (source IN ('sync', 'manual')),
  review_state text NOT NULL DEFAULT 'unreviewed'
    CONSTRAINT payer_catalog_changes_review_state_check
    CHECK (review_state IN ('unreviewed', 'accepted', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payer_catalog_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payer_catalog_changes_select ON public.payer_catalog_changes;
CREATE POLICY payer_catalog_changes_select ON public.payer_catalog_changes
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.payer_catalog_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payer_catalog_changes TO service_role;
REVOKE ALL ON public.payer_catalog_changes FROM anon;

-- FK index (E0.10 convention) + the review-queue hot path.
CREATE INDEX IF NOT EXISTS idx_payer_catalog_changes_payer_id
  ON public.payer_catalog_changes (payer_id);
CREATE INDEX IF NOT EXISTS idx_payer_catalog_changes_unreviewed
  ON public.payer_catalog_changes (created_at)
  WHERE review_state = 'unreviewed';

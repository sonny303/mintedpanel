-- Provider Enrollment Letter document kind + optional payer_id on provider_documents

-- 1. Add nullable payer_id referencing payers table
ALTER TABLE public.provider_documents
  ADD COLUMN IF NOT EXISTS payer_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_documents_payer_id_fkey'
  ) THEN
    ALTER TABLE public.provider_documents
      ADD CONSTRAINT provider_documents_payer_id_fkey
      FOREIGN KEY (payer_id) REFERENCES public.payers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_documents_payer
  ON public.provider_documents (payer_id)
  WHERE payer_id IS NOT NULL;

-- 2. Add provider_enrollment_letter to doc_type CHECK
ALTER TABLE public.provider_documents
  DROP CONSTRAINT IF EXISTS provider_documents_doc_type_check;

ALTER TABLE public.provider_documents
  ADD CONSTRAINT provider_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY[
    'w9'::text, 'coi'::text, 'state_license'::text, 'dea'::text, 'diploma'::text,
    'board_cert'::text, 'voided_check'::text, 'filled_form'::text, 'other'::text,
    'cms_460'::text, 'cv'::text, 'cp_575'::text, 'provider_enrollment_letter'::text
  ])));

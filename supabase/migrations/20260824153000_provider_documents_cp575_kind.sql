-- Widen the provider_documents doc_type vocabulary with `cp_575` (the IRS EIN
-- confirmation letter), so the vault's group upload picker can file one.
--
-- Additive only: the constraint is restated with the existing eleven kinds
-- plus `cp_575`. No existing row changes classification, and no kind is
-- removed. `cp_575` is deliberately NOT added to
-- provider_documents_expiring_kind_dated — a CP 575 does not expire, so it
-- must remain uploadable without an expiration date. That mirrors
-- `expirationRequired: false` in the DOCUMENT_KIND_META entry in
-- src/lib/documents.ts, which this constraint is the DB-side backstop for.

ALTER TABLE public.provider_documents
  DROP CONSTRAINT IF EXISTS provider_documents_doc_type_check;

ALTER TABLE public.provider_documents
  ADD CONSTRAINT provider_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY[
    'w9'::text, 'coi'::text, 'state_license'::text, 'dea'::text, 'diploma'::text,
    'board_cert'::text, 'voided_check'::text, 'filled_form'::text, 'other'::text,
    'cms_460'::text, 'cv'::text, 'cp_575'::text
  ])));

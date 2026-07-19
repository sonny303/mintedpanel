-- E4.5 TE-1/TE-5/TE-9 — activate the dormant provider_documents table as
-- immutable document-version metadata.
--
-- TE-1: the baseline table (org_id, provider_id, group_id, case_id, doc_type,
-- file_path, file_name, effective/expiration dates, uploaded_by, created_at)
-- is reused as-is and gains the version machinery: a stable document-family
-- id, a positive version number, and a nullable supersedes pointer. A
-- replacement INSERTS a new row/object — it never updates or deletes the
-- prior version; "current" is DERIVED as the family row with no successor.
-- The baseline owner CHECK (provider OR group OR case) is deliberately kept
-- so legacy case-linked `filled_form` rows stay valid; the E4.5 upload
-- services enforce the stricter one-canonical-provider-OR-group-owner rule at
-- the service boundary.
--
-- TE-5: doc_type CHECK widened additively with `cms_460` and `cv` (historical
-- values all stay valid), and the expiration-consistency rule (State License /
-- DEA / COI require an expiration date) lands as a NOT VALID CHECK — new rows
-- are enforced, pre-existing rows are grandfathered (the E1.4 start_date
-- precedent; the operator may VALIDATE after a data audit).
--
-- TE-9: the baseline's broad grants (anon had full DML!) are cut to the
-- least-privilege floor — SELECT + INSERT for authenticated, nothing for anon
-- — and the baseline delete policy is dropped, making metadata immutable from
-- every client path. service_role grants are untouched (the guarded /api
-- finalize path inserts through it; RLS-bypassing but code-scoped).
--
-- Additive + idempotent (safe for repo-only rebuild and re-application).
-- Applying to hosted is an OPERATOR task in the same pass as the Storage
-- bucket migration — see the PR body for the exact steps.

-- ---------------------------------------------------------------------------
-- TE-1 — version-machinery columns. The volatile default gives every
-- pre-existing row its OWN family id (a single-row family at version 1),
-- which is exactly the migration semantic: each legacy document is its own
-- lineage until a replacement versions it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.provider_documents
  ADD COLUMN IF NOT EXISTS document_family_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.provider_documents
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.provider_documents
  ADD COLUMN IF NOT EXISTS supersedes_document_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_documents_supersedes_fkey'
  ) THEN
    -- NO ACTION (default): a superseded row can never be deleted out from
    -- under its successor, reinforcing immutability. A provider/org cascade
    -- delete removes the whole family in one statement, which self-FKs allow.
    ALTER TABLE public.provider_documents
      ADD CONSTRAINT provider_documents_supersedes_fkey
      FOREIGN KEY (supersedes_document_id) REFERENCES public.provider_documents(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_documents_version_positive'
  ) THEN
    ALTER TABLE public.provider_documents
      ADD CONSTRAINT provider_documents_version_positive CHECK (version_number > 0);
  END IF;

  -- One row per (org, family, version) — the idempotent finalize key: a
  -- retried finalize can never create a duplicate current version (TE-4).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_documents_org_family_version_key'
  ) THEN
    ALTER TABLE public.provider_documents
      ADD CONSTRAINT provider_documents_org_family_version_key
      UNIQUE (org_id, document_family_id, version_number);
  END IF;
END $$;

-- One successor per superseded row — version history is a chain, never a fork.
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_documents_one_successor
  ON public.provider_documents (supersedes_document_id)
  WHERE supersedes_document_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TE-5 — kind vocabulary + expiration consistency.
-- ---------------------------------------------------------------------------
ALTER TABLE public.provider_documents
  DROP CONSTRAINT IF EXISTS provider_documents_doc_type_check;
ALTER TABLE public.provider_documents
  ADD CONSTRAINT provider_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY[
    'w9'::text, 'coi'::text, 'state_license'::text, 'dea'::text, 'diploma'::text,
    'board_cert'::text, 'voided_check'::text, 'filled_form'::text, 'other'::text,
    'cms_460'::text, 'cv'::text
  ])));

-- Kinds that expire require an expiration date (D2). NOT VALID: new writes are
-- enforced, historical rows stay valid (TE-5). The shared TS metadata map in
-- src/lib/documents.ts mirrors this exact rule.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_documents_expiring_kind_dated'
  ) THEN
    ALTER TABLE public.provider_documents
      ADD CONSTRAINT provider_documents_expiring_kind_dated
      CHECK (doc_type NOT IN ('state_license', 'dea', 'coi') OR expiration_date IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- TE-9 — indexes: org ownership, expiration ordering (the expiring-credentials
-- table reads soonest-first), and current-family resolution (covered by the
-- unique above plus the one-successor partial). provider/group/case list
-- indexes already exist from the baseline.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS provider_documents_org_idx
  ON public.provider_documents (org_id);
CREATE INDEX IF NOT EXISTS provider_documents_org_expiration_idx
  ON public.provider_documents (org_id, expiration_date)
  WHERE expiration_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TE-9 — least-privilege grants + immutability. The baseline granted anon AND
-- authenticated full DML; cut to the floor. Replacement inserts, never
-- updates/deletes: no client UPDATE/DELETE grant remains, and the baseline
-- delete policy is dropped (insert stays writer-only, select stays org-scoped
-- via the baseline policies, which are kept).
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.provider_documents FROM anon;
REVOKE ALL ON public.provider_documents FROM authenticated;
GRANT SELECT, INSERT ON public.provider_documents TO authenticated;

DROP POLICY IF EXISTS provider_documents_delete_writer ON public.provider_documents;

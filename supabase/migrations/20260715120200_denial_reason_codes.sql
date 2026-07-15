-- E4.0 TE-4 — denial_reason_codes: the governed vocabulary for structured
-- denial/return reasons (F4.0.4), so R8 can report on systemic rejection
-- causes instead of parsing free-text notes. org_id NULL = a global default
-- (platform-seeded, six rows below); a non-NULL org_id row is an org-added code
-- (the E4.2 F4.2.3 management CRUD — NOT built here, this epic only seeds the
-- table and reads it). Codes deactivate (active=false), never delete, so a
-- historical payer_pipeline_history.reason_code_id reference never dangles.
--
-- Read predicate = (org_id IS NULL OR org_id IN user_org_ids()); INSERT/UPDATE
-- are admin-only (the config surface is E4.2). This is a shared-catalog +
-- own-org pattern (the payers / portal_field_maps idiom).

CREATE TABLE IF NOT EXISTS public.denial_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = global default (seeded); non-NULL = org-added (E4.2). No FK-cover
  -- index is added for a nullable, low-cardinality governance column that is
  -- always filtered as "NULL OR = <org>", never joined by org_id alone.
  org_id uuid NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One row per code within a scope: one global row per code (both NULLs
  -- collapse under NULLS NOT DISTINCT) and one row per (org, code).
  CONSTRAINT uq_denial_reason_codes_org_code UNIQUE NULLS NOT DISTINCT (org_id, code)
);

ALTER TABLE public.denial_reason_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.denial_reason_codes FROM PUBLIC;
REVOKE ALL ON public.denial_reason_codes FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.denial_reason_codes TO authenticated;

-- Any member reads the global defaults + their own org's codes.
DROP POLICY IF EXISTS denial_reason_codes_select ON public.denial_reason_codes;
CREATE POLICY denial_reason_codes_select ON public.denial_reason_codes
  FOR SELECT USING (org_id IS NULL OR org_id IN (SELECT user_org_ids()));

-- Only an org admin adds/edits org codes (E4.2). Global (NULL) rows are
-- platform-managed via the service-role client — an org user can never forge or
-- flip one (the WITH CHECK requires a real own-org org_id).
DROP POLICY IF EXISTS denial_reason_codes_insert ON public.denial_reason_codes;
CREATE POLICY denial_reason_codes_insert ON public.denial_reason_codes
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

DROP POLICY IF EXISTS denial_reason_codes_update ON public.denial_reason_codes;
CREATE POLICY denial_reason_codes_update ON public.denial_reason_codes
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  ) WITH CHECK (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

-- The six seeded global defaults (F4.0.4 initial set). Fixed UUIDs so the seed
-- is idempotent across repo rebuilds + hosted and referenceable from tests. The
-- 'other' code is special-cased by advance_payer_pipeline (TE-5): choosing it on
-- a Denied close requires the single-line context (stored as the history row's
-- justification), never concatenated into a note.
INSERT INTO public.denial_reason_codes (id, org_id, code, label, active) VALUES
  ('00000000-0000-4000-b000-0000000004a1', NULL, 'missing_documentation', 'Missing Documentation', true),
  ('00000000-0000-4000-b000-0000000004a2', NULL, 'network_closed', 'Network Closed', true),
  ('00000000-0000-4000-b000-0000000004a3', NULL, 'demographic_mismatch', 'Demographic Mismatch', true),
  ('00000000-0000-4000-b000-0000000004a4', NULL, 'incomplete_application', 'Incomplete Application', true),
  ('00000000-0000-4000-b000-0000000004a5', NULL, 'criteria_not_met', 'Credentialing Criteria Not Met', true),
  ('00000000-0000-4000-b000-0000000004a6', NULL, 'other', 'Other', true)
ON CONFLICT (id) DO NOTHING;

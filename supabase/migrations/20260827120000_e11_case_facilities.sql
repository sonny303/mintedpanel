-- E1.1 (Track B, PR 2/4) — case_facilities: a case can hold SEVERAL locations.
--
-- Today `credential_cases.facility_id` holds exactly one location, stamped at
-- creation (`resolveCaseFacilityId`) and editable to one other
-- (`setCaseFacility`). This migration does not touch that column's shape —
-- it stays populated, still read the same way by every existing caller
-- (list projections, the case detail page, the extension's case-context
-- route). It becomes the PRIMARY MIRROR of this new child table: the
-- facility whose `case_facilities` row has `is_primary = true`. Every write
-- path that changes the primary (first-location add, remove-then-promote,
-- explicit set-primary — src/services/cases.ts) writes both sides in the
-- same call, so the mirror never drifts from the child rows.
--
-- Grain: case x facility, `UNIQUE (case_id, facility_id)` — a case cannot
-- hold the same location twice. At most one row per case may be primary,
-- enforced by a partial unique index (a CHECK cannot see other rows).
--
-- Eligibility is unchanged (E1.1 decision 3): a facility may only be
-- attached when the provider is assigned to it under the case's group — the
-- same rule `isEligibleCaseFacility` already enforces for `setCaseFacility`.
-- RLS cannot cheaply express that provider x group join, so it stays an
-- app-level check in the service layer, same as `setCaseFacility` today.
--
-- RLS mirrors `credential_cases_select/insert/update` exactly (same
-- org-scope + writer-role shape: admin|specialist), plus DELETE for the same
-- writer roles — a location is removable, unlike a case itself. The
-- INSERT/UPDATE/DELETE/SELECT shape is the `provider_facility_assignments`
-- precedent, the existing M:N child table with the identical policy set.

CREATE TABLE IF NOT EXISTS public.case_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  case_id uuid NOT NULL REFERENCES public.credential_cases(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT case_facilities_case_facility_key UNIQUE (case_id, facility_id)
);

-- FK-cover indexes (E0.10 convention).
CREATE INDEX IF NOT EXISTS idx_case_facilities_org_id ON public.case_facilities (org_id);
CREATE INDEX IF NOT EXISTS idx_case_facilities_case_id ON public.case_facilities (case_id);
CREATE INDEX IF NOT EXISTS idx_case_facilities_facility_id ON public.case_facilities (facility_id);

-- At most one primary location per case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_facilities_primary_per_case
  ON public.case_facilities (case_id)
  WHERE is_primary;

ALTER TABLE public.case_facilities ENABLE ROW LEVEL SECURITY;

-- Revoke-then-grant floor (hosted default privileges would otherwise leave
-- authenticated a wider-than-intended grant) — the credential_cases /
-- provider_facility_assignments precedent.
REVOKE ALL ON public.case_facilities FROM anon;
REVOKE ALL ON public.case_facilities FROM authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.case_facilities TO authenticated;
REVOKE ALL ON public.case_facilities FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.case_facilities TO service_role;

DROP POLICY IF EXISTS case_facilities_select ON public.case_facilities;
CREATE POLICY case_facilities_select ON public.case_facilities
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS case_facilities_insert ON public.case_facilities;
CREATE POLICY case_facilities_insert ON public.case_facilities
  FOR INSERT TO authenticated
  WITH CHECK (
    (org_id IN (SELECT user_org_ids()))
    AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))
  );

DROP POLICY IF EXISTS case_facilities_update ON public.case_facilities;
CREATE POLICY case_facilities_update ON public.case_facilities
  FOR UPDATE TO authenticated
  USING (
    (org_id IN (SELECT user_org_ids()))
    AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))
  )
  WITH CHECK (
    (org_id IN (SELECT user_org_ids()))
    AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))
  );

DROP POLICY IF EXISTS case_facilities_delete ON public.case_facilities;
CREATE POLICY case_facilities_delete ON public.case_facilities
  FOR DELETE TO authenticated
  USING (
    (org_id IN (SELECT user_org_ids()))
    AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))
  );

-- ---------------------------------------------------------------------------
-- Backfill: every existing case with a non-null facility_id gets exactly one
-- case_facilities row, is_primary = true, mirroring what's on the case today.
-- created_by NULL = system backfill (no human actor, same convention as other
-- migration-time backfills in this repo). ON CONFLICT DO NOTHING makes this
-- statement re-runnable / idempotent against a partially-backfilled table.
-- ---------------------------------------------------------------------------
INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
SELECT c.org_id, c.id, c.facility_id, true, NULL
FROM public.credential_cases c
WHERE c.facility_id IS NOT NULL
ON CONFLICT (case_id, facility_id) DO NOTHING;

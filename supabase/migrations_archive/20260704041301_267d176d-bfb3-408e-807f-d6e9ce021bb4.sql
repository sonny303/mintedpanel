-- Launch → location pivot (Minted Panel launch PRD v2.1).
-- A launch is not its own entity: it is a locations (facilities) row in a
-- pre-active status. This migration:
--   1. widens status_configs.track with 'location' and seeds the launch
--      pipeline statuses for every organization
--   2. adds facilities.status_id + facilities.effective_date
--   3. backfills existing facilities to Live with effective_date = created_at
--   4. folds legacy launches rows into facilities (creating locations where
--      none were linked), carrying status and start dates, and converts
--      provider links (providers.launch_id, clinic director) into
--      provider_facility_assignments rows
-- The legacy launches table and providers.launch_id stay in place per the
-- additive-migrations rule but are no longer read or written by the app.
-- cases.location_id from the PRD is the existing credential_cases.facility_id.

ALTER TABLE public.status_configs DROP CONSTRAINT IF EXISTS status_configs_track_check;
ALTER TABLE public.status_configs
  ADD CONSTRAINT status_configs_track_check
  CHECK (track IN ('credentialing', 'contracting', 'location'));

-- action_bucket was added directly on the hosted database; local rebuilds
-- from this directory never got it. No-op where the column already exists.
ALTER TABLE public.status_configs
  ADD COLUMN IF NOT EXISTS action_bucket text NOT NULL DEFAULT 'ours';

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS status_id uuid REFERENCES public.status_configs(id),
  ADD COLUMN IF NOT EXISTS effective_date date;

INSERT INTO public.status_configs (org_id, track, label, color, sort_order, required_fields, action_bucket)
SELECT o.id, 'location', v.label, v.color, v.sort_order, '[]'::jsonb, v.action_bucket
FROM public.organizations o
CROSS JOIN (VALUES
  ('Prospect',            '#9CA3AF', 10, 'ours'),
  ('Planned',             '#2563EB', 20, 'ours'),
  ('Interviewing',        '#0891B2', 30, 'ours'),
  ('Pending Fulfillment', '#D97706', 40, 'ours'),
  ('Ready for Launch',    '#059669', 50, 'ours'),
  ('Live',                '#059669', 60, 'complete'),
  ('Inactive',            '#9CA3AF', 70, 'complete')
) AS v(label, color, sort_order, action_bucket)
WHERE NOT EXISTS (
  SELECT 1 FROM public.status_configs sc
  WHERE sc.org_id = o.id AND sc.track = 'location' AND sc.label = v.label
);

-- Decision log: existing locations backfill to Live, effective_date = created_at.
UPDATE public.facilities f
SET status_id = sc.id,
    effective_date = f.created_at::date
FROM public.status_configs sc
WHERE sc.org_id = f.org_id
  AND sc.track = 'location'
  AND sc.label = 'Live'
  AND f.status_id IS NULL;

-- Legacy launches data only exists on databases that ran the hosted-only
-- create_launches migration; guard so rebuilds from this directory still work.
DO $$
BEGIN
  IF to_regclass('public.launches') IS NULL THEN
    RETURN;
  END IF;

  -- Launches that never linked a facility become locations of their own.
  WITH created AS (
    INSERT INTO public.facilities (org_id, group_id, name, street, city, state, is_active)
    SELECT l.org_id, l.group_id, l.name, l.address, l.city, l.state, true
    FROM public.launches l
    WHERE l.facility_id IS NULL
    RETURNING id, org_id, name, city, state
  )
  UPDATE public.launches l
  SET facility_id = c.id
  FROM created c
  WHERE l.facility_id IS NULL
    AND l.org_id = c.org_id
    AND l.name = c.name
    AND coalesce(l.city, '') = coalesce(c.city, '')
    AND coalesce(l.state, '') = coalesce(c.state, '');

  -- Carry pipeline status and start dates onto the location. Month-only
  -- target dates are already stored as the 1st, per the PRD date decision.
  UPDATE public.facilities f
  SET status_id = sc.id,
      effective_date = COALESCE(l.confirmed_start_date, l.target_month)
  FROM public.launches l
  JOIN public.status_configs sc
    ON sc.org_id = l.org_id
   AND sc.track = 'location'
   AND sc.label = CASE l.status
        WHEN 'prospect'            THEN 'Prospect'
        WHEN 'planned'             THEN 'Planned'
        WHEN 'interviewing'        THEN 'Interviewing'
        WHEN 'pending_fulfillment' THEN 'Pending Fulfillment'
        WHEN 'ready_for_launch'    THEN 'Ready for Launch'
        WHEN 'live'                THEN 'Live'
        WHEN 'cancelled'           THEN 'Inactive'
      END
  WHERE f.id = l.facility_id;

  -- Provider-on-launch becomes the provider-location link.
  INSERT INTO public.provider_facility_assignments (org_id, provider_id, facility_id)
  SELECT p.org_id, p.id, l.facility_id
  FROM public.providers p
  JOIN public.launches l ON l.id = p.launch_id
  WHERE l.facility_id IS NOT NULL
  ON CONFLICT (provider_id, facility_id) DO NOTHING;

  INSERT INTO public.provider_facility_assignments (org_id, provider_id, facility_id)
  SELECT l.org_id, l.clinic_director_provider_id, l.facility_id
  FROM public.launches l
  WHERE l.clinic_director_provider_id IS NOT NULL
    AND l.facility_id IS NOT NULL
  ON CONFLICT (provider_id, facility_id) DO NOTHING;
END $$;

CREATE INDEX IF NOT EXISTS idx_facilities_status_id ON public.facilities(status_id);
CREATE INDEX IF NOT EXISTS idx_credential_cases_facility_id ON public.credential_cases(facility_id);

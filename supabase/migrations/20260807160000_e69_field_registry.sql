-- E6.9 F6.9.1 — field registry schema.
--
-- Three additive columns the unified registry needs, plus the per-tier unique
-- indexes that finally back the `(portal_key, selector)` idempotency claim.
--
-- Why the indexes matter: `proposeFieldMap` implements idempotency as a
-- read-then-insert with NOTHING behind it, so two concurrent captures of the
-- same page duplicate rows. That was survivable while a row was just a
-- mapping; from this epic a row also carries display_label, section and
-- sort_order, so a duplicate is a visibly wrong registry.
--
-- Tiering: `portal_field_maps` rows are either SHARED (org_id IS NULL — the
-- trained-form library, D12) or an org row. The two tiers share a portal_key,
-- so every uniqueness and ordering rule partitions on the tier; a single
-- (portal_key, …) rule would collide the library with an org's rows.
--
-- Repo-only per the E6-wave rule; hosted apply is an operator step in the PR
-- body. Live precheck at authoring time: 0 duplicates in either tier
-- (128 rows — 24 shared, 104 org, 3 portal keys).

-- ---------------------------------------------------------------------------
-- 1. Registry columns.
--    display_label = the admin's name; field_label stays the payer's raw
--    captured text and is NEVER overwritten by a rename (D6).
--    section = the admin's grouping; form_section stays the heading read off
--    the page.
-- ---------------------------------------------------------------------------
ALTER TABLE public.portal_field_maps
  ADD COLUMN IF NOT EXISTS display_label text,
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN public.portal_field_maps.display_label IS
  'E6.9: admin-facing field name. NULL falls back to field_label (the raw captured text, never overwritten).';
COMMENT ON COLUMN public.portal_field_maps.section IS
  'E6.9: admin grouping. NULL falls back to form_section, then page_step, then "Fields".';
COMMENT ON COLUMN public.portal_field_maps.sort_order IS
  'E6.9: position within (tier, portal_key, page_step); re-derived from live DOM order on re-capture.';

-- ---------------------------------------------------------------------------
-- 2. Duplicate precheck — fail loudly rather than silently skipping the
--    index. A non-empty result is a PM data-cleanup question (F6.9.1).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_shared bigint;
  v_org bigint;
BEGIN
  SELECT count(*) INTO v_shared FROM (
    SELECT 1 FROM public.portal_field_maps
     WHERE org_id IS NULL
     GROUP BY portal_key, selector HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO v_org FROM (
    SELECT 1 FROM public.portal_field_maps
     WHERE org_id IS NOT NULL
     GROUP BY org_id, portal_key, selector HAVING count(*) > 1
  ) d;

  IF v_shared > 0 OR v_org > 0 THEN
    RAISE EXCEPTION
      'e69_field_registry: % shared and % org duplicate (portal_key, selector) groups exist; resolve before indexing',
      v_shared, v_org;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Per-tier partial unique indexes. Both propose paths move to
--    ON CONFLICT DO NOTHING + re-read against these.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_field_maps_shared_selector
  ON public.portal_field_maps (portal_key, selector)
  WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_field_maps_org_selector
  ON public.portal_field_maps (org_id, portal_key, selector)
  WHERE org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Backfill sort_order from the existing created_at order, PARTITIONED PER
--    TIER. `org_id` leads the partition so the shared library (org_id IS NULL,
--    which groups as one partition in PARTITION BY) never interleaves with an
--    org's rows for the same portal_key.
--
--    Idempotent: only rows whose sort_order is still NULL are touched, so a
--    re-run after real ordering work does not clobber it.
-- ---------------------------------------------------------------------------
WITH ordered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, portal_key, page_step
           ORDER BY created_at, id
         ) AS rn
    FROM public.portal_field_maps
)
UPDATE public.portal_field_maps m
   SET sort_order = ordered.rn
  FROM ordered
 WHERE m.id = ordered.id
   AND m.sort_order IS NULL;

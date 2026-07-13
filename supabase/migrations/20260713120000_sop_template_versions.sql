-- E1.7b — SOP-as-Data: Model A immutable version rows (the E1.7a §4 sketch,
-- with the §5 TE-1..TE-4 corrections). Additive only.
--
-- 1. sop_template_versions: one immutable row per publish. No org_id — tenancy
--    derives structurally from the parent (RLS SELECT via EXISTS on the parent
--    visibility disjunct). authenticated gets SELECT ONLY: all writes happen
--    inside the publish RPC / creation trigger / backfill, which is the
--    immutability mechanism.
-- 2. sop_templates.current_version head pointer (default 1).
-- 3. tasks.sop_template_id / tasks.sop_version stamp columns (nullable,
--    both-null-or-both-present CHECK, composite FK to the exact version row).
--    DDL only here — E2.2 writes them; legacy tasks stay NULL/NULL.
-- 4. Version-1 backfill for every pre-existing template (INSERT-only;
--    published_at = the template's updated_at, published_by NULL).
-- 5. AFTER INSERT trigger on sop_templates so every post-migration create
--    (wizard create, Duplicate, service-role seeding) gets its version-1 row —
--    the TE-4 invariant "every head has a version row for current_version" is
--    true by construction; the E2.2 composite FK can never dangle.
-- 6. publish_sop_template_version RPC: SECURITY DEFINER, one transaction,
--    ADMIN membership check (TE-3 — sop_templates writes are admin-only today;
--    the E1.7a sketch's "writer" check would widen publish to specialists),
--    optimistic concurrency on current_version, audit row.
-- 7. sop_templates_select gains a third disjunct (org_id IS NULL AND payer_id
--    IS NULL): payerless global SOPs — the F1.7b.4 fallback — become visible
--    to all authenticated org members (PM-confirmed [r4-review] Q1; template
--    content carries tokens, never tenant data or PHI).
-- 8. Seed exactly one global fallback SOP (fixed well-known UUID, ON CONFLICT
--    DO NOTHING) transcribed credential-free from worked example 2 of
--    docs/redesign/E1.7b-sop-worked-examples.md.

-- ---------------------------------------------------------------------------
-- 1. Version table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sop_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.sop_templates (id),
  version integer NOT NULL,
  name text NOT NULL,
  task_definitions jsonb NOT NULL,
  change_note text,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  CONSTRAINT sop_template_versions_template_version_key UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS sop_template_versions_template_idx
  ON public.sop_template_versions (template_id);

ALTER TABLE public.sop_template_versions ENABLE ROW LEVEL SECURITY;

-- Explicit grants alongside RLS (AGENTS.md): SELECT only. No INSERT/UPDATE/
-- DELETE grant or policy for authenticated — version rows are written only by
-- the publish RPC, the creation trigger, and this migration's backfill.
REVOKE ALL ON public.sop_template_versions FROM PUBLIC;
REVOKE ALL ON public.sop_template_versions FROM anon;
REVOKE ALL ON public.sop_template_versions FROM authenticated;
GRANT SELECT ON public.sop_template_versions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.sop_template_versions TO service_role;

-- SELECT scopes through the parent: a version row is visible exactly when its
-- template is (own-org OR global-and-payer-assigned OR payerless-global — the
-- post-widening sop_templates_select disjunct, restated here because policies
-- do not compose across tables).
DROP POLICY IF EXISTS sop_template_versions_select ON public.sop_template_versions;
CREATE POLICY sop_template_versions_select ON public.sop_template_versions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.sop_templates t
      WHERE t.id = sop_template_versions.template_id
        AND (
          (t.org_id IN (SELECT user_org_ids()))
          OR (
            t.org_id IS NULL AND t.payer_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.org_payer_assignments opa
              WHERE opa.payer_id = t.payer_id
                AND opa.org_id IN (SELECT user_org_ids())
            )
          )
          OR (t.org_id IS NULL AND t.payer_id IS NULL)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Head pointer
-- ---------------------------------------------------------------------------
ALTER TABLE public.sop_templates
  ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 3. Task stamp columns (written by E2.2, not this epic)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sop_template_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sop_version integer;

DO $$
BEGIN
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_sop_stamp_both_or_neither
    CHECK ((sop_template_id IS NULL) = (sop_version IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_sop_version_fkey
    FOREIGN KEY (sop_template_id, sop_version)
    REFERENCES public.sop_template_versions (template_id, version);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS tasks_sop_template_version_idx
  ON public.tasks (sop_template_id, sop_version)
  WHERE sop_template_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Version-1 backfill for pre-existing templates (INSERT-only)
-- ---------------------------------------------------------------------------
INSERT INTO public.sop_template_versions
  (template_id, version, name, task_definitions, change_note, published_at, published_by)
SELECT t.id, t.current_version, t.name, t.task_definitions,
       'Backfilled from the pre-versioning head (E1.7b migration)',
       COALESCE(t.updated_at, now()), NULL
FROM public.sop_templates t
ON CONFLICT (template_id, version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Creation trigger — the TE-4 invariant for every future insert path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sop_template_seed_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.sop_template_versions
    (template_id, version, name, task_definitions, published_by)
  VALUES (NEW.id, NEW.current_version, NEW.name, NEW.task_definitions, auth.uid())
  ON CONFLICT (template_id, version) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sop_templates_seed_version ON public.sop_templates;
CREATE TRIGGER sop_templates_seed_version
  AFTER INSERT ON public.sop_templates
  FOR EACH ROW EXECUTE FUNCTION public.sop_template_seed_version();

-- ---------------------------------------------------------------------------
-- 6. Publish RPC — the ONLY authenticated write path for version rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_sop_template_version(
  p_template_id uuid,
  p_expected_version integer,
  p_name text,
  p_task_definitions jsonb,
  p_change_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_current integer;
  v_uid uuid := auth.uid();
  v_next integer;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Template name is required';
  END IF;
  IF p_task_definitions IS NULL OR jsonb_typeof(p_task_definitions) <> 'array' THEN
    RAISE EXCEPTION 'task_definitions must be a json array';
  END IF;

  SELECT org_id, current_version INTO v_org, v_current
    FROM public.sop_templates WHERE id = p_template_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- TE-3: publish is ADMIN, mirroring the sop_templates write policies (the
  -- E1.7a sketch's "writer" check would have widened publish to specialists).
  -- Global templates (org_id NULL) are platform-managed: browser callers are
  -- rejected outright; only the service-role path (auth.uid() IS NULL) may
  -- publish them.
  IF v_org IS NULL THEN
    IF v_uid IS NOT NULL THEN
      RAISE EXCEPTION 'Global templates are platform-managed';
    END IF;
  ELSIF NOT (v_org IN (SELECT user_org_ids()))
     OR user_role(v_org) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Optimistic concurrency: the row is locked, so a mismatch means the caller
  -- published from a stale head. The message prefix is the wire contract the
  -- templates service maps to a friendly conflict toast — keep it stable.
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'sop_version_conflict: expected version %, head is %',
      p_expected_version, v_current;
  END IF;

  v_next := v_current + 1;

  INSERT INTO public.sop_template_versions
    (template_id, version, name, task_definitions, change_note, published_by)
  VALUES (p_template_id, v_next, btrim(p_name), p_task_definitions,
          NULLIF(btrim(COALESCE(p_change_note, '')), ''), v_uid);

  UPDATE public.sop_templates
    SET name = btrim(p_name),
        task_definitions = p_task_definitions,
        current_version = v_next,
        updated_at = now()
    WHERE id = p_template_id AND current_version = v_current;
  IF NOT FOUND THEN
    -- Unreachable under the FOR UPDATE lock; kept per the E1.7a sketch as the
    -- belt-and-braces guard (UNIQUE (template_id, version) backstops it too).
    RAISE EXCEPTION 'sop_version_conflict: concurrent publish detected';
  END IF;

  -- Audit (org templates only — audit_log.org_id is NOT NULL; a global publish
  -- is service-role/MCP, where the immutable version row itself is the trail).
  IF v_org IS NOT NULL THEN
    INSERT INTO public.audit_log
      (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'UPDATE', 'sop_template', p_template_id,
            'Published SOP template ' || btrim(p_name) || ' version ' || v_next);
  END IF;

  RETURN jsonb_build_object('template_id', p_template_id, 'version', v_next);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Fallback visibility — the TE-2 policy widening (PM-confirmed)
-- ---------------------------------------------------------------------------
-- First two disjuncts are the shipped 20260707060000 policy verbatim; the
-- third makes payerless global SOPs (the fallback) visible to all orgs'
-- members. Writes are untouched: org users still cannot create or edit any
-- global row.
DROP POLICY IF EXISTS sop_templates_select ON public.sop_templates;
CREATE POLICY sop_templates_select ON public.sop_templates
  FOR SELECT USING (
    (org_id IN (SELECT user_org_ids()))
    OR (
      org_id IS NULL AND payer_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.org_payer_assignments opa
        WHERE opa.payer_id = sop_templates.payer_id
          AND opa.org_id IN (SELECT user_org_ids())
      )
    )
    OR (org_id IS NULL AND payer_id IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 8. Seed the global fallback SOP (worked example 2, credential-free).
--    Fixed well-known UUID — mirrored as FALLBACK_SOP_TEMPLATE_ID in
--    src/lib/pickTemplate.ts. The creation trigger above writes its version-1
--    row. Tokens are deliberately limited to names the client resolver's
--    buildTokenMap resolves.
-- ---------------------------------------------------------------------------
INSERT INTO public.sop_templates
  (id, org_id, name, group_id, state, specialty, payer_id, task_definitions, archived)
VALUES (
  '00000000-0000-4000-a000-00000000e17b',
  NULL,
  'General Enrollment (fallback)',
  NULL, NULL, NULL, NULL,
  '[
    {
      "title": "Prepare provider file for {{provider.firstName}} {{provider.lastName}}",
      "description": "General enrollment pre-flight. This checklist is the generic fallback used when no payer-specific SOP exists.",
      "sortOrder": 0,
      "dueOffsetDays": 2,
      "steps": [
        {
          "label": "Create the provider folder in the shared drive and file the signed acknowledgment",
          "detail": "Reference internal documents by name; never record shared logins or passwords in SOP steps."
        },
        {
          "label": "Verify the state license is current and on file",
          "dataFields": [{ "label": "License #", "token": "provider.licenseNumber" }]
        },
        {
          "label": "Add the provider to the group roster",
          "detail": "Update the roster the group maintains.",
          "dataFields": [{ "label": "Group name", "token": "group.name" }]
        }
      ]
    },
    {
      "title": "Update registries (CAQH / NPPES / PECOS)",
      "sortOrder": 1,
      "dueOffsetDays": 5,
      "steps": [
        {
          "label": "Confirm CAQH attestation is current and re-attest if stale",
          "stepType": "online_form",
          "expectedTurnaroundDays": 7,
          "dataFields": [{ "label": "CAQH ID", "token": "provider.caqhId" }]
        },
        {
          "label": "Verify the NPPES record and practice address",
          "stepType": "online_form",
          "dataFields": [
            { "label": "Type 1 NPI", "token": "provider.npi" },
            { "label": "Practice address", "token": "facility.address" }
          ]
        },
        { "label": "Confirm PECOS enrollment is active", "stepType": "online_form" }
      ]
    },
    {
      "title": "Submit enrollment to the payer",
      "sortOrder": 2,
      "dueOffsetDays": 7,
      "steps": [
        {
          "label": "Submit the payer''s enrollment application",
          "detail": "No payer-specific SOP exists for this payer and state yet — follow the payer''s published enrollment process, then author a payer SOP from what you learn.",
          "stepType": "online_form",
          "requiredArtifacts": ["Submission confirmation"],
          "dataFields": [
            { "label": "Type 1 NPI", "token": "provider.npi" },
            { "label": "Group TIN", "token": "group.tin" },
            { "label": "Group Type 2 NPI", "token": "group.npiType2" }
          ]
        }
      ]
    },
    {
      "title": "Follow up until the payer approves",
      "sortOrder": 3,
      "dueOffsetDays": 45,
      "steps": [
        {
          "label": "Call the payer''s provider-services line for status",
          "stepType": "phone",
          "expectedTurnaroundDays": 45,
          "followUpEveryDays": 14
        },
        { "label": "Record the effective date and network status on approval" }
      ]
    }
  ]'::jsonb,
  false
)
ON CONFLICT (id) DO NOTHING;

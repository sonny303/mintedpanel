-- 3M Slice 6 / D6.5 Option A — global SOP read-back without org adoption.
-- Spike: docs/ops/slice-6-platform-org-spike.md (LOCKED D6.5, Option A).
--
-- THE BUG D6.1 EXPOSES. author_global_sop and publish_sop_template_version do
-- not require an org_payer_assignments row — an author can WRITE a global SOP
-- for any global payer. But sop_templates_select only surfaces a global row
-- when the reader's org is assigned that SOP's payer. So the moment
-- create_payer is called with p_assign_to_org = false, the author can create
-- a template for that payer and then not see it on the payer's Templates tab
-- (useSops -> listTemplates is a browser RLS read). Write-then-vanish. The
-- spike rejected "assign first" (Option B) because it defeats the model.
--
-- THE FIX: global SOP rows are readable by any authenticated org member,
-- exactly like the global portal registry already is
-- (portals_select_org, 20260719170000: `org_id IS NULL OR org_id IN
-- user_org_ids()`). The two tiers are the same kind of thing — shared
-- platform-authored catalog content, no PHI, no org data — and E6.5 already
-- opened global SOP AUTHORING to any authenticated user (the interim F6.5.6
-- posture, TD-42). Reads being narrower than writes was the inconsistency.
--
-- WHY THIS CANNOT CHANGE WHICH TEMPLATE A CASE RESOLVES. pickTemplate matches
-- on payer_id + state, and a case only exists for a payer the org has
-- attached — payer_network_targets' WITH CHECK requires an
-- org_payer_assignments row, and the manual-case picker reads the same
-- assignment-gated listPayers. Every global SOP this newly reveals belongs to
-- a payer the org has NOT adopted, so it can never win a match it did not
-- already win. Pinned in src/lib/pickTemplate.test.ts.
--
-- Scope: SELECT only, global rows only. Org-tier rows keep the unchanged
-- membership disjunct, and every WRITE policy is untouched — org users still
-- cannot create or edit a global row by direct table access (the RPCs remain
-- the only door). payers_select is deliberately NOT widened: listPayers is
-- the "my network" universe that feeds the manual-case picker and attach
-- eligibility, and the global catalog already has its own read path
-- (list_global_payers).

-- The first disjunct is the shipped policy verbatim. The second REPLACES the
-- assignment-gated global disjunct AND subsumes the payerless-fallback
-- disjunct 20260713120000 added, which was always a special case of it.
DROP POLICY IF EXISTS sop_templates_select ON public.sop_templates;
CREATE POLICY sop_templates_select ON public.sop_templates
  FOR SELECT USING (
    (org_id IN (SELECT user_org_ids()))
    OR (org_id IS NULL)
  );

-- Versions scope through the parent's visibility (they carry no org_id of
-- their own), so the same widening has to be restated here or the version
-- history / provenance panel goes blank for a newly visible global template.
DROP POLICY IF EXISTS sop_template_versions_select ON public.sop_template_versions;
CREATE POLICY sop_template_versions_select ON public.sop_template_versions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.sop_templates t
      WHERE t.id = sop_template_versions.template_id
        AND (
          (t.org_id IN (SELECT user_org_ids()))
          OR (t.org_id IS NULL)
        )
    )
  );

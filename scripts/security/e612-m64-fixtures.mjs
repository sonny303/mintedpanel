// Persistent synthetic owner/configuration fixtures for the disposable E6.12
// MINT-64 browser run. Receipts and touches are deliberately left to the real
// Extension and Panel paths; this module seeds only their starting state.
import { E612, sqlLiteral } from "./e612-fixtures.mjs";

export const M64 = Object.freeze({
  org: "18000000-0000-4000-a000-000000000064",
  payer: "28000000-0000-4000-a000-000000000064",
  group: "49000000-0000-4000-a000-000000000064",
  provider: "39000000-0000-4000-a000-000000000065",
  facility: "78000000-0000-4000-a000-000000000064",
  contract: "29000000-0000-4000-a000-000000000064",
  contractPortal: "38000000-0000-4000-a000-000000000064",
  enrollmentPortal: "38000000-0000-4000-a000-000000000065",
  contractTemplate: "69000000-0000-4000-a000-000000000064",
  enrollmentTemplate: "69000000-0000-4000-a000-000000000065",
  contractAssignment: "79000000-0000-4000-a000-000000000064",
  enrollmentCase: "49000000-0000-4000-a000-000000000064",
  enrollmentTask: "99000000-0000-4000-a000-000000000064",
  enrollmentSiblingTask: "99000000-0000-4000-a000-000000000065",
  enrollmentStep1: "89000000-0000-4000-a000-000000000064",
  enrollmentStep2: "89000000-0000-4000-a000-000000000065",
  enrollmentSiblingStep: "89000000-0000-4000-a000-000000000066",
  formUrl: "https://mintedpanel.vercel.app/__m64__/form",
});

/** Build a single-transaction fixture tagged with the enclosing E6.12 run. */
export function m64FixtureSql(runId) {
  if (typeof runId !== "string" || !/^[a-f0-9]{16}$/.test(runId)) {
    throw new Error("E612_M64_FIXTURE_RUN_ID_INVALID");
  }

  const runLabel = `E612 M64 ${runId}`;
  const userId = E612.specialist;

  return `
BEGIN;
SET LOCAL client_min_messages = warning;

-- The browser signs in as this already-bootstrapped synthetic account. Its
-- M64 membership and staff manifest are limited to this disposable run.
INSERT INTO public.organizations (id, name)
VALUES (${sqlLiteral(M64.org)}, ${sqlLiteral(`${runLabel} Organization`)});
INSERT INTO public.memberships (org_id, user_id, role)
VALUES (${sqlLiteral(M64.org)}, ${sqlLiteral(userId)}, 'specialist');
INSERT INTO private.internal_staff
  (auth_user_id, org_id, staff_role, active, approved_by, approved_at, manifest_version)
VALUES
  (${sqlLiteral(userId)}, ${sqlLiteral(M64.org)}, 'specialist', TRUE,
   ${sqlLiteral(E612.admin)}, now(), ${sqlLiteral(runLabel)});

INSERT INTO public.payers (id, org_id, name)
VALUES (${sqlLiteral(M64.payer)}, ${sqlLiteral(M64.org)}, ${sqlLiteral(`${runLabel} Payer`)});
INSERT INTO public.provider_groups (id, org_id, name)
VALUES (${sqlLiteral(M64.group)}, ${sqlLiteral(M64.org)}, ${sqlLiteral(`${runLabel} Group`)});
INSERT INTO public.providers
  (id, org_id, group_id, first_name, last_name, email, npi, status)
VALUES
  (${sqlLiteral(M64.provider)}, ${sqlLiteral(M64.org)}, ${sqlLiteral(M64.group)},
   'Synthetic', 'M64 Provider', 'provider@m64.test', '9999999995', 'active');
INSERT INTO public.provider_group_assignments
  (org_id, provider_id, group_id, is_primary, start_date)
VALUES
  (${sqlLiteral(M64.org)}, ${sqlLiteral(M64.provider)}, ${sqlLiteral(M64.group)}, TRUE, current_date);
INSERT INTO public.facilities
  (id, org_id, group_id, name, street, city, state, zip, is_active)
VALUES
  (${sqlLiteral(M64.facility)}, ${sqlLiteral(M64.org)}, ${sqlLiteral(M64.group)},
   ${sqlLiteral(`${runLabel} Facility`)}, '100 Synthetic Way', 'Albany', 'NY', '10001', TRUE);
INSERT INTO public.provider_facility_assignments
  (org_id, provider_id, facility_id, is_primary, start_date, practice_frequency)
VALUES
  (${sqlLiteral(M64.org)}, ${sqlLiteral(M64.provider)}, ${sqlLiteral(M64.facility)},
   TRUE, current_date, 'M64 synthetic primary facility');

-- These two typed configurations intentionally share one synthetic HTTPS URL.
-- MINT-48 clears proof on every fresh typed INSERT; each key receives its own
-- current-generation proof update after both independent maps exist.
INSERT INTO public.portals (
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, is_verified, last_verified_at, proven_at,
  mapping_generation
) VALUES
  (${sqlLiteral(M64.contractPortal)}, ${sqlLiteral(M64.org)}, 'm64_contract',
   ${sqlLiteral(`${runLabel} Contract Form`)}, ${sqlLiteral(M64.payer)},
   ${sqlLiteral(M64.formUrl)}, 'contract', TRUE, TRUE, now(), now(), 1),
  (${sqlLiteral(M64.enrollmentPortal)}, ${sqlLiteral(M64.org)}, 'm64_enrollment',
   ${sqlLiteral(`${runLabel} Enrollment Form`)}, ${sqlLiteral(M64.payer)},
   ${sqlLiteral(M64.formUrl)}, 'enrollment', TRUE, TRUE, now(), now(), 1);

INSERT INTO public.contracts (id, org_id, group_id, payer_id, state)
VALUES (
  ${sqlLiteral(M64.contract)}, ${sqlLiteral(M64.org)}, ${sqlLiteral(M64.group)},
  ${sqlLiteral(M64.payer)}, 'NY'
);
INSERT INTO public.credential_cases (
  id, org_id, provider_id, group_id, facility_id, payer_id, state, case_type, case_status, created_by
) VALUES (
  ${sqlLiteral(M64.enrollmentCase)}, ${sqlLiteral(M64.org)}, ${sqlLiteral(M64.provider)},
  ${sqlLiteral(M64.group)}, ${sqlLiteral(M64.facility)}, ${sqlLiteral(M64.payer)},
  'NY', 'enrollment', 'in_progress',
  ${sqlLiteral(userId)}
);
INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
VALUES (
  ${sqlLiteral(M64.org)}, ${sqlLiteral(M64.enrollmentCase)}, ${sqlLiteral(M64.facility)},
  TRUE, ${sqlLiteral(userId)}
);

INSERT INTO public.sop_templates (
  id, org_id, name, payer_id, state, states, group_id, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES
  (${sqlLiteral(M64.contractTemplate)}, ${sqlLiteral(M64.org)},
   ${sqlLiteral(`${runLabel} Contract SOP`)}, ${sqlLiteral(M64.payer)}, 'NY',
   ARRAY['NY']::text[], ${sqlLiteral(M64.group)},
   '[{"title":"Contract application","steps":[{"label":"Contract form","stepType":"online_form","portalKey":"m64_contract"}]}]'::jsonb,
   FALSE, 1, '[]'::jsonb, 'contract'),
  (${sqlLiteral(M64.enrollmentTemplate)}, ${sqlLiteral(M64.org)},
   ${sqlLiteral(`${runLabel} Enrollment SOP`)}, ${sqlLiteral(M64.payer)}, 'NY',
   ARRAY['NY']::text[], NULL,
   '[{"title":"Enrollment forms","steps":[{"label":"First form","stepType":"online_form","portalKey":"m64_enrollment"},{"label":"Second form","stepType":"online_form","portalKey":"m64_enrollment"}]},{"title":"Enrollment sibling","steps":[{"label":"Sibling form","stepType":"online_form","portalKey":"m64_enrollment"}]}]'::jsonb,
   FALSE, 1, '[]'::jsonb, 'enrollment');

INSERT INTO public.contract_sop_assignments (
  id, org_id, contract_id, sop_template_id, sop_version, context_version,
  created_by, updated_by
) VALUES (
  ${sqlLiteral(M64.contractAssignment)}, ${sqlLiteral(M64.org)}, ${sqlLiteral(M64.contract)},
  ${sqlLiteral(M64.contractTemplate)}, 1, 1, ${sqlLiteral(userId)}, ${sqlLiteral(userId)}
);
INSERT INTO public.tasks (
  id, org_id, case_id, provider_id, title, sop_content, status, sort_order,
  sop_template_id, sop_version, execution_type
) VALUES
  (${sqlLiteral(M64.enrollmentTask)}, ${sqlLiteral(M64.org)},
   ${sqlLiteral(M64.enrollmentCase)}, ${sqlLiteral(M64.provider)},
   ${sqlLiteral(`${runLabel} Enrollment Steps`)},
   jsonb_build_array(
     jsonb_build_object('id', ${sqlLiteral(M64.enrollmentStep1)}, 'label', 'First form',
       'stepType', 'online_form', 'portalKey', 'm64_enrollment', 'order', 0, 'isCompleted', FALSE),
     jsonb_build_object('id', ${sqlLiteral(M64.enrollmentStep2)}, 'label', 'Second form',
       'stepType', 'online_form', 'portalKey', 'm64_enrollment', 'order', 1, 'isCompleted', FALSE)
   ), 'not_started', 1, ${sqlLiteral(M64.enrollmentTemplate)}, 1, 'extension_fill'),
  (${sqlLiteral(M64.enrollmentSiblingTask)}, ${sqlLiteral(M64.org)},
   ${sqlLiteral(M64.enrollmentCase)}, ${sqlLiteral(M64.provider)},
   ${sqlLiteral(`${runLabel} Enrollment Sibling`)},
   jsonb_build_array(
     jsonb_build_object('id', ${sqlLiteral(M64.enrollmentSiblingStep)}, 'label', 'Sibling form',
       'stepType', 'online_form', 'portalKey', 'm64_enrollment', 'order', 0, 'isCompleted', FALSE)
   ), 'not_started', 2, ${sqlLiteral(M64.enrollmentTemplate)}, 1, 'extension_fill');

SET LOCAL minted.expected_mapping_generation = '1';
INSERT INTO public.portal_field_maps (
  org_id, portal_key, map_type, selector, source, field_type, status,
  notes, token, mapping_generation
) VALUES
  (${sqlLiteral(M64.org)}, 'm64_contract', 'web', '#contract-npi', 'token',
   'text', 'approved', ${sqlLiteral(`${runLabel} Contract map`)}, 'provider.npi', 1),
  (${sqlLiteral(M64.org)}, 'm64_enrollment', 'web', '#enrollment-npi', 'token',
   'text', 'approved', ${sqlLiteral(`${runLabel} Enrollment map`)}, 'provider.npi', 1);

UPDATE public.portals
   SET is_verified = TRUE, last_verified_at = now(), proven_at = now()
 WHERE id = ${sqlLiteral(M64.contractPortal)}
   AND org_id = ${sqlLiteral(M64.org)}
   AND portal_key = 'm64_contract'
   AND mapping_generation = 1;

UPDATE public.portals
   SET is_verified = TRUE, last_verified_at = now(), proven_at = now()
 WHERE id = ${sqlLiteral(M64.enrollmentPortal)}
   AND org_id = ${sqlLiteral(M64.org)}
   AND portal_key = 'm64_enrollment'
   AND mapping_generation = 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.portals
       WHERE id IN ('${M64.contractPortal}', '${M64.enrollmentPortal}')
         AND org_id = '${M64.org}'
         AND form_url = '${M64.formUrl}'
         AND requires_explicit_selection
         AND mapping_generation = 1) <> 2 THEN
    RAISE EXCEPTION 'M64 typed portal fixture is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.portals
     WHERE id = '${M64.contractPortal}' AND portal_key = 'm64_contract'
       AND case_type = 'contract' AND is_verified
       AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.portals
     WHERE id = '${M64.enrollmentPortal}' AND portal_key = 'm64_enrollment'
       AND case_type = 'enrollment' AND is_verified
       AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'M64 typed portal proofs are incomplete';
  END IF;
  IF (SELECT count(*) FROM public.portal_field_maps
       WHERE org_id = '${M64.org}' AND portal_key IN ('m64_contract', 'm64_enrollment')
         AND map_type = 'web' AND status = 'approved'
         AND token = 'provider.npi' AND mapping_generation = 1) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.portal_field_maps
        WHERE org_id = '${M64.org}' AND portal_key = 'm64_contract'
          AND selector = '#contract-npi'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.portal_field_maps
        WHERE org_id = '${M64.org}' AND portal_key = 'm64_enrollment'
          AND selector = '#enrollment-npi'
     ) THEN
    RAISE EXCEPTION 'M64 key-scoped map fixture is incorrect';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fill_sessions WHERE org_id = '${M64.org}')
     OR EXISTS (SELECT 1 FROM public.touches WHERE org_id = '${M64.org}') THEN
    RAISE EXCEPTION 'M64 fixture must not preseed receipts or touches';
  END IF;
END;
$$;

COMMIT;
`;
}

#!/usr/bin/env node
// Executable contract test for MINT-45 metadata and reset-receipt boundaries.
// It runs only against the disposable PostgreSQL database used by migration CI.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runPsql(sql, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure)
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`psql failed (${code}): ${stderr.trim()}`));
    });
    child.stdin.end(sql);
  });
}

async function expectSqlFailure(sql, fragment, label) {
  const result = await runPsql(sql, { allowFailure: true });
  assert(result.code !== 0, `${label}: expected SQL failure`);
  assert(result.stderr.includes(fragment), `${label}: expected ${fragment}, got ${result.stderr}`);
}

const idKeys = [
  "orgA",
  "orgB",
  "actorA",
  "actorB",
  "restrictedActor",
  "portalGlobal",
  "portalA",
  "portalB",
  "portalLegacy",
  "portalGlobalLegacy",
  "globalEvent",
  "orgAEvent",
  "orgBEvent",
  "serviceEvent",
  "idempotency",
  "providerA",
  "payerA",
  "caseEnrollment",
  "caseLegacy",
  "templateEnrollment",
  "templateLegacy",
];
const ids = Object.fromEntries(idKeys.map((key) => [key, randomUUID()]));
const portalKey = `mint45_${ids.orgA.replaceAll("-", "").slice(0, 16)}`;
const legacyKey = `${portalKey}_legacy`;
const selector = `#mint45-${ids.orgA.slice(0, 8)}`;

await runPsql(`
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO service_role;

INSERT INTO public.organizations (id, name) VALUES
  ('${ids.orgA}', 'MINT-45 disposable A ${ids.orgA}'),
  ('${ids.orgB}', 'MINT-45 disposable B ${ids.orgB}');
INSERT INTO auth.users (id, email) VALUES
  ('${ids.actorA}', 'mint45-${ids.actorA}@example.invalid'),
  ('${ids.actorB}', 'mint45-${ids.actorB}@example.invalid'),
  ('${ids.restrictedActor}', 'mint45-restricted-${ids.restrictedActor}@example.invalid');
INSERT INTO public.profiles (id, full_name) VALUES
  ('${ids.actorA}', 'MINT-45 actor A'),
  ('${ids.actorB}', 'MINT-45 actor B'),
  ('${ids.restrictedActor}', 'MINT-45 restricted actor')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.memberships (org_id, user_id, role) VALUES
  ('${ids.orgA}', '${ids.actorA}', 'admin'),
  ('${ids.orgB}', '${ids.actorB}', 'admin'),
  ('${ids.orgA}', '${ids.restrictedActor}', 'admin');
INSERT INTO private.client_identity_classifications (auth_user_id, org_id, email_normalized, state)
VALUES ('${ids.restrictedActor}', '${ids.orgA}', 'mint45-restricted-${ids.restrictedActor}@example.invalid', 'active');

-- Reconstruct typed portal rows written before MINT-48. Their marker and
-- payer state are historical fixture data, so bypass only the fresh-insert
-- stamper while inserting them; production guards remain enabled afterward.
ALTER TABLE public.portals DISABLE TRIGGER portals_guard_explicit_configuration_identity;
INSERT INTO public.portals (id, org_id, portal_key, name, case_type, requires_explicit_selection, mapping_generation) VALUES
  ('${ids.portalGlobal}', NULL, '${portalKey}', 'MINT-45 global', 'contract', true, 1),
  ('${ids.portalA}', '${ids.orgA}', '${portalKey}', 'MINT-45 org A', 'enrollment', false, 1),
  ('${ids.portalB}', '${ids.orgB}', '${portalKey}', 'MINT-45 org B', 'recredentialing', false, 1);
ALTER TABLE public.portals ENABLE TRIGGER portals_guard_explicit_configuration_identity;
INSERT INTO public.portals (id, org_id, portal_key, name)
VALUES ('${ids.portalLegacy}', '${ids.orgA}', '${legacyKey}', 'MINT-45 legacy defaults');
INSERT INTO public.portals (id, org_id, portal_key, name)
VALUES ('${ids.portalGlobalLegacy}', NULL, '${legacyKey}', 'MINT-44 legacy global');

INSERT INTO public.payers (id, org_id, name) VALUES
  ('${ids.payerA}', '${ids.orgA}', 'MINT-44 case-type guard payer');
INSERT INTO public.providers (id, org_id, first_name, last_name) VALUES
  ('${ids.providerA}', '${ids.orgA}', 'MINT-44', 'case-type guard');

INSERT INTO public.sop_templates
  (id, org_id, name, payer_id, state, states, task_definitions, case_type)
VALUES
  ('${ids.templateEnrollment}', '${ids.orgA}', 'MINT-44 typed guard template', '${ids.payerA}', 'CA', ARRAY['CA'], '[]'::jsonb, 'enrollment');
-- Reconstruct pre-MINT-44 legacy rows through the insert-only type guards.
ALTER TABLE public.sop_templates DISABLE TRIGGER sop_templates_guard_typed_insert;
INSERT INTO public.sop_templates
  (id, org_id, name, payer_id, state, states, task_definitions, case_type)
VALUES
  ('${ids.templateLegacy}', '${ids.orgA}', 'MINT-44 historical legacy guard template', '${ids.payerA}', 'NV', ARRAY['NV'], '[]'::jsonb, NULL);
ALTER TABLE public.sop_templates ENABLE TRIGGER sop_templates_guard_typed_insert;

INSERT INTO public.credential_cases (id, org_id, provider_id, payer_id, state, case_type) VALUES
  ('${ids.caseEnrollment}', '${ids.orgA}', '${ids.providerA}', '${ids.payerA}', 'CA', NULL);
-- Reconstruct a historical NULL case that predates the insert-only stamper.
ALTER TABLE public.credential_cases DISABLE TRIGGER credential_cases_stamp_case_type;
INSERT INTO public.credential_cases (id, org_id, provider_id, payer_id, state, case_type)
VALUES ('${ids.caseLegacy}', '${ids.orgA}', '${ids.providerA}', '${ids.payerA}', 'NV', NULL);
ALTER TABLE public.credential_cases ENABLE TRIGGER credential_cases_stamp_case_type;

INSERT INTO public.portal_field_maps (org_id, portal_key, map_type, selector, source, field_type, notes, shared_base_generation) VALUES
  (NULL, '${portalKey}', 'web', '${selector}', 'manual', 'text', 'MINT-45 disposable fixture', NULL),
  ('${ids.orgA}', '${portalKey}', 'web', '${selector}', 'manual', 'text', 'MINT-45 disposable fixture', 1);

INSERT INTO public.form_mapping_reset_events
  (id, portal_id, owner_scope, org_id, portal_key, old_mapping_generation, new_mapping_generation, actor_id, affected_field_count, idempotency_key)
VALUES
  ('${ids.globalEvent}', '${ids.portalGlobal}', 'global', NULL, '${portalKey}', 1, 2, '${ids.actorA}', 5, '${ids.idempotency}'),
  ('${ids.orgAEvent}', '${ids.portalA}', 'organization', '${ids.orgA}', '${portalKey}', 1, 2, '${ids.actorA}', 4, '${ids.idempotency}'),
  ('${ids.orgBEvent}', '${ids.portalB}', 'organization', '${ids.orgB}', '${portalKey}', 1, 2, '${ids.actorB}', 3, '${ids.idempotency}');
COMMIT;
`);
const defaults = await runPsql(`
SELECT (case_type IS NULL)::text || ',' || requires_explicit_selection::text || ',' || mapping_generation::text
  FROM public.portals WHERE id = '${ids.portalLegacy}';
SELECT mapping_generation::text || ',' || coalesce(shared_base_generation::text, 'null')
  FROM public.portal_field_maps WHERE org_id IS NULL AND portal_key = '${portalKey}' AND selector = '${selector}';
SELECT mapping_generation::text || ',' || coalesce(shared_base_generation::text, 'null')
  FROM public.portal_field_maps WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${selector}';
`);
assert(
  defaults.stdout === "true,false,1\n1,null\n1,1",
  `legacy portal/map generation defaults mismatch: ${defaults.stdout}`,
);

const guardFunctionGrants = await runPsql(`
SELECT has_function_privilege('anon', 'public.guard_credential_case_type_immutable()', 'EXECUTE')::text || ',' ||
       has_function_privilege('authenticated', 'public.guard_credential_case_type_immutable()', 'EXECUTE')::text || ',' ||
       has_function_privilege('service_role', 'public.guard_credential_case_type_immutable()', 'EXECUTE')::text || ',' ||
       has_function_privilege('anon', 'public.guard_org_portal_case_type_transition()', 'EXECUTE')::text || ',' ||
       has_function_privilege('authenticated', 'public.guard_org_portal_case_type_transition()', 'EXECUTE')::text || ',' ||
       has_function_privilege('service_role', 'public.guard_org_portal_case_type_transition()', 'EXECUTE')::text;
`);
assert(
  guardFunctionGrants.stdout === "false,false,false,false,false,false",
  `case-type trigger helpers must not be directly executable by API roles: ${guardFunctionGrants.stdout}`,
);

const ordinaryNoops = await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
UPDATE public.portals SET name = 'MINT-45 org A edited', case_type = case_type
 WHERE id = '${ids.portalA}' RETURNING 'org-portal-edit';
UPDATE public.credential_cases SET specialty = 'Occupational Therapy', case_type = case_type
 WHERE id = '${ids.caseEnrollment}' RETURNING 'typed-case-edit';
RESET ROLE;
`);
assert(
  ordinaryNoops.stdout === "org-portal-edit\ntyped-case-edit",
  `ordinary edits/no-op type writes should work: ${ordinaryNoops.stdout}`,
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.credential_cases SET case_type = NULL WHERE id = '${ids.caseEnrollment}';`,
  "credential_case_type_immutable",
  "typed case downgrade to legacy NULL",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.credential_cases SET case_type = 'recredentialing' WHERE id = '${ids.caseEnrollment}';`,
  "credential_case_type_immutable",
  "typed case reclassification",
);
await expectSqlFailure(
  `SET ROLE service_role; UPDATE public.credential_cases SET case_type = NULL WHERE id = '${ids.caseEnrollment}';`,
  "credential_case_type_immutable",
  "service-role typed case downgrade",
);
const stampedCaseType = await runPsql(
  `SELECT coalesce(case_type, 'null') FROM public.credential_cases WHERE id = '${ids.caseEnrollment}';`,
);
assert(
  stampedCaseType.stdout === "enrollment",
  `failed case reclassification attempts must leave Enrollment stamped: ${stampedCaseType.stdout}`,
);

const typedSopReplacement = await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
SELECT public.replace_unstarted_case_sop(
  '${ids.orgA}', '${ids.caseEnrollment}', '${ids.templateEnrollment}', 1, '[]'::jsonb
);
RESET ROLE;
`);
assert(
  typedSopReplacement.stdout === "0",
  `typed case should still accept a matching typed SOP replacement: ${typedSopReplacement.stdout}`,
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; SELECT public.replace_unstarted_case_sop('${ids.orgA}', '${ids.caseEnrollment}', '${ids.templateLegacy}', 1, '[]'::jsonb);`,
  "case_sop_template_ineligible",
  "legacy SOP replacement after denied typed-case downgrade",
);

await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
UPDATE public.credential_cases SET specialty = 'Family Medicine', case_type = case_type
 WHERE id = '${ids.caseLegacy}';
RESET ROLE;
`);
const legacyCaseType = await runPsql(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; SELECT coalesce(case_type, 'null') FROM public.credential_cases WHERE id = '${ids.caseLegacy}'; RESET ROLE;`,
);
assert(
  legacyCaseType.stdout === "null",
  `authenticated users should still read a historical NULL case after a no-op update: ${legacyCaseType.stdout}`,
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.credential_cases SET case_type = 'enrollment' WHERE id = '${ids.caseLegacy}';`,
  "credential_case_type_immutable",
  "historical case reclassification",
);
const legacySopReplacement = await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
SELECT public.replace_unstarted_case_sop(
  '${ids.orgA}', '${ids.caseLegacy}', '${ids.templateLegacy}', 1, '[]'::jsonb
);
RESET ROLE;
`);
assert(
  legacySopReplacement.stdout === "0",
  `historical NULL case should retain legacy SOP replacement: ${legacySopReplacement.stdout}`,
);

await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portals SET case_type = 'contract' WHERE id = '${ids.portalA}';`,
  "org_portal_case_type_immutable",
  "typed org portal reclassification",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portals SET case_type = NULL WHERE id = '${ids.portalA}';`,
  "org_portal_case_type_immutable",
  "typed org portal clear",
);
await expectSqlFailure(
  `SET ROLE service_role; UPDATE public.portals SET case_type = NULL WHERE id = '${ids.portalA}';`,
  "permission denied",
  "service-role portal updates remain ungranted",
);
const legacyPortalClassification = await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
UPDATE public.portals SET case_type = case_type, name = 'MINT-45 legacy portal edited'
 WHERE id = '${ids.portalLegacy}' RETURNING 'legacy-portal-edit';
UPDATE public.portals SET case_type = 'enrollment'
 WHERE id = '${ids.portalLegacy}' RETURNING 'legacy-portal-classified';
RESET ROLE;
`);
assert(
  legacyPortalClassification.stdout === "legacy-portal-edit\nlegacy-portal-classified",
  `legacy org portal should allow ordinary edits and first classification: ${legacyPortalClassification.stdout}`,
);
const classifiedPortalType = await runPsql(
  `SELECT coalesce(case_type, 'null') FROM public.portals WHERE id = '${ids.portalLegacy}';`,
);
assert(
  classifiedPortalType.stdout === "enrollment",
  `first legacy portal classification should persist: ${classifiedPortalType.stdout}`,
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portals SET case_type = 'recredentialing' WHERE id = '${ids.portalLegacy}';`,
  "org_portal_case_type_immutable",
  "classified org portal reclassification",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portals SET case_type = NULL WHERE id = '${ids.portalLegacy}';`,
  "org_portal_case_type_immutable",
  "classified org portal clear",
);

const globalPortalUpdate = await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
SELECT (public.upsert_global_portal(
  '${ids.portalGlobal}', 'MINT-45 global edited', '${portalKey}', NULL, NULL, NULL
)).case_type;
RESET ROLE;
`);
assert(
  globalPortalUpdate.stdout === "contract",
  `global portal RPC should preserve the existing typed value when case_type is omitted: ${globalPortalUpdate.stdout}`,
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; SELECT public.upsert_global_portal('${ids.portalGlobalLegacy}', 'MINT-44 legacy global', '${legacyKey}', NULL, NULL, 'enrollment');`,
  "global_portal_case_type_immutable",
  "existing global NULL-to-Enrollment upsert behavior",
);

await expectSqlFailure(
  `INSERT INTO public.portals (org_id, payer_id, portal_key, name, case_type) VALUES ('${ids.orgA}', '${ids.payerA}', '${legacyKey}_bad', 'bad', 'other');`,
  "portals_case_type_check",
  "closed case_type set",
);
await expectSqlFailure(
  `INSERT INTO public.portal_field_maps (org_id, portal_key, map_type, selector, source, field_type, notes) VALUES ('${ids.orgA}', '${portalKey}', 'web', '${selector}', 'manual', 'text', 'duplicate test');`,
  "duplicate key",
  "same-tier selector uniqueness",
);

await expectSqlFailure(
  `INSERT INTO public.form_mapping_reset_events (portal_id, owner_scope, org_id, portal_key, old_mapping_generation, new_mapping_generation, actor_id, affected_field_count, idempotency_key) VALUES ('${ids.portalGlobal}', 'organization', '${ids.orgA}', '${portalKey}', 1, 2, '${ids.actorA}', 0, '${randomUUID()}');`,
  "form_mapping_reset_scope_mismatch",
  "portal scope trigger (runs before the table CHECK)",
);
await expectSqlFailure(
  `INSERT INTO public.form_mapping_reset_events (portal_id, owner_scope, org_id, portal_key, old_mapping_generation, new_mapping_generation, actor_id, affected_field_count, idempotency_key) VALUES ('${ids.portalA}', 'organization', '${ids.orgA}', '${portalKey}_wrong', 1, 2, '${ids.actorA}', 0, '${randomUUID()}');`,
  "form_mapping_reset_scope_mismatch",
  "portal key/scope consistency trigger",
);
await expectSqlFailure(
  `INSERT INTO public.form_mapping_reset_events (portal_id, owner_scope, org_id, portal_key, old_mapping_generation, new_mapping_generation, actor_id, affected_field_count, idempotency_key) VALUES ('${ids.portalGlobal}', 'global', NULL, '${portalKey}', 1, 2, '${ids.actorA}', 0, '${ids.idempotency}');`,
  "duplicate key",
  "global idempotency replay",
);
await expectSqlFailure(
  `INSERT INTO public.form_mapping_reset_events (portal_id, owner_scope, org_id, portal_key, old_mapping_generation, new_mapping_generation, actor_id, affected_field_count, idempotency_key) VALUES ('${ids.portalA}', 'organization', '${ids.orgA}', '${portalKey}', 1, 2, '${ids.actorA}', 0, '${ids.idempotency}');`,
  "duplicate key",
  "organization idempotency replay",
);

const rls = await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
SELECT count(*)::text FROM public.form_mapping_reset_events WHERE portal_key = '${portalKey}';
RESET ROLE;
`);
assert(
  rls.stdout === "2",
  `authenticated RLS should expose global + own-org receipt only; got ${rls.stdout}`,
);

const restrictedRls = await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.restrictedActor}';
SELECT count(*) FILTER (WHERE owner_scope = 'global')::text || ',' ||
       count(*) FILTER (WHERE owner_scope = 'organization')::text
  FROM public.form_mapping_reset_events WHERE portal_key = '${portalKey}';
RESET ROLE;
`);
assert(
  restrictedRls.stdout === "0,1",
  `restricted identity should see own-org receipt but no global receipt; got ${restrictedRls.stdout}`,
);

const grants = await runPsql(`
SELECT has_table_privilege('anon', 'public.form_mapping_reset_events', 'SELECT')::text || ',' ||
       has_table_privilege('authenticated', 'public.form_mapping_reset_events', 'SELECT')::text || ',' ||
       has_table_privilege('authenticated', 'public.form_mapping_reset_events', 'INSERT')::text || ',' ||
       has_table_privilege('authenticated', 'public.form_mapping_reset_events', 'UPDATE')::text || ',' ||
       has_table_privilege('authenticated', 'public.form_mapping_reset_events', 'DELETE')::text || ',' ||
       has_table_privilege('service_role', 'public.form_mapping_reset_events', 'SELECT')::text || ',' ||
       has_table_privilege('service_role', 'public.form_mapping_reset_events', 'INSERT')::text || ',' ||
       has_table_privilege('service_role', 'public.form_mapping_reset_events', 'UPDATE')::text || ',' ||
       has_table_privilege('service_role', 'public.form_mapping_reset_events', 'DELETE')::text;
`);
assert(
  grants.stdout === "false,true,false,false,false,true,true,false,false",
  `receipt grants mismatch: ${grants.stdout}`,
);

await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portals SET mapping_generation = 2 WHERE id = '${ids.portalA}';`,
  "mapping_generation_change_requires_definer",
  "ordinary portal generation bump",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portals SET mapping_generation = 0 WHERE id = '${ids.portalA}';`,
  "mapping_generation_change_requires_definer",
  "ordinary portal generation decrease",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portal_field_maps SET mapping_generation = 2 WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${selector}';`,
  "mapping_generation_change_requires_definer",
  "ordinary map generation bump",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portal_field_maps SET mapping_generation = 0 WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${selector}';`,
  "mapping_generation_change_requires_definer",
  "ordinary map generation decrease",
);
// Simulate a trusted reset advancing the generation, then prove an ordinary
// org writer cannot roll either portal or map metadata back to the old value.
await runPsql(`UPDATE public.portals SET mapping_generation = 2 WHERE id = '${ids.portalA}';`);
await runPsql(
  `UPDATE public.portal_field_maps SET mapping_generation = 2 WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${selector}';`,
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portals SET mapping_generation = 1 WHERE id = '${ids.portalA}';`,
  "mapping_generation_change_requires_definer",
  "ordinary portal generation rollback after trusted advance",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portal_field_maps SET mapping_generation = 1 WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${selector}';`,
  "mapping_generation_change_requires_definer",
  "ordinary map generation rollback after trusted advance",
);
await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; UPDATE public.portal_field_maps SET shared_base_generation = 42 WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${selector}';`,
  "shared_base_generation_requires_review",
  "ordinary shared-base self-certification",
);

const stampedOrgOverride = `${selector}-new-org-override`;
await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
INSERT INTO public.portal_field_maps
  (org_id, portal_key, map_type, selector, source, field_type, notes, shared_base_generation)
VALUES
  ('${ids.orgA}', '${portalKey}', 'web', '${stampedOrgOverride}', 'manual', 'text', 'MINT-45 stamped override test', 42);
RESET ROLE;
`);
const stampedBase = await runPsql(`
SELECT coalesce(shared_base_generation::text, 'null')
  FROM public.portal_field_maps
 WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${stampedOrgOverride}';
`);
assert(
  stampedBase.stdout === "1",
  `new org override should inherit shared generation 1 instead of caller value 42; got ${stampedBase.stdout}`,
);
const unstampedOrgOverride = `${selector}-new-org-override-null`;
await runPsql(`
SET ROLE authenticated;
SET request.jwt.claim.sub = '${ids.actorA}';
INSERT INTO public.portal_field_maps
  (org_id, portal_key, map_type, selector, source, field_type, notes, shared_base_generation)
VALUES
  ('${ids.orgA}', '${portalKey}', 'web', '${unstampedOrgOverride}', 'manual', 'text', 'MINT-45 explicit NULL stamp test', NULL);
RESET ROLE;
`);
const unstampedBase = await runPsql(`
SELECT coalesce(shared_base_generation::text, 'null')
  FROM public.portal_field_maps
 WHERE org_id = '${ids.orgA}' AND portal_key = '${portalKey}' AND selector = '${unstampedOrgOverride}';
`);
assert(
  unstampedBase.stdout === "1",
  `new org override must not bypass trusted stamping by explicitly supplying NULL; got ${unstampedBase.stdout}`,
);

// A trusted service_role INSERT succeeds only after the scope trigger verifies
// the portal identity and key against the persisted portal row.
await runPsql(`
SET ROLE service_role;
INSERT INTO public.form_mapping_reset_events
  (id, portal_id, owner_scope, org_id, portal_key, old_mapping_generation, new_mapping_generation, actor_id, affected_field_count, idempotency_key)
VALUES ('${ids.serviceEvent}', '${ids.portalGlobal}', 'global', NULL, '${portalKey}', 2, 3, '${ids.actorA}', 5, '${randomUUID()}');
RESET ROLE;
`);

await expectSqlFailure(
  `SET ROLE authenticated; SET request.jwt.claim.sub = '${ids.actorA}'; INSERT INTO public.form_mapping_reset_events (portal_id, owner_scope, org_id, portal_key, old_mapping_generation, new_mapping_generation, actor_id, affected_field_count, idempotency_key) VALUES ('${ids.portalGlobal}', 'global', NULL, '${portalKey}', 2, 3, '${ids.actorA}', 0, '${randomUUID()}');`,
  "permission denied",
  "authenticated receipt insert",
);
await expectSqlFailure(
  `UPDATE public.form_mapping_reset_events SET affected_field_count = 99 WHERE id = '${ids.globalEvent}';`,
  "form_mapping_reset_events_are_append_only",
  "append-only update trigger",
);
await expectSqlFailure(
  `DELETE FROM public.form_mapping_reset_events WHERE id = '${ids.globalEvent}';`,
  "form_mapping_reset_events_are_append_only",
  "append-only delete trigger",
);

console.log("MINT-44/45 case-type and mapping metadata security contracts verified.");

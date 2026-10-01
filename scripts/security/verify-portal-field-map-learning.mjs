#!/usr/bin/env node
// Executable contract test for the flywheel migration/RPC on a disposable
// PostgreSQL 16 database. It uses psql only; no hosted credentials or network.
// The CI migrations job invokes this after replaying the repository migrations.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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

function mapping(selector, token = "provider.npi", confidence = 0.91) {
  return { selector, token, confidence, field_type: "text" };
}

function rpcSql(ids, actorId, options = {}) {
  const portalKey = options.portalKey ?? ids.portalKey;
  const caseId = options.caseId ?? ids.caseId;
  const providerId = options.providerId ?? ids.providerId;
  const fillSessionId = options.fillSessionId ?? ids.fillSessionId;
  const urlPattern = options.urlPattern ?? "https://portal.example/forms/application";
  const mappings = options.mappings ?? [mapping("#flywheel-single")];
  const expectedMappingGeneration = options.expectedMappingGeneration;
  const generationArgument =
    expectedMappingGeneration === undefined ? "" : `, ${expectedMappingGeneration}`;
  return `SET ROLE service_role;
SELECT public.learn_portal_field_maps_from_touch(
  ${sqlText(ids.orgId)}::uuid, ${sqlText(actorId)}::uuid,
  ${sqlText(caseId)}::uuid, ${sqlText(providerId)}::uuid,
  ${sqlText(fillSessionId)}::uuid, ${sqlText(portalKey)},
  ${sqlText(urlPattern)}, ${sqlText(JSON.stringify(mappings))}::jsonb${generationArgument}
)::text;
RESET ROLE;`;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label}: RPC did not return JSON`);
  }
}

const ids = Object.fromEntries(
  [
    "orgId",
    "otherOrgId",
    "actorId",
    "otherActorId",
    "billingActorId",
    "specialistId",
    "providerId",
    "otherProviderId",
    "payerId",
    "otherPayerId",
    "caseId",
    "otherCaseId",
    "fillSessionId",
    "specialistFillId",
    "unsubmittedFillId",
    "touchId",
    "specialistTouchId",
  ].map((key) => [key, randomUUID()]),
);
ids.portalKey = `flywheel_${ids.orgId.replaceAll("-", "").slice(0, 18)}`;
ids.generationPortalKey = `generation_${ids.orgId.replaceAll("-", "").slice(0, 18)}`;
ids.siblingPortalKey = `${ids.generationPortalKey}_sibling`;
ids.generationFillId = randomUUID();
ids.generationTouchId = randomUUID();
const concurrentSelector = `#flywheel-concurrent-${ids.orgId.slice(0, 8)}`;

let seeded = false;
try {
  await runPsql(`
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON public.memberships, public.credential_cases, public.fill_sessions, public.touches, public.portal_field_maps, public.portals, public.audit_log TO service_role;
GRANT INSERT ON public.portal_field_maps, public.audit_log TO service_role;
GRANT EXECUTE ON FUNCTION public.get_sop_field_tokens() TO service_role;

INSERT INTO public.organizations (id, name) VALUES
  ('${ids.orgId}', 'Flywheel disposable ${ids.orgId}'),
  ('${ids.otherOrgId}', 'Flywheel foreign ${ids.otherOrgId}');
INSERT INTO auth.users (id, email) VALUES
  ('${ids.actorId}', 'flywheel-${ids.actorId}@example.invalid'),
  ('${ids.otherActorId}', 'flywheel-${ids.otherActorId}@example.invalid'),
  ('${ids.billingActorId}', 'flywheel-${ids.billingActorId}@example.invalid'),
  ('${ids.specialistId}', 'flywheel-${ids.specialistId}@example.invalid');
INSERT INTO public.profiles (id, full_name) VALUES
  ('${ids.actorId}', 'Flywheel Test Admin'),
  ('${ids.otherActorId}', 'Flywheel Foreign Admin'),
  ('${ids.billingActorId}', 'Flywheel Test Billing'),
  ('${ids.specialistId}', 'Flywheel Test Specialist');
INSERT INTO public.memberships (org_id, user_id, role) VALUES
  ('${ids.orgId}', '${ids.actorId}', 'admin'),
  ('${ids.otherOrgId}', '${ids.otherActorId}', 'admin'),
  ('${ids.orgId}', '${ids.billingActorId}', 'billing'),
  ('${ids.orgId}', '${ids.specialistId}', 'specialist');
INSERT INTO public.providers (id, org_id, first_name, last_name) VALUES
  ('${ids.providerId}', '${ids.orgId}', 'Synthetic', 'Provider'),
  ('${ids.otherProviderId}', '${ids.otherOrgId}', 'Foreign', 'Provider');
INSERT INTO public.payers (id, org_id, name) VALUES
  ('${ids.payerId}', '${ids.orgId}', 'Synthetic Flywheel Payer'),
  ('${ids.otherPayerId}', '${ids.otherOrgId}', 'Foreign Flywheel Payer');
INSERT INTO public.credential_cases (id, org_id, provider_id, payer_id, state) VALUES
  ('${ids.caseId}', '${ids.orgId}', '${ids.providerId}', '${ids.payerId}', 'KS'),
  ('${ids.otherCaseId}', '${ids.otherOrgId}', '${ids.otherProviderId}', '${ids.otherPayerId}', 'CO');
INSERT INTO public.portals (org_id, portal_key, name, form_url, mapping_generation) VALUES
  (NULL, '${ids.portalKey}', 'Synthetic shared legacy flywheel portal', 'https://portal.example/forms/application', 1),
  ('${ids.orgId}', '${ids.portalKey}', 'Synthetic org legacy flywheel portal', 'https://portal.example/forms/application', 1),
  (NULL, '${ids.generationPortalKey}', 'Synthetic shared generation portal', 'https://portal.example/forms/application', 4),
  ('${ids.orgId}', '${ids.generationPortalKey}', 'Synthetic org generation portal', 'https://portal.example/forms/application', 3),
  ('${ids.otherOrgId}', '${ids.generationPortalKey}', 'Synthetic foreign generation portal', 'https://portal.example/forms/application', 7),
  ('${ids.orgId}', '${ids.siblingPortalKey}', 'Synthetic same-URL sibling portal', 'https://portal.example/forms/application', 1);
INSERT INTO public.fill_sessions
  (id, org_id, case_id, provider_id, portal_key, fill_mode, completed_at, fields_filled, performed_by, is_test)
VALUES
  ('${ids.fillSessionId}', '${ids.orgId}', '${ids.caseId}', '${ids.providerId}', '${ids.portalKey}', 'web', now(), 1, '${ids.actorId}', false),
  ('${ids.generationFillId}', '${ids.orgId}', '${ids.caseId}', '${ids.providerId}', '${ids.generationPortalKey}', 'web', now(), 1, '${ids.actorId}', false),
  ('${ids.specialistFillId}', '${ids.orgId}', '${ids.caseId}', '${ids.providerId}', '${ids.portalKey}', 'web', now(), 1, '${ids.specialistId}', false),
  ('${ids.unsubmittedFillId}', '${ids.orgId}', '${ids.caseId}', '${ids.providerId}', '${ids.portalKey}', 'web', now(), 1, '${ids.actorId}', false);
INSERT INTO public.touches
  (id, org_id, case_id, touch_date, entry_type, touch_type, outcome, coordinator_id, source)
VALUES
  ('${ids.touchId}', '${ids.orgId}', '${ids.caseId}', current_date, 'touchpoint', 'portal', 'submitted', '${ids.actorId}', 'extension'),
  ('${ids.generationTouchId}', '${ids.orgId}', '${ids.caseId}', current_date, 'touchpoint', 'portal', 'submitted', '${ids.actorId}', 'extension'),
  ('${ids.specialistTouchId}', '${ids.orgId}', '${ids.caseId}', current_date, 'touchpoint', 'portal', 'submitted', '${ids.specialistId}', 'extension');
INSERT INTO public.audit_log
  (org_id, user_id, action_type, entity_type, entity_id, after, description)
VALUES
  ('${ids.orgId}', '${ids.actorId}', 'TOUCH_LOGGED', 'touch', '${ids.touchId}',
   jsonb_build_object('caseId','${ids.caseId}','portalKey','${ids.portalKey}','fillSessionId','${ids.fillSessionId}','touchType','portal','outcome','submitted','source','extension'), 'Synthetic fixture'),
  ('${ids.orgId}', '${ids.actorId}', 'TOUCH_LOGGED', 'touch', '${ids.generationTouchId}',
   jsonb_build_object('caseId','${ids.caseId}','portalKey','${ids.generationPortalKey}','fillSessionId','${ids.generationFillId}','touchType','portal','outcome','submitted','source','extension'), 'Synthetic generation fixture'),
  ('${ids.orgId}', '${ids.specialistId}', 'TOUCH_LOGGED', 'touch', '${ids.specialistTouchId}',
   jsonb_build_object('caseId','${ids.caseId}','portalKey','${ids.portalKey}','fillSessionId','${ids.specialistFillId}','touchType','portal','outcome','submitted','source','extension'), 'Synthetic fixture');
COMMIT;
`);
  seeded = true;

  const grantChecks = await runPsql(`
SELECT has_function_privilege('anon', 'public.learn_portal_field_maps_from_touch(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')::text || ',' ||
       has_function_privilege('authenticated', 'public.learn_portal_field_maps_from_touch(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')::text || ',' ||
       has_function_privilege('service_role', 'public.learn_portal_field_maps_from_touch(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')::text || ',' ||
       (SELECT prosecdef::text FROM pg_proc WHERE oid = 'public.learn_portal_field_maps_from_touch(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure) || ',' ||
       (SELECT rolbypassrls::text FROM pg_roles WHERE rolname = 'service_role');
`);
  assert(
    grantChecks.stdout === "false,false,true,false,true",
    `role boundary mismatch: ${grantChecks.stdout}`,
  );

  const first = parseJsonOutput(await runPsql(rpcSql(ids, ids.actorId)), "first write");
  assert(
    first.kind === "ok" && first.inserted_count === 1 && first.confirmed_saved_count === 1,
    "first write was not inserted and confirmed",
  );
  const replay = parseJsonOutput(await runPsql(rpcSql(ids, ids.actorId)), "replay");
  assert(
    replay.kind === "ok" && replay.inserted_count === 0 && replay.confirmed_saved_count === 1,
    "replay count was not idempotent",
  );

  const foreignActor = parseJsonOutput(
    await runPsql(rpcSql(ids, ids.otherActorId, { mappings: [mapping("#foreign-actor")] })),
    "foreign actor",
  );
  assert(foreignActor.reason === "not_authorized", "foreign actor was not denied");
  const billing = parseJsonOutput(
    await runPsql(rpcSql(ids, ids.billingActorId, { mappings: [mapping("#billing")] })),
    "billing role",
  );
  assert(billing.reason === "not_authorized", "billing role was not denied");
  const foreignCase = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        caseId: ids.otherCaseId,
        providerId: ids.otherProviderId,
        mappings: [mapping("#foreign-case")],
      }),
    ),
    "foreign case",
  );
  assert(foreignCase.reason === "case_not_found", "foreign case/provider pair was not denied");
  const wrongFill = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        fillSessionId: ids.specialistFillId,
        mappings: [mapping("#wrong-fill")],
      }),
    ),
    "wrong actor fill",
  );
  assert(
    wrongFill.reason === "fill_not_found",
    "fill session owned by another actor was not denied",
  );
  const missingTouch = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        fillSessionId: ids.unsubmittedFillId,
        mappings: [mapping("#missing-touch")],
      }),
    ),
    "missing touch",
  );
  assert(missingTouch.reason === "submission_not_found", "unsubmitted session was not denied");

  const invalidToken = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, { mappings: [mapping("#bad-token", "provider.notAField")] }),
    ),
    "invalid catalog token",
  );
  assert(
    invalidToken.reason === "invalid_token",
    "token outside get_sop_field_tokens() was accepted",
  );
  const invalidTail = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        mappings: [
          mapping("#valid-first-in-invalid-batch"),
          mapping("#invalid-tail", "provider.notAField"),
        ],
      }),
    ),
    "invalid tail batch",
  );
  assert(invalidTail.reason === "invalid_token", "invalid tail mapping was not rejected");
  const noPartialBatch = await runPsql(`
SELECT count(*) FROM public.portal_field_maps
WHERE org_id='${ids.orgId}' AND portal_key='${ids.portalKey}' AND selector='#valid-first-in-invalid-batch';
`);
  assert(
    noPartialBatch.stdout === "0",
    "rejected batch partially inserted an earlier valid mapping",
  );
  const ssnToken = parseJsonOutput(
    await runPsql(rpcSql(ids, ids.actorId, { mappings: [mapping("#ssn", "provider.ssnLast4")] })),
    "SSN token",
  );
  assert(ssnToken.reason === "invalid_token", "SSN token was accepted");
  const lowConfidence = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, { mappings: [mapping("#low-confidence", "provider.npi", 0.84)] }),
    ),
    "low confidence",
  );
  assert(lowConfidence.reason === "invalid_confidence", "confidence below 0.85 was accepted");
  const duplicateSelector = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        mappings: [mapping("#duplicate"), mapping("#duplicate", "provider.firstName")],
      }),
    ),
    "duplicate selector",
  );
  assert(
    duplicateSelector.reason === "duplicate_selector",
    "duplicate selector batch was accepted",
  );
  const unsafeUrl = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        urlPattern: "https://portal.example/forms?patient=secret",
        mappings: [mapping("#unsafe-url")],
      }),
    ),
    "unsafe URL scope",
  );
  assert(unsafeUrl.reason === "invalid_scope", "query-bearing URL scope was accepted by SQL");

  await runPsql(`
INSERT INTO public.portal_field_maps (org_id, portal_key, map_type, selector, source, token, field_type, status, notes)
VALUES
  ('${ids.orgId}', '${ids.portalKey}', 'web', '#existing-org', 'token', 'provider.npi', 'text', 'approved', NULL),
  (NULL, '${ids.portalKey}', 'web', '#existing-global', 'token', 'provider.npi', 'text', 'approved', NULL),
  ('${ids.orgId}', '${ids.portalKey}', 'web', '#retired', 'token', 'provider.npi', 'text', 'retired', NULL),
  ('${ids.orgId}', '${ids.portalKey}', 'web', '#proposed', 'manual', NULL, 'text', 'proposed', 'Synthetic proposed fixture');
INSERT INTO public.portal_field_maps (org_id, portal_key, map_type, selector, source, token, field_type, status)
VALUES
  ('${ids.orgId}', '${ids.portalKey}', 'web', '#conflict', 'token', 'provider.firstName', 'text', 'approved');
`);
  const preserved = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        mappings: [
          mapping("#existing-org"),
          mapping("#existing-global"),
          mapping("#retired"),
          mapping("#proposed"),
          mapping("#conflict"),
          mapping("#new-after-preserve"),
        ],
      }),
    ),
    "existing mapping preservation",
  );
  assert(
    preserved.kind === "ok" &&
      preserved.inserted_count === 1 &&
      preserved.confirmed_saved_count === 3 &&
      preserved.preserved_count === 3,
    "existing org/global/retired/proposed/conflicting rows were not preserved with honest counts",
  );
  const preservedRows = await runPsql(`
SELECT string_agg(selector || ':' || status || ':' || COALESCE(token,'null'), ',' ORDER BY selector)
FROM public.portal_field_maps WHERE portal_key = '${ids.portalKey}'
  AND selector IN ('#existing-org','#existing-global','#retired','#proposed','#conflict');
`);
  assert(
    preservedRows.stdout ===
      "#conflict:approved:provider.firstName,#existing-global:approved:provider.npi,#existing-org:approved:provider.npi,#proposed:proposed:null,#retired:retired:provider.npi",
    `existing mapping decisions changed: ${preservedRows.stdout}`,
  );

  await runPsql(`
INSERT INTO public.portal_field_maps (org_id, portal_key, map_type, selector, source, token, field_type, status)
VALUES
  (NULL, '${ids.portalKey}', 'web', '#tier-org-match', 'token', 'provider.firstName', 'text', 'approved'),
  ('${ids.orgId}', '${ids.portalKey}', 'web', '#tier-org-match', 'token', 'provider.npi', 'text', 'approved'),
  (NULL, '${ids.portalKey}', 'web', '#tier-org-conflict', 'token', 'provider.npi', 'text', 'approved'),
  ('${ids.orgId}', '${ids.portalKey}', 'web', '#tier-org-conflict', 'token', 'provider.firstName', 'text', 'approved'),
  (NULL, '${ids.portalKey}', 'web', '#tier-shared-only', 'token', 'provider.npi', 'text', 'approved');
`);
  const tierPrecedence = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        mappings: [
          mapping("#tier-org-match", "provider.npi"),
          mapping("#tier-org-conflict", "provider.npi"),
          mapping("#tier-shared-only", "provider.npi"),
        ],
      }),
    ),
    "org-over-shared precedence",
  );
  assert(
    tierPrecedence.kind === "ok" &&
      tierPrecedence.inserted_count === 0 &&
      tierPrecedence.confirmed_saved_count === 2 &&
      tierPrecedence.preserved_count === 1,
    "org rows did not take precedence over shared rows with accurate confirmation/preservation counts",
  );
  const tierResults = new Map(
    (tierPrecedence.results ?? []).map((result) => [result.selector, result]),
  );
  assert(
    tierResults.get("#tier-org-match")?.token === "provider.npi" &&
      tierResults.get("#tier-org-match")?.outcome === "already_present" &&
      tierResults.get("#tier-org-conflict")?.token === "provider.npi" &&
      tierResults.get("#tier-org-conflict")?.outcome === "preserved" &&
      tierResults.get("#tier-shared-only")?.token === "provider.npi" &&
      tierResults.get("#tier-shared-only")?.outcome === "already_present",
    `tier lookup returned unexpected per-selector outcomes: ${JSON.stringify(tierPrecedence.results)}`,
  );
  const tierRows = await runPsql(`
SELECT string_agg(COALESCE(org_id::text, 'shared') || ':' || selector || ':' || token, ',' ORDER BY selector, org_id NULLS LAST)
FROM public.portal_field_maps
WHERE portal_key = '${ids.portalKey}' AND selector IN ('#tier-org-match','#tier-org-conflict','#tier-shared-only');
`);
  assert(
    tierRows.stdout ===
      `${ids.orgId}:#tier-org-conflict:provider.firstName,shared:#tier-org-conflict:provider.npi,${ids.orgId}:#tier-org-match:provider.npi,shared:#tier-org-match:provider.firstName,shared:#tier-shared-only:provider.npi`,
    `tier lookup modified or selected the wrong map rows: ${tierRows.stdout}`,
  );

  // Reconstruct retained pre-reset mappings, then simulate trusted resets of
  // the exact global and org configurations. The learning RPC must use only
  // the new generations and current shared base; stale same-tier selectors
  // remain stored for review because the per-tier unique index still owns them.
  await runPsql(`
-- Seed pre-reset rows in their historical generation. Only this test fixture
-- bypasses the map write guard; production writes must carry the generation.
ALTER TABLE public.portal_field_maps DISABLE TRIGGER portal_field_maps_generation_write_guard;
INSERT INTO public.portal_field_maps
  (org_id, portal_key, map_type, selector, source, token, field_type, status, mapping_generation)
VALUES
  (NULL, '${ids.generationPortalKey}', 'web', '#stale-global', 'token', 'provider.npi', 'text', 'approved', 4),
  ('${ids.orgId}', '${ids.generationPortalKey}', 'web', '#stale-org-generation', 'token', 'provider.npi', 'text', 'approved', 2),
  ('${ids.orgId}', '${ids.generationPortalKey}', 'web', '#stale-org-base', 'token', 'provider.npi', 'text', 'approved', 4),
  ('${ids.orgId}', '${ids.siblingPortalKey}', 'web', '#sibling-only', 'token', 'provider.npi', 'text', 'approved', 1);
ALTER TABLE public.portal_field_maps ENABLE TRIGGER portal_field_maps_generation_write_guard;

-- A test-only trusted reset simulation; production generations remain guarded.
SELECT set_config('minted.mapping_reset', 'true', false);
SELECT set_config('minted.expected_mapping_generation', '4', false);
UPDATE public.portals SET mapping_generation = 5
 WHERE org_id IS NULL AND portal_key = '${ids.generationPortalKey}';
SELECT set_config('minted.expected_mapping_generation', '3', false);
UPDATE public.portals SET mapping_generation = 4
 WHERE org_id = '${ids.orgId}' AND portal_key = '${ids.generationPortalKey}';
SELECT set_config('minted.mapping_reset', '', false);
SELECT set_config('minted.expected_mapping_generation', '', false);

SELECT set_config('minted.expected_mapping_generation', '5', false);
INSERT INTO public.portal_field_maps
  (org_id, portal_key, map_type, selector, source, token, field_type, status, mapping_generation)
VALUES
  (NULL, '${ids.generationPortalKey}', 'web', '#current-shared', 'token', 'provider.npi', 'text', 'approved', 5);
SELECT set_config('minted.expected_mapping_generation', '4', false);
INSERT INTO public.portal_field_maps
  (org_id, portal_key, map_type, selector, source, token, field_type, status, mapping_generation)
VALUES
  ('${ids.orgId}', '${ids.generationPortalKey}', 'web', '#current-org', 'token', 'provider.firstName', 'text', 'approved', 4);
SELECT set_config('minted.expected_mapping_generation', '7', false);
INSERT INTO public.portal_field_maps
  (org_id, portal_key, map_type, selector, source, token, field_type, status, mapping_generation)
VALUES
  ('${ids.otherOrgId}', '${ids.generationPortalKey}', 'web', '#other-org-only', 'token', 'provider.npi', 'text', 'approved', 7);
SELECT set_config('minted.expected_mapping_generation', '', false);
`);

  const afterReset = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        portalKey: ids.generationPortalKey,
        fillSessionId: ids.generationFillId,
        expectedMappingGeneration: 4,
        mappings: [
          mapping("#current-shared", "provider.npi"),
          mapping("#current-org", "provider.firstName"),
          mapping("#stale-global", "provider.lastName"),
          mapping("#stale-org-generation", "provider.firstName"),
          mapping("#stale-org-base", "provider.lastName"),
          mapping("#other-org-only", "provider.firstName"),
          mapping("#sibling-only", "provider.lastName"),
          mapping("#new-current", "provider.npi"),
        ],
      }),
    ),
    "current-generation learning",
  );
  assert(
    afterReset.kind === "ok" &&
      afterReset.inserted_count === 4 &&
      afterReset.confirmed_saved_count === 6 &&
      afterReset.preserved_count === 2,
    `current-generation counts were wrong after reset: ${JSON.stringify(afterReset)}`,
  );
  const generationResults = new Map(
    (afterReset.results ?? []).map((result) => [result.selector, result]),
  );
  assert(
    generationResults.get("#stale-org-generation")?.reason === "stale_generation" &&
      generationResults.get("#stale-org-base")?.reason === "stale_generation" &&
      generationResults.get("#stale-org-generation")?.mapping_generation === 2 &&
      generationResults.get("#stale-org-base")?.shared_base_generation === 4,
    `stale rows were not explicitly preserved for review: ${JSON.stringify(afterReset.results)}`,
  );
  const staleOrgRows = await runPsql(`
SELECT count(*) || ',' || min(mapping_generation) || ',' || min(shared_base_generation) || ',' || min(token)
FROM public.portal_field_maps
WHERE org_id = '${ids.orgId}' AND portal_key = '${ids.generationPortalKey}'
  AND selector IN ('#stale-org-generation','#stale-org-base');
`);
  assert(
    staleOrgRows.stdout === "2,2,4,provider.npi",
    `stale org rows were promoted or mutated: ${staleOrgRows.stdout}`,
  );
  const currentRows = await runPsql(`
SELECT count(*) || ',' || min(mapping_generation) || ',' || min(shared_base_generation)
FROM public.portal_field_maps
WHERE org_id = '${ids.orgId}' AND portal_key = '${ids.generationPortalKey}'
  AND selector IN ('#stale-global','#other-org-only','#sibling-only','#new-current');
`);
  assert(
    currentRows.stdout === "4,4,5",
    `new learning rows were not stamped to current generations: ${currentRows.stdout}`,
  );
  const staleGlobal = await runPsql(`
SELECT count(*) || ',' || string_agg(COALESCE(org_id::text, 'shared') || ':' || mapping_generation || ':' || COALESCE(shared_base_generation::text, 'null'), ',' ORDER BY org_id NULLS FIRST)
FROM public.portal_field_maps
WHERE portal_key = '${ids.generationPortalKey}' AND selector = '#stale-global';
`);
  assert(
    staleGlobal.stdout === `2,shared:4:null,${ids.orgId}:4:5`,
    `the stale global row was promoted or treated as current: ${staleGlobal.stdout}`,
  );
  const exactKeyRows = await runPsql(`
SELECT count(*) FROM public.portal_field_maps
WHERE portal_key = '${ids.siblingPortalKey}' AND selector = '#sibling-only';
`);
  assert(exactKeyRows.stdout === "1", "learning changed the same-URL sibling's map row");

  await runPsql(
    "ALTER TABLE public.audit_log ADD CONSTRAINT flywheel_test_audit_failure CHECK (entity_type <> 'portal_field_map') NOT VALID;",
  );
  const failedAudit = await runPsql(
    rpcSql(ids, ids.actorId, { mappings: [mapping("#audit-rollback")] }),
    { allowFailure: true },
  );
  assert(failedAudit.code !== 0, "audit failure fixture did not abort the RPC statement");
  await runPsql("ALTER TABLE public.audit_log DROP CONSTRAINT flywheel_test_audit_failure;");
  const rolledBack = await runPsql(
    `SELECT count(*) FROM public.portal_field_maps WHERE org_id='${ids.orgId}' AND portal_key='${ids.portalKey}' AND selector='#audit-rollback';`,
  );
  assert(rolledBack.stdout === "0", "map insert survived its atomic audit failure");

  const concurrentSql = rpcSql(ids, ids.actorId, { mappings: [mapping(concurrentSelector)] });
  const concurrent = await Promise.all([runPsql(concurrentSql), runPsql(concurrentSql)]);
  const concurrentResults = concurrent.map((result) =>
    parseJsonOutput(result, "concurrent replay"),
  );
  assert(
    concurrentResults.every(
      (result) => result.kind === "ok" && result.confirmed_saved_count === 1,
    ) && concurrentResults.reduce((sum, result) => sum + result.inserted_count, 0) === 1,
    "concurrent replays did not converge to one insert and two confirmed receipts",
  );
  const concurrentRows = await runPsql(`
SELECT count(*) || ',' || count(DISTINCT id) FROM public.portal_field_maps
WHERE org_id='${ids.orgId}' AND portal_key='${ids.portalKey}' AND selector='${concurrentSelector}';
`);
  assert(
    concurrentRows.stdout === "1,1",
    `concurrent index result was not unique: ${concurrentRows.stdout}`,
  );

  const specialist = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.specialistId, {
        fillSessionId: ids.specialistFillId,
        mappings: [mapping("#specialist-writer")],
      }),
    ),
    "specialist writer",
  );
  assert(
    specialist.kind === "ok" && specialist.inserted_count === 1,
    "specialist writer was denied",
  );

  const contactToken = parseJsonOutput(
    await runPsql(
      rpcSql(ids, ids.actorId, {
        mappings: [mapping("#contact-email", "billingContact.email", 0.88)],
      }),
    ),
    "code-owned contact token",
  );
  assert(
    contactToken.kind === "ok" && contactToken.inserted_count === 1,
    "exact code-owned contact token was denied",
  );

  console.log(
    "PASS: portal-field-map migration/RPC role, tenant, evidence, token, preservation, replay, concurrency, and audit-rollback checks",
  );
} finally {
  if (seeded) {
    await runPsql(`
SET session_replication_role = replica;
DELETE FROM public.portal_field_maps
 WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}')
    OR portal_key IN ('${ids.portalKey}','${ids.generationPortalKey}','${ids.siblingPortalKey}');
DELETE FROM public.portals
 WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}')
    OR portal_key IN ('${ids.generationPortalKey}','${ids.siblingPortalKey}');
DELETE FROM public.audit_log WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}');
DELETE FROM public.touches WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}');
DELETE FROM public.fill_sessions WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}');
DELETE FROM public.credential_cases WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}');
DELETE FROM public.providers WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}');
DELETE FROM public.payers WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}');
DELETE FROM public.memberships WHERE org_id IN ('${ids.orgId}','${ids.otherOrgId}');
DELETE FROM public.profiles WHERE id IN ('${ids.actorId}','${ids.otherActorId}','${ids.billingActorId}','${ids.specialistId}');
DELETE FROM auth.users WHERE id IN ('${ids.actorId}','${ids.otherActorId}','${ids.billingActorId}','${ids.specialistId}');
DELETE FROM public.organizations WHERE id IN ('${ids.orgId}','${ids.otherOrgId}');
`);
  }
}

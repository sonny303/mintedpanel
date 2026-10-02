#!/usr/bin/env node
// Two-session proof that MINT-60's exact portal lock serializes against MINT-57
// capture writes. Run only against disposable migration CI/local PostgreSQL.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const psqlBinary = process.env.MINT60_PSQL_BIN || "psql";
const ids = Object.fromEntries(
  [
    "org",
    "actor",
    "payer",
    "portal",
    "workGlobalPortal",
    "workOrgPortal",
    "provider",
    "template",
    "case",
    "task",
    "step",
    "fillResetFirst",
    "fillFillFirst",
    "touchAfterReset",
  ].map((key) => [key, randomUUID()]),
);
const portalKey = `mint60_race_${ids.org.replaceAll("-", "").slice(0, 16)}`;
const workPortalKey = `mint60_work_${ids.org.replaceAll("-", "").slice(0, 16)}`;
const actorClaims = JSON.stringify({ sub: ids.actor, role: "service_role" });
const fingerprint = `sha256:${"a".repeat(64)}`;
const stepIdentity = `${ids.case}:${ids.task}:${ids.template}:1:${ids.step}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startPsql(sql, applicationName) {
  const child = spawn(psqlBinary, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
    env: {
      ...process.env,
      ...(applicationName ? { PGAPPNAME: applicationName } : {}),
      LC_ALL: "C",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  child.stdin.end(sql);
  return { child, done };
}

function runPsql(sql) {
  return startPsql(sql).done;
}

const portalUpdateWasGranted =
  (await runPsql("SELECT has_table_privilege('service_role', 'public.portals', 'UPDATE')::text;"))
    .stdout === "true";

async function waitForResetLock(applicationName, resetProcess, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (resetProcess.child.exitCode !== null) {
      const result = await resetProcess.done;
      throw new Error(`reset session ended before its lock wait: ${result.stderr}`);
    }
    const result = await runPsql(`
      SELECT count(*)::text
        FROM pg_stat_activity
       WHERE application_name = '${applicationName}'
         AND wait_event = 'PgSleep';
    `);
    if (result.code === 0 && result.stdout === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for reset session to hold the portal lock");
}

async function waitForSessionLockWait(applicationName, process, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      const result = await process.done;
      throw new Error(`session ended before waiting for a lock: ${result.stderr}`);
    }
    const result = await runPsql(`
      SELECT count(*)::text FROM pg_stat_activity
       WHERE application_name = '${applicationName}'
         AND wait_event_type = 'Lock';
    `);
    if (result.code === 0 && result.stdout === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${applicationName} to block on the shared row`);
}

function workFillInsert(fillId, pin, applicationName, sleep = false) {
  return `
    BEGIN;
    SET LOCAL application_name = '${applicationName}';
    SET LOCAL request.jwt.claim.sub = '${ids.actor}';
    SET LOCAL request.jwt.claim.role = 'service_role';
    SET LOCAL request.jwt.claims = '${actorClaims}';
    SET LOCAL ROLE service_role;
    INSERT INTO public.fill_sessions (
      id, org_id, case_id, case_task_id, case_step_id, step_identity,
      sop_template_id, sop_version, context_version, launch_receipt_id,
      mapping_generation, shared_mapping_generation, effective_mapping_fingerprint,
      portal_id, provider_id, portal_key, fill_mode, fields_filled, fields_skipped,
      is_test, event_schema_version, fields_attempted, fields_verified,
      fields_rejected, field_outcomes, performed_by
    ) VALUES (
      '${fillId}', '${ids.org}', '${ids.case}', '${ids.task}', '${ids.step}',
      '${stepIdentity}', '${ids.template}', 1, 1, '${fillId}',
      1, ${pin}, '${fingerprint}', '${ids.workOrgPortal}', '${ids.provider}',
      '${workPortalKey}', 'web', 0, '[]'::jsonb, false, 2, 0, 0, 0,
      '[]'::jsonb, '${ids.actor}'
    );
    SELECT 'filled';
    ${sleep ? "SELECT pg_sleep(2);" : ""}
    COMMIT;
  `;
}

function workTuple(fillId) {
  return `jsonb_build_object(
    'launchReceiptId', '${fillId}'::uuid,
    'orgId', '${ids.org}'::uuid,
    'ownerKind', 'case',
    'ownerId', '${ids.case}'::uuid,
    'contextVersion', 1,
    'sopTemplateId', '${ids.template}'::uuid,
    'sopVersion', 1,
    'portalId', '${ids.workOrgPortal}'::uuid,
    'portalKey', '${workPortalKey}',
    'mappingGeneration', 1,
    'effectiveMappingFingerprint', '${fingerprint}',
    'providerId', '${ids.provider}'::uuid,
    'facilityId', NULL,
    'stepIdentity', '${stepIdentity}',
    'taskId', '${ids.task}'::uuid,
    'stepId', '${ids.step}'::uuid
  )`;
}

async function cleanup() {
  await runPsql(`
    BEGIN;
    ALTER TABLE public.form_mapping_reset_events
      DISABLE TRIGGER form_mapping_reset_events_append_only;
    DELETE FROM public.form_mapping_reset_events
     WHERE portal_id IN ('${ids.portal}', '${ids.workGlobalPortal}');
    ALTER TABLE public.form_mapping_reset_events
      ENABLE TRIGGER form_mapping_reset_events_append_only;
    ALTER TABLE public.fill_sessions DISABLE TRIGGER trg_fill_sessions_prevent_v2_mutation;
    DELETE FROM public.audit_log WHERE org_id = '${ids.org}';
    DELETE FROM public.touches WHERE org_id = '${ids.org}';
    DELETE FROM public.fill_sessions WHERE org_id = '${ids.org}';
    ALTER TABLE public.fill_sessions ENABLE TRIGGER trg_fill_sessions_prevent_v2_mutation;
    DELETE FROM public.tasks WHERE org_id = '${ids.org}';
    DELETE FROM public.credential_cases WHERE org_id = '${ids.org}';
    ALTER TABLE public.portal_field_maps DISABLE TRIGGER portal_field_maps_generation_write_guard;
    DELETE FROM public.portal_field_maps
     WHERE portal_key IN ('${portalKey}', '${workPortalKey}');
    ALTER TABLE public.portal_field_maps ENABLE TRIGGER portal_field_maps_generation_write_guard;
    DELETE FROM public.portals
     WHERE id IN ('${ids.portal}', '${ids.workGlobalPortal}', '${ids.workOrgPortal}');
    DELETE FROM public.sop_template_versions WHERE template_id = '${ids.template}';
    DELETE FROM public.sop_templates WHERE id = '${ids.template}';
    DELETE FROM public.providers WHERE id = '${ids.provider}';
    DROP POLICY IF EXISTS m60_race_membership_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.memberships;
    DROP POLICY IF EXISTS m60_race_profile_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.profiles;
    DROP POLICY IF EXISTS m60_race_payer_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.payers;
    DROP POLICY IF EXISTS m60_race_portal_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.portals;
    DROP POLICY IF EXISTS m60_race_portal_update_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.portals;
    DROP POLICY IF EXISTS m60_race_map_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.portal_field_maps;
    DROP POLICY IF EXISTS m60_race_fill_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.fill_sessions;
    DROP POLICY IF EXISTS m60_race_fill_insert_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.fill_sessions;
    DROP POLICY IF EXISTS m60_race_touch_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.touches;
    DROP POLICY IF EXISTS m60_race_touch_insert_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.touches;
    DROP POLICY IF EXISTS m60_race_task_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.tasks;
    DROP POLICY IF EXISTS m60_race_task_update_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.tasks;
    DROP POLICY IF EXISTS m60_race_case_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.credential_cases;
    DROP POLICY IF EXISTS m60_race_case_update_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.credential_cases;
    DROP POLICY IF EXISTS m60_race_audit_insert_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.audit_log;
    ${portalUpdateWasGranted ? "" : "REVOKE UPDATE ON public.portals FROM service_role;"}
    DELETE FROM public.memberships WHERE org_id = '${ids.org}' AND user_id = '${ids.actor}';
    DELETE FROM public.payers WHERE id = '${ids.payer}';
    DELETE FROM public.organizations WHERE id = '${ids.org}';
    DELETE FROM public.profiles WHERE id = '${ids.actor}';
    DELETE FROM auth.users WHERE id = '${ids.actor}';
    COMMIT;
  `);
}

await runPsql(`
  BEGIN;
  INSERT INTO auth.users (id, email)
  VALUES ('${ids.actor}', 'mint60-${ids.actor}@example.invalid');
  INSERT INTO public.profiles (id, full_name, email)
  VALUES ('${ids.actor}', 'MINT-60 race actor', 'mint60-${ids.actor}@example.invalid');
  INSERT INTO public.organizations (id, name)
  VALUES ('${ids.org}', 'MINT-60 race ${ids.org}');
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES ('${ids.org}', '${ids.actor}', 'specialist');
  INSERT INTO public.payers (id, org_id, name)
  VALUES ('${ids.payer}', '${ids.org}', 'MINT-60 race payer');
  INSERT INTO public.providers (id, org_id, first_name, last_name, status)
  VALUES ('${ids.provider}', '${ids.org}', 'Synthetic', 'MINT-60', 'active');
  INSERT INTO public.sop_templates (
    id, org_id, name, payer_id, state, states, task_definitions, archived,
    current_version, required_profile_attributes, case_type
  ) VALUES (
    '${ids.template}', '${ids.org}', 'MINT-60 Work SOP', '${ids.payer}',
    'CO', ARRAY['CO']::text[],
    '[{"title":"Enrollment","steps":[{"stepType":"online_form","portalKey":"${workPortalKey}"}]}]'::jsonb,
    false, 1, '[]'::jsonb, 'enrollment'
  );
  INSERT INTO public.credential_cases (
    id, org_id, provider_id, payer_id, state, case_type, case_status
  ) VALUES (
    '${ids.case}', '${ids.org}', '${ids.provider}', '${ids.payer}',
    'OR', 'enrollment', 'not_started'
  );
  INSERT INTO public.tasks (
    id, org_id, case_id, provider_id, title, sop_content, status, sort_order,
    sop_template_id, sop_version, execution_type
  ) VALUES (
    '${ids.task}', '${ids.org}', '${ids.case}', '${ids.provider}', 'MINT-60 Work step',
    jsonb_build_array(jsonb_build_object(
      'id', '${ids.step}', 'label', 'Form', 'stepType', 'online_form',
      'portalKey', '${workPortalKey}', 'order', 0, 'isCompleted', false
    )),
    'not_started', 1, '${ids.template}', 1, 'extension_fill'
  );
  INSERT INTO public.portals (
    id, org_id, portal_key, name, payer_id, form_url, case_type,
    requires_explicit_selection, mapping_generation, is_verified, last_verified_at, proven_at
  ) VALUES (
    '${ids.portal}', '${ids.org}', '${portalKey}', 'MINT-60 race form',
    '${ids.payer}', 'https://m60.example.invalid/form', 'enrollment',
    true, 1, true, now(), now()
  );
  INSERT INTO public.portals (
    id, org_id, portal_key, name, payer_id, form_url, case_type,
    requires_explicit_selection, mapping_generation, is_verified, last_verified_at, proven_at
  ) VALUES
    ('${ids.workGlobalPortal}', NULL, '${workPortalKey}', 'MINT-60 shared Work form',
     '${ids.payer}', 'https://m60.example.invalid/shared', NULL, false,
     1, true, now(), now()),
    ('${ids.workOrgPortal}', '${ids.org}', '${workPortalKey}', 'MINT-60 org Work form',
     '${ids.payer}', 'https://m60.example.invalid/org', 'enrollment', true,
     1, true, now(), now());
  SET LOCAL minted.expected_mapping_generation = '1';
  INSERT INTO public.portal_field_maps (
    org_id, portal_key, map_type, selector, source, token, field_type,
    status, notes, mapping_generation
  ) VALUES
    (NULL, '${workPortalKey}', 'web', '#shared', 'token', 'provider.npi', 'text',
     'approved', 'MINT-60 shared base', 1),
    ('${ids.org}', '${workPortalKey}', 'web', '#org', 'token', 'provider.npi', 'text',
     'approved', 'MINT-60 org override', 1);

  GRANT USAGE ON SCHEMA auth TO service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
  GRANT SELECT ON public.memberships, public.profiles, public.payers, public.portals,
    public.case_facilities, public.fill_sessions, public.touches, public.tasks,
    public.credential_cases, public.portal_field_maps TO service_role;
  GRANT INSERT ON public.fill_sessions, public.touches, public.audit_log TO service_role;
  GRANT UPDATE ON public.tasks, public.credential_cases, public.portals TO service_role;
  CREATE POLICY m60_race_membership_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.memberships
    FOR SELECT TO service_role USING (org_id = '${ids.org}');
  CREATE POLICY m60_race_profile_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.profiles
    FOR SELECT TO service_role USING (id = '${ids.actor}');
  CREATE POLICY m60_race_payer_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.payers
    FOR SELECT TO service_role USING (org_id = '${ids.org}');
  CREATE POLICY m60_race_portal_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.portals
    FOR SELECT TO service_role USING (org_id IS NULL OR org_id = '${ids.org}');
  CREATE POLICY m60_race_portal_update_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.portals
    FOR UPDATE TO service_role USING (org_id IS NULL OR org_id = '${ids.org}')
    WITH CHECK (org_id IS NULL OR org_id = '${ids.org}');
  CREATE POLICY m60_race_map_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.portal_field_maps
    FOR SELECT TO service_role USING (org_id IS NULL OR org_id = '${ids.org}');
  CREATE POLICY m60_race_fill_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.fill_sessions
    FOR SELECT TO service_role USING (org_id = '${ids.org}');
  CREATE POLICY m60_race_fill_insert_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.fill_sessions
    FOR INSERT TO service_role WITH CHECK (org_id = '${ids.org}');
  CREATE POLICY m60_race_touch_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.touches
    FOR SELECT TO service_role USING (org_id = '${ids.org}');
  CREATE POLICY m60_race_touch_insert_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.touches
    FOR INSERT TO service_role WITH CHECK (org_id = '${ids.org}');
  CREATE POLICY m60_race_task_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.tasks
    FOR SELECT TO service_role USING (org_id = '${ids.org}');
  CREATE POLICY m60_race_task_update_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.tasks
    FOR UPDATE TO service_role USING (org_id = '${ids.org}') WITH CHECK (org_id = '${ids.org}');
  CREATE POLICY m60_race_case_select_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.credential_cases
    FOR SELECT TO service_role USING (org_id = '${ids.org}');
  CREATE POLICY m60_race_case_update_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.credential_cases
    FOR UPDATE TO service_role USING (org_id = '${ids.org}') WITH CHECK (org_id = '${ids.org}');
  CREATE POLICY m60_race_audit_insert_${ids.org.replaceAll("-", "").slice(0, 12)} ON public.audit_log
    FOR INSERT TO service_role WITH CHECK (org_id = '${ids.org}');
  COMMIT;
`);

try {
  const resetApplicationName = `mint60-reset-${ids.org}`;
  const reset = startPsql(
    `
    BEGIN;
    SET LOCAL request.jwt.claim.sub = '${ids.actor}';
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claims = '{"sub":"${ids.actor}","role":"authenticated"}';
    SET LOCAL ROLE authenticated;
    SELECT id FROM public.reset_portal_mapping(
      '${ids.portal}', 1, '${randomUUID()}'
    );
    SELECT pg_sleep(2);
    COMMIT;
  `,
    resetApplicationName,
  );
  await waitForResetLock(resetApplicationName, reset);
  const writeStartedAt = Date.now();
  const capture = startPsql(`
    SET ROLE service_role;
    SELECT public.capture_org_portal_field_map(
      '${ids.org}', 1,
      '{"portal_key":"${portalKey}","selector":"#m60-race","field_label":"Synthetic field","field_type":"text"}'::jsonb
    );
  `);
  const [resetResult, captureResult] = await Promise.all([reset.done, capture.done]);
  const waitedMs = Date.now() - writeStartedAt;

  assert(resetResult.code === 0, `reset session failed: ${resetResult.stderr}`);
  assert(captureResult.code !== 0, "stale capture unexpectedly succeeded after reset");
  assert(
    captureResult.stderr.includes("mapping_generation_stale"),
    `expected stale-generation rejection, got: ${captureResult.stderr}`,
  );
  assert(waitedMs >= 500, `capture did not wait for the reset transaction (${waitedMs}ms)`);

  const persisted = await runPsql(`
    SELECT mapping_generation::text || ',' || is_verified::text || ',' ||
      (proven_at IS NULL)::text || ',' || (
        SELECT count(*)::text FROM public.portal_field_maps
         WHERE org_id = '${ids.org}' AND portal_key = '${portalKey}'
      ) || ',' || (
        SELECT count(*)::text FROM public.form_mapping_reset_events
         WHERE portal_id = '${ids.portal}'
      )
      FROM public.portals WHERE id = '${ids.portal}';
  `);
  assert(persisted.code === 0, `could not verify race result: ${persisted.stderr}`);
  assert(
    persisted.stdout === "2,false,true,0,1",
    `expected one committed reset and no stale capture, got ${persisted.stdout}`,
  );

  // Reset owns the shared row first: a preflight-shaped generation-one fill
  // waits, then fails closed when it observes the committed generation two.
  const resetFirstApp = `m60-reset-first-${ids.org.slice(0, 8)}`;
  const resetFirst = startPsql(
    `
      BEGIN;
      SET LOCAL request.jwt.claim.sub = '${ids.actor}';
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claims = '{"sub":"${ids.actor}","role":"authenticated"}';
      SET LOCAL ROLE authenticated;
      SELECT id FROM public.reset_portal_mapping(
        '${ids.workGlobalPortal}', 1, '${randomUUID()}'
      );
      SELECT pg_sleep(2);
      COMMIT;
    `,
    resetFirstApp,
  );
  await waitForResetLock(resetFirstApp, resetFirst);
  const resetFirstStartedAt = Date.now();
  const staleFill = startPsql(
    workFillInsert(ids.fillResetFirst, 1, `m60-fill-reset-first-${ids.org.slice(0, 8)}`),
    `m60-fill-reset-first-${ids.org.slice(0, 8)}`,
  );
  const [resetFirstResult, staleFillResult] = await Promise.all([resetFirst.done, staleFill.done]);
  const resetFirstWaitMs = Date.now() - resetFirstStartedAt;
  assert(resetFirstResult.code === 0, `reset-first transaction failed: ${resetFirstResult.stderr}`);
  assert(
    staleFillResult.code !== 0 &&
      staleFillResult.stderr.includes("shared_mapping_generation_stale"),
    `expected old shared pin rejection after reset, got: ${staleFillResult.stderr}`,
  );
  assert(resetFirstWaitMs >= 500, `fill did not wait for shared reset (${resetFirstWaitMs}ms)`);
  const resetFirstState = await runPsql(`
    SELECT (SELECT mapping_generation FROM public.portals WHERE id = '${ids.workGlobalPortal}')::text
      || ',' || (SELECT count(*) FROM public.fill_sessions WHERE id = '${ids.fillResetFirst}')::text;
  `);
  assert(
    resetFirstState.stdout === "2,0",
    `reset-first stale fill changed state unexpectedly: ${resetFirstState.stdout}`,
  );

  // Re-capture an org selector against shared generation two, then let a fill
  // lock org→shared first. The generation-three reset must wait for that
  // receipt; its later human submission must still reject with no M19/touch.
  const recapture = await runPsql(`
    BEGIN;
    SET LOCAL request.jwt.claim.sub = '${ids.actor}';
    SET LOCAL request.jwt.claim.role = 'service_role';
    SET LOCAL request.jwt.claims = '${actorClaims}';
    SET LOCAL ROLE service_role;
    WITH captured AS MATERIALIZED (
      SELECT public.capture_org_portal_field_map(
        '${ids.org}', 1,
        '{"portal_key":"${workPortalKey}","selector":"#recaptured","field_label":"Current field","field_type":"text"}'::jsonb
      ) AS result
    )
    SELECT public.update_org_portal_field_map(
      '${ids.org}', (result->'map'->>'id')::uuid, 1,
      '{"status":"approved","source":"token","token":"provider.npi"}'::jsonb
    ) FROM captured;
    COMMIT;
  `);
  assert(recapture.code === 0, `generation-two recapture failed: ${recapture.stderr}`);

  const fillFirstApp = `m60-fill-first-${ids.org.slice(0, 8)}`;
  const fillFirst = startPsql(
    workFillInsert(ids.fillFillFirst, 2, fillFirstApp, true),
    fillFirstApp,
  );
  await waitForResetLock(fillFirstApp, fillFirst);
  const resetSecondApp = `m60-reset-second-${ids.org.slice(0, 8)}`;
  const resetSecond = startPsql(
    `
      BEGIN;
      SET LOCAL request.jwt.claim.sub = '${ids.actor}';
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claims = '{"sub":"${ids.actor}","role":"authenticated"}';
      SET LOCAL ROLE authenticated;
      SELECT id FROM public.reset_portal_mapping(
        '${ids.workGlobalPortal}', 2, '${randomUUID()}'
      );
      COMMIT;
    `,
    resetSecondApp,
  );
  await waitForSessionLockWait(resetSecondApp, resetSecond);
  const fillFirstStartedAt = Date.now();
  const [fillFirstResult, resetSecondResult] = await Promise.all([
    fillFirst.done,
    resetSecond.done,
  ]);
  const fillFirstWaitMs = Date.now() - fillFirstStartedAt;
  assert(fillFirstResult.code === 0, `fill-first transaction failed: ${fillFirstResult.stderr}`);
  assert(
    resetSecondResult.code === 0,
    `reset-second transaction failed: ${resetSecondResult.stderr}`,
  );
  assert(fillFirstWaitMs >= 500, `reset did not wait for shared fill (${fillFirstWaitMs}ms)`);

  const staleSubmission = await runPsql(`
    BEGIN;
    SET LOCAL request.jwt.claim.sub = '${ids.actor}';
    SET LOCAL request.jwt.claim.role = 'service_role';
    SET LOCAL request.jwt.claims = '${actorClaims}';
    SET LOCAL ROLE service_role;
    SELECT (result->>'kind') || ',' || (result->>'status')
      FROM (SELECT public.record_typed_enrollment_submission(
        '${ids.org}', '${ids.actor}', '${ids.case}', '${ids.touchAfterReset}',
        '${ids.fillFillFirst}', ${workTuple(ids.fillFillFirst)},
        '{"note":null,"payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
      ) AS result) AS attempted;
    COMMIT;
  `);
  assert(staleSubmission.code === 0, `stale submission check failed: ${staleSubmission.stderr}`);
  assert(
    staleSubmission.stdout === "rejected,409",
    `expected post-reset submission rejection, got ${staleSubmission.stdout}`,
  );
  const fillFirstState = await runPsql(`
    SELECT (SELECT mapping_generation FROM public.portals WHERE id = '${ids.workGlobalPortal}')::text
      || ',' || (SELECT mapping_generation FROM public.portals WHERE id = '${ids.workOrgPortal}')::text
      || ',' || (SELECT shared_mapping_generation FROM public.fill_sessions WHERE id = '${ids.fillFillFirst}')::text
      || ',' || (SELECT count(*) FROM public.touches WHERE fill_session_id = '${ids.fillFillFirst}')::text
      || ',' || (SELECT sop_content->0->>'isCompleted' FROM public.tasks WHERE id = '${ids.task}')
      || ',' || (SELECT case_status FROM public.credential_cases WHERE id = '${ids.case}');
  `);
  assert(
    fillFirstState.stdout === "3,1,2,0,false,in_progress",
    `fill/reset lock ordering or stale submission changed unexpected state: ${fillFirstState.stdout}`,
  );
} finally {
  await cleanup();
}

process.stdout.write(
  "MINT-60 reset/fill races passed: both shared-row lock orders serialize; stale fills and submissions reject.\n",
);

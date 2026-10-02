#!/usr/bin/env node
// Prove that two typed Enrollment submissions for different selected SOP
// steps can complete concurrently without losing either task update. Run only
// against migration CI's disposable local PostgreSQL database.

import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const psqlBinary = process.env.MINT58_PSQL_BIN || "psql";
const psqlArgs = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
const host = process.env.PGHOST || "";
const database = process.env.PGDATABASE || "";

if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("/"))) {
  throw new Error("MINT58_LOCAL_POSTGRES_REQUIRED");
}
if (!database || database.includes("/")) throw new Error("MINT58_PGDATABASE_REQUIRED");

const keys = [
  "org",
  "actor",
  "providerGroup",
  "providerGroupB",
  "provider",
  "payer",
  "template",
  "portal",
  "caseA",
  "caseB",
  "taskA",
  "taskB",
  "stepA",
  "stepB",
  "fillA",
  "fillB",
  "receiptA",
  "receiptB",
  "touchA",
  "touchB",
];
const ids = Object.fromEntries(keys.map((key) => [key, randomUUID()]));
const portalKey = `m58_race_${ids.org.replaceAll("-", "").slice(0, 20)}`;
const appA = `m58-a-${ids.org.slice(0, 8)}`;
const appB = `m58-b-${ids.org.slice(0, 8)}`;
const fingerprint = `sha256:${"a".repeat(64)}`;
let setupCommitted = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsql(sql) {
  const result = spawnSync(psqlBinary, psqlArgs, {
    env: { ...process.env, LC_ALL: "C" },
    input: sql,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`MINT58_PSQL_FAILED:${result.stderr || result.status}`);
  }
  return result.stdout.trim();
}

function finalSqlResult(output) {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

const portalUpdateWasGranted =
  runPsql("SELECT has_table_privilege('service_role', 'public.portals', 'UPDATE')::text;") ===
  "true";

function startPsql(sql, applicationName) {
  const child = spawn(psqlBinary, psqlArgs, {
    env: { ...process.env, PGAPPNAME: applicationName, LC_ALL: "C" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdin.end(sql);
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`MINT58_PSQL_SESSION_TIMEOUT:${applicationName}`));
    }, 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`MINT58_PSQL_SESSION_FAILED:${stderr || code}`));
      else resolve(stdout.trim());
    });
  });
  return { child, done };
}

async function waitForBothSessionsToOverlap(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = runPsql(`
      SELECT count(*)::text FROM pg_catalog.pg_stat_activity
       WHERE application_name IN (${quote(appA)}, ${quote(appB)})
         AND wait_event = 'PgSleep';
    `);
    if (count === "2") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("MINT58_DIFFERENT_STEP_TRANSACTIONS_DID_NOT_OVERLAP");
}

const tuple = (caseKey, taskKey, stepKey, receiptKey) => `jsonb_build_object(
  'launchReceiptId', ${quote(ids[receiptKey])}::uuid,
  'orgId', ${quote(ids.org)}::uuid,
  'ownerKind', 'case',
  'ownerId', ${quote(ids[caseKey])}::uuid,
  'contextVersion', 1,
  'sopTemplateId', ${quote(ids.template)}::uuid,
  'sopVersion', 1,
  'portalId', ${quote(ids.portal)}::uuid,
  'portalKey', ${quote(portalKey)},
  'mappingGeneration', 1,
  'effectiveMappingFingerprint', ${quote(fingerprint)},
  'providerId', ${quote(ids.provider)}::uuid,
  'facilityId', NULL,
  'stepIdentity', ${quote(`${ids[caseKey]}:${ids[taskKey]}:${ids.template}:1:${ids[stepKey]}`)},
  'taskId', ${quote(ids[taskKey])}::uuid,
  'stepId', ${quote(ids[stepKey])}::uuid
)`;

const touchCall = (caseKey, taskKey, stepKey, fillKey, receiptKey, touchKey, appName) => `
BEGIN;
SET LOCAL application_name = ${quote(appName)};
SELECT pg_catalog.set_config('request.jwt.claim.sub', ${quote(ids.actor)}, true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  ${quote(JSON.stringify({ sub: ids.actor, role: "service_role" }))},
  true
);
SELECT pg_catalog.set_config('mint58.race_sleep_task', ${quote(ids[taskKey])}, true);
SET LOCAL ROLE service_role;
SELECT public.record_typed_enrollment_submission(
  ${quote(ids.org)}::uuid,
  ${quote(ids.actor)}::uuid,
  ${quote(ids[caseKey])}::uuid,
  ${quote(ids[touchKey])}::uuid,
  ${quote(ids[fillKey])}::uuid,
  ${tuple(caseKey, taskKey, stepKey, receiptKey)},
  '{"note":null,"payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
)->>'kind';
COMMIT;
`;

function stepInsert(caseKey, taskKey, stepKey) {
  const identity = `${ids[caseKey]}:${ids[taskKey]}:${ids.template}:1:${ids[stepKey]}`;
  const fillKey = caseKey === "caseA" ? "fillA" : "fillB";
  const receiptKey = caseKey === "caseA" ? "receiptA" : "receiptB";
  return `
    ('${ids[fillKey]}', '${ids.org}', '${ids[caseKey]}', '${ids[taskKey]}', '${ids[stepKey]}', '${identity}',
     '${ids.template}', 1, 1, '${ids[receiptKey]}', 1, '${fingerprint}', '${ids.portal}',
     '${ids.provider}', '${portalKey}', 'web', 0, '[]'::jsonb, false, 2, 0, 0, 0,
     '[]'::jsonb, '${ids.actor}')`;
}

const policySuffix = ids.org.replaceAll("-", "").slice(0, 12);
const testPolicies = [
  ["memberships_select", "memberships"],
  ["profiles_select", "profiles"],
  ["payers_select", "payers"],
  ["portals_select", "portals"],
  ["portals_update", "portals"],
  ["facilities_select", "case_facilities"],
  ["fills_select", "fill_sessions"],
  ["fills_insert", "fill_sessions"],
  ["touches_select", "touches"],
  ["touches_insert", "touches"],
  ["tasks_select", "tasks"],
  ["tasks_update", "tasks"],
  ["cases_select", "credential_cases"],
  ["cases_update", "credential_cases"],
  ["audit_insert", "audit_log"],
];
const dropTestPolicies = testPolicies
  .map(
    ([name, table]) => `DROP POLICY IF EXISTS m58_race_${name}_${policySuffix} ON public.${table};`,
  )
  .join("\n");

const cleanup = `
BEGIN;
DROP TRIGGER IF EXISTS zz_m58_concurrency_sleep ON public.tasks;
DROP FUNCTION IF EXISTS public.m58_concurrency_sleep();
${dropTestPolicies}
${portalUpdateWasGranted ? "" : "REVOKE UPDATE ON public.portals FROM service_role;"}
DELETE FROM public.audit_log WHERE org_id = '${ids.org}';
DELETE FROM public.touches WHERE org_id = '${ids.org}';
-- The verifier owns only synthetic receipts; disable the named append-only
-- history trigger for their cleanup, then restore it before this transaction
-- commits. If cleanup errors, PostgreSQL rolls back both trigger state and data.
ALTER TABLE public.fill_sessions DISABLE TRIGGER trg_fill_sessions_prevent_v2_mutation;
DELETE FROM public.fill_sessions WHERE org_id = '${ids.org}';
ALTER TABLE public.fill_sessions ENABLE TRIGGER trg_fill_sessions_prevent_v2_mutation;
DELETE FROM public.tasks WHERE org_id = '${ids.org}';
DELETE FROM public.credential_cases WHERE org_id = '${ids.org}';
DELETE FROM public.portals WHERE id = '${ids.portal}';
-- M44 gives each inserted template an immutable version-1 row. Tasks were
-- removed above to release their composite version FK; no Contract assignment
-- references this synthetic template. Draft rows cascade with the head.
DELETE FROM public.sop_template_versions WHERE template_id = '${ids.template}';
DELETE FROM public.sop_templates WHERE id = '${ids.template}';
DELETE FROM public.provider_group_assignments WHERE org_id = '${ids.org}';
DELETE FROM public.providers WHERE org_id = '${ids.org}';
DELETE FROM public.provider_groups WHERE org_id = '${ids.org}';
DELETE FROM public.memberships WHERE org_id = '${ids.org}';
DELETE FROM public.payers WHERE org_id = '${ids.org}';
DELETE FROM public.profiles WHERE id = '${ids.actor}';
DELETE FROM auth.users WHERE id = '${ids.actor}';
ALTER TABLE public.roster_templates DISABLE TRIGGER USER;
DELETE FROM public.roster_templates WHERE org_id = '${ids.org}';
ALTER TABLE public.roster_templates ENABLE TRIGGER USER;
DELETE FROM public.organizations WHERE id = '${ids.org}';
COMMIT;
`;

try {
  runPsql(`
BEGIN;
-- The M51 typed-fill trigger validates the authenticated service-role actor.
-- These claims are transaction-local so seed receipts satisfy that boundary
-- without changing the database role or leaking into later psql sessions.
SELECT pg_catalog.set_config('request.jwt.claim.sub', ${quote(ids.actor)}, true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  ${quote(JSON.stringify({ sub: ids.actor, role: "service_role" }))},
  true
);
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('${ids.actor}', 'm58-race-${ids.actor}@example.invalid', '{}'::jsonb);
INSERT INTO public.profiles (id, full_name, email)
VALUES ('${ids.actor}', 'MINT-58 concurrent submitter', 'm58-race-${ids.actor}@example.invalid');
INSERT INTO public.organizations (id, name)
VALUES ('${ids.org}', 'MINT-58 concurrent organization');
INSERT INTO public.memberships (org_id, user_id, role)
VALUES ('${ids.org}', '${ids.actor}', 'specialist');
INSERT INTO public.provider_groups (id, org_id, name)
VALUES
  ('${ids.providerGroup}', '${ids.org}', 'MINT-58 concurrent provider group A'),
  ('${ids.providerGroupB}', '${ids.org}', 'MINT-58 concurrent provider group B');
INSERT INTO public.providers (id, org_id, group_id, first_name, last_name, status)
VALUES ('${ids.provider}', '${ids.org}', '${ids.providerGroup}', 'Concurrent', 'Provider', 'active');
INSERT INTO public.provider_group_assignments (org_id, provider_id, group_id, is_primary)
VALUES
  ('${ids.org}', '${ids.provider}', '${ids.providerGroup}', true),
  ('${ids.org}', '${ids.provider}', '${ids.providerGroupB}', false);
INSERT INTO public.payers (id, org_id, name)
VALUES ('${ids.payer}', '${ids.org}', 'MINT-58 concurrent payer');
INSERT INTO public.sop_templates (
  id, org_id, name, payer_id, state, states, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '${ids.template}', '${ids.org}', 'MINT-58 concurrent Enrollment SOP', '${ids.payer}',
  'CO', ARRAY['CO']::text[], '[]'::jsonb, false, 1, '[]'::jsonb, 'enrollment'
);
INSERT INTO public.credential_cases (id, org_id, provider_id, group_id, payer_id, state, case_type, case_status)
VALUES
  ('${ids.caseA}', '${ids.org}', '${ids.provider}', '${ids.providerGroup}', '${ids.payer}', 'CO', 'enrollment', 'in_progress'),
  ('${ids.caseB}', '${ids.org}', '${ids.provider}', '${ids.providerGroupB}', '${ids.payer}', 'CO', 'enrollment', 'in_progress');
INSERT INTO public.tasks (
  id, org_id, case_id, provider_id, title, sop_content, status, sort_order,
  sop_template_id, sop_version, execution_type
) VALUES
  ('${ids.taskA}', '${ids.org}', '${ids.caseA}', '${ids.provider}', 'Concurrent step A',
   jsonb_build_array(jsonb_build_object('id', '${ids.stepA}', 'label', 'Form A', 'stepType', 'online_form', 'portalKey', '${portalKey}', 'order', 0, 'isCompleted', false)),
   'not_started', 1, '${ids.template}', 1, 'extension_fill'),
  ('${ids.taskB}', '${ids.org}', '${ids.caseB}', '${ids.provider}', 'Concurrent step B',
   jsonb_build_array(jsonb_build_object('id', '${ids.stepB}', 'label', 'Form B', 'stepType', 'online_form', 'portalKey', '${portalKey}', 'order', 0, 'isCompleted', false)),
   'not_started', 1, '${ids.template}', 1, 'extension_fill');
INSERT INTO public.portals (
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, is_verified, last_verified_at, proven_at,
  mapping_generation
) VALUES (
  '${ids.portal}', '${ids.org}', '${portalKey}', 'MINT-58 concurrency portal',
  '${ids.payer}', 'https://m58.example.invalid/form', 'enrollment', true,
  true, now(), now(), 1
);
INSERT INTO public.fill_sessions (
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by
) VALUES ${stepInsert("caseA", "taskA", "stepA")}, ${stepInsert("caseB", "taskB", "stepB")};

GRANT USAGE ON SCHEMA auth TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
GRANT SELECT ON public.memberships, public.profiles, public.payers, public.portals,
  public.case_facilities, public.fill_sessions, public.touches, public.tasks,
  public.credential_cases TO service_role;
GRANT INSERT ON public.touches, public.audit_log TO service_role;
GRANT UPDATE ON public.tasks, public.credential_cases TO service_role;
GRANT UPDATE ON public.portals TO service_role;
CREATE POLICY m58_race_memberships_select_${policySuffix} ON public.memberships
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_profiles_select_${policySuffix} ON public.profiles
  FOR SELECT TO service_role USING (id = '${ids.actor}');
CREATE POLICY m58_race_payers_select_${policySuffix} ON public.payers
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_portals_select_${policySuffix} ON public.portals
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_portals_update_${policySuffix} ON public.portals
  FOR UPDATE TO service_role USING (org_id = '${ids.org}') WITH CHECK (org_id = '${ids.org}');
CREATE POLICY m58_race_facilities_select_${policySuffix} ON public.case_facilities
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_fills_select_${policySuffix} ON public.fill_sessions
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_fills_insert_${policySuffix} ON public.fill_sessions
  FOR INSERT TO service_role WITH CHECK (org_id = '${ids.org}');
CREATE POLICY m58_race_touches_select_${policySuffix} ON public.touches
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_touches_insert_${policySuffix} ON public.touches
  FOR INSERT TO service_role WITH CHECK (org_id = '${ids.org}');
CREATE POLICY m58_race_tasks_select_${policySuffix} ON public.tasks
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_tasks_update_${policySuffix} ON public.tasks
  FOR UPDATE TO service_role USING (org_id = '${ids.org}') WITH CHECK (org_id = '${ids.org}');
CREATE POLICY m58_race_cases_select_${policySuffix} ON public.credential_cases
  FOR SELECT TO service_role USING (org_id = '${ids.org}');
CREATE POLICY m58_race_cases_update_${policySuffix} ON public.credential_cases
  FOR UPDATE TO service_role USING (org_id = '${ids.org}') WITH CHECK (org_id = '${ids.org}');
CREATE POLICY m58_race_audit_insert_${policySuffix} ON public.audit_log
  FOR INSERT TO service_role WITH CHECK (org_id = '${ids.org}');

CREATE FUNCTION public.m58_concurrency_sleep()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('mint58.race_sleep_task', true) = NEW.id::text THEN
            PERFORM pg_catalog.pg_sleep(2);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER zz_m58_concurrency_sleep
  BEFORE UPDATE ON public.tasks FOR EACH ROW
  EXECUTE FUNCTION public.m58_concurrency_sleep();
COMMIT;
`);
  setupCommitted = true;

  const first = startPsql(
    touchCall("caseA", "taskA", "stepA", "fillA", "receiptA", "touchA", appA),
    appA,
  );
  const second = startPsql(
    touchCall("caseB", "taskB", "stepB", "fillB", "receiptB", "touchB", appB),
    appB,
  );
  await waitForBothSessionsToOverlap();
  const settled = await Promise.allSettled([first.done, second.done]);
  const failures = settled.filter((result) => result.status === "rejected");
  if (failures.length > 0) throw new Error(failures.map((failure) => failure.reason).join("; "));
  const results = settled.map((result) =>
    result.status === "fulfilled" ? finalSqlResult(result.value) : "",
  );
  assert(
    results.every((result) => result === "created"),
    `expected both creates, got ${results}`,
  );

  const persisted = runPsql(`
    SELECT (
      (SELECT count(*) = 2 FROM public.touches
        WHERE org_id = '${ids.org}' AND fill_session_id IN ('${ids.fillA}', '${ids.fillB}')
          AND submission_request_fingerprint ~ '^[0-9a-f]{64}$')
      AND (SELECT count(*) = 2 FROM public.tasks
        WHERE org_id = '${ids.org}' AND status = 'completed'
          AND sop_content->0->>'isCompleted' = 'true')
      AND (SELECT count(*) = 2 FROM public.credential_cases
        WHERE org_id = '${ids.org}' AND case_status = 'submitted')
    )::text;
  `);
  assert(persisted === "true", `concurrent step/touch state was not preserved: ${persisted}`);
} finally {
  if (setupCommitted) runPsql(cleanup);
}

process.stdout.write(
  "MINT-58 concurrent typed submission passed: independent Enrollment steps overlapped and both completions/touches persisted.\n",
);

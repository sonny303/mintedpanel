#!/usr/bin/env node
// Two-session proof that MINT-60's exact portal lock serializes against MINT-57
// capture writes. Run only against disposable migration CI/local PostgreSQL.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const psqlBinary = process.env.MINT60_PSQL_BIN || "psql";
const ids = Object.fromEntries(
  ["org", "actor", "payer", "portal"].map((key) => [key, randomUUID()]),
);
const portalKey = `mint60_race_${ids.org.replaceAll("-", "").slice(0, 16)}`;

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

async function cleanup() {
  await runPsql(`
    BEGIN;
    ALTER TABLE public.form_mapping_reset_events
      DISABLE TRIGGER form_mapping_reset_events_append_only;
    DELETE FROM public.form_mapping_reset_events WHERE portal_id = '${ids.portal}';
    ALTER TABLE public.form_mapping_reset_events
      ENABLE TRIGGER form_mapping_reset_events_append_only;
    DELETE FROM public.portal_field_maps
     WHERE org_id = '${ids.org}' AND portal_key = '${portalKey}';
    DELETE FROM public.portals WHERE id = '${ids.portal}';
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
  INSERT INTO public.portals (
    id, org_id, portal_key, name, payer_id, form_url, case_type,
    requires_explicit_selection, mapping_generation, is_verified, last_verified_at, proven_at
  ) VALUES (
    '${ids.portal}', '${ids.org}', '${portalKey}', 'MINT-60 race form',
    '${ids.payer}', 'https://m60.example.invalid/form', 'enrollment',
    true, 1, true, now(), now()
  );
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
} finally {
  await cleanup();
}

process.stdout.write(
  "MINT-60 lock/recheck race passed: stale capture waited for reset, then rejected.\n",
);

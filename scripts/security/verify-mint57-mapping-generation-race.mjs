#!/usr/bin/env node
// Two-session proof that mapping writes wait for a reset's exact portal lock,
// then re-check their submitted generation before inserting selector rows.
// Run only against the disposable PostgreSQL database in migration CI.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const psqlBinary = process.env.MINT57_PSQL_BIN || "psql";
const ids = Object.fromEntries(
  ["org", "actor", "payer", "portal"].map((key) => [key, randomUUID()]),
);
const portalKey = `mint57_race_${ids.org.replaceAll("-", "").slice(0, 16)}`;

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
  return {
    child,
    get stdout() {
      return stdout;
    },
    done,
  };
}

async function waitForResetLock(applicationName, resetProcess, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (resetProcess.child.exitCode !== null) {
      const result = await resetProcess.done;
      throw new Error(`reset session ended before acquiring its lock: ${result.stderr}`);
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

function runPsql(sql) {
  return startPsql(sql).done;
}

async function cleanup() {
  await runPsql(`
    BEGIN;
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
  VALUES ('${ids.actor}', 'mint57-${ids.actor}@example.invalid');
  INSERT INTO public.profiles (id, full_name, email)
  VALUES ('${ids.actor}', 'MINT-57 race actor', 'mint57-${ids.actor}@example.invalid');
  INSERT INTO public.organizations (id, name)
  VALUES ('${ids.org}', 'MINT-57 race ${ids.org}');
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES ('${ids.org}', '${ids.actor}', 'specialist');
  INSERT INTO public.payers (id, org_id, name)
  VALUES ('${ids.payer}', '${ids.org}', 'MINT-57 race payer');
  INSERT INTO public.portals (
    id, org_id, portal_key, name, payer_id, case_type, requires_explicit_selection
  ) VALUES (
    '${ids.portal}', '${ids.org}', '${portalKey}', 'MINT-57 race form',
    '${ids.payer}', 'enrollment', true
  );
  COMMIT;
`);

try {
  const resetApplicationName = `mint57-reset-${ids.org}`;
  const reset = startPsql(
    `
    BEGIN;
    SELECT id FROM public.portals WHERE id = '${ids.portal}' FOR UPDATE;
    SELECT pg_sleep(2);
    SET LOCAL minted.expected_mapping_generation = '1';
    SET LOCAL minted.mapping_reset = 'true';
    UPDATE public.portals SET mapping_generation = 2 WHERE id = '${ids.portal}';
    COMMIT;
  `,
    resetApplicationName,
  );
  await waitForResetLock(resetApplicationName, reset);
  const writeStartedAt = Date.now();
  const capture = startPsql(`
    SELECT public.capture_org_portal_field_map(
      '${ids.org}', 1,
      '{"portal_key":"${portalKey}","selector":"#race","field_label":"Race field","field_type":"text"}'::jsonb
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
  assert(waitedMs >= 500, `capture did not wait on reset lock (${waitedMs}ms)`);

  const persisted = await runPsql(`
    SELECT mapping_generation::text || ',' || (
      SELECT count(*)::text FROM public.portal_field_maps
       WHERE org_id = '${ids.org}' AND portal_key = '${portalKey}'
    )
      FROM public.portals WHERE id = '${ids.portal}';
  `);
  assert(persisted.code === 0, `could not verify race result: ${persisted.stderr}`);
  assert(
    persisted.stdout === "2,0",
    `expected generation 2 with no stale map, got ${persisted.stdout}`,
  );
} finally {
  await cleanup();
}

process.stdout.write(
  "MINT-57 lock/recheck race passed: stale capture waited for reset, then rejected.\n",
);

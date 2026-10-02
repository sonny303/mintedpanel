// MINT-19 authorization and two-session concurrency proof. This verifier only
// accepts a local PostgreSQL host/socket; CI invokes it against its ephemeral
// postgres service after applying the ordered repository migrations.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const psqlBin = process.env.MINT19_PSQL_BIN || "psql";
const psqlArgs = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
const pgHost = process.env.PGHOST || "";
const pgDatabase = process.env.PGDATABASE || "";

if (!(
  pgHost === "localhost" ||
  pgHost === "127.0.0.1" ||
  pgHost === "::1" ||
  pgHost.startsWith("/")
)) {
  throw new Error("MINT19_LOCAL_POSTGRES_REQUIRED");
}
if (!pgDatabase || pgDatabase.includes("/")) throw new Error("MINT19_PGDATABASE_REQUIRED");

function runPsql(input, extraEnv = {}) {
  const result = spawnSync(psqlBin, psqlArgs, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    input,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`MINT19_PSQL_FAILED:${result.stderr || result.status}`);
  }
  return result.stdout.trim();
}

function escapeSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function uuid() {
  return randomUUID();
}

function startPsql(input, appName) {
  const child = spawn(psqlBin, psqlArgs, {
    cwd: root,
    env: { ...process.env, PGAPPNAME: appName },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdin.end(input);
  return {
    child,
    get output() {
      return stdout;
    },
    get errors() {
      return stderr;
    },
  };
}

function waitForExit(process, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.child.kill("SIGKILL");
      reject(new Error("MINT19_PSQL_SESSION_TIMEOUT"));
    }, timeoutMs);
    process.child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`MINT19_PSQL_SESSION_FAILED:${process.errors || code}`));
      } else resolve(process.output);
    });
  });
}

async function pollSql(sql, expected, timeoutMs = 5_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = runPsql(`${sql}\n`).trim();
    if (value === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const ids = {
  org: uuid(),
  user1: uuid(),
  user2: uuid(),
  provider: uuid(),
  task: uuid(),
};
const app1 = `m19-first-${ids.task.slice(0, 8)}`;
const app2 = `m19-second-${ids.task.slice(0, 8)}`;
const escaped = Object.fromEntries(
  Object.entries(ids).map(([key, value]) => [key, escapeSql(value)]),
);

const cleanup = `
BEGIN;
DROP TRIGGER IF EXISTS zz_mint19_concurrency_sleep ON public.tasks;
DROP FUNCTION IF EXISTS public.mint19_concurrency_sleep();
DELETE FROM public.audit_log WHERE org_id = ${escaped.org};
DELETE FROM public.tasks WHERE id = ${escaped.task};
DELETE FROM public.providers WHERE id = ${escaped.provider};
DELETE FROM public.memberships WHERE org_id = ${escaped.org};
DELETE FROM auth.users WHERE id IN (${escaped.user1}, ${escaped.user2});
-- Organization creation seeds immutable roster-template defaults. These rows
-- are only the synthetic org's test fixture, so disable its mutation guard
-- during isolated cleanup, then restore it before deleting the org.
ALTER TABLE public.roster_templates DISABLE TRIGGER USER;
DELETE FROM public.roster_templates WHERE org_id = ${escaped.org};
ALTER TABLE public.roster_templates ENABLE TRIGGER USER;
DELETE FROM public.organizations WHERE id = ${escaped.org};
COMMIT;
`;

let setupStarted = false;
try {
  const sqlPacket = readFileSync(`${root}supabase/tests/mint19-atomic-sop.sql`, "utf8");
  const packetOutput = runPsql(sqlPacket.replace(/^\\(set|pset).*\n/gm, ""));
  if (!packetOutput.includes("MINT19|RESULT|PASS|")) {
    throw new Error("MINT19_SQL_PACKET_DID_NOT_REPORT_PASS");
  }
  process.stdout.write(
    `${packetOutput.split("\n").find((line) => line.includes("MINT19|RESULT|PASS|"))}\n`,
  );

  const setup = `
BEGIN;
INSERT INTO public.organizations (id, name) VALUES (${escaped.org}, 'MINT-19 concurrency org');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (${escaped.user1}, 'm19-concurrency-1@example.test', '{}'::jsonb),
  (${escaped.user2}, 'm19-concurrency-2@example.test', '{}'::jsonb);
INSERT INTO public.profiles (id, full_name, email) VALUES
  (${escaped.user1}, 'MINT-19 Concurrent Writer 1', 'm19-concurrency-1@example.test'),
  (${escaped.user2}, 'MINT-19 Concurrent Writer 2', 'm19-concurrency-2@example.test');
INSERT INTO public.memberships (org_id, user_id, role) VALUES
  (${escaped.org}, ${escaped.user1}, 'specialist'),
  (${escaped.org}, ${escaped.user2}, 'specialist');
INSERT INTO public.providers (id, org_id, first_name, last_name) VALUES
  (${escaped.provider}, ${escaped.org}, 'MINT-19', 'Concurrent Provider');
INSERT INTO public.tasks (id, org_id, provider_id, title, status, sop_content) VALUES
  (${escaped.task}, ${escaped.org}, ${escaped.provider}, 'MINT-19 concurrent task', 'not_started',
   '[{"id":"first","order":1,"label":"First parallel step","isCompleted":false},{"id":"second","order":1,"label":"Second parallel step","isCompleted":false}]'::jsonb);
CREATE FUNCTION public.mint19_concurrency_sleep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.id = ${escaped.task}
     AND pg_catalog.current_setting('mint19.sleep_task', true) = NEW.id::text THEN
    PERFORM pg_catalog.pg_sleep(1.5);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER zz_mint19_concurrency_sleep
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.mint19_concurrency_sleep();
COMMIT;
`;
  runPsql(setup);
  setupStarted = true;

  const firstCall = startPsql(
    `BEGIN;
SET LOCAL application_name = ${escapeSql(app1)};
SELECT pg_catalog.set_config('request.jwt.claim.sub', ${escaped.user1}, true);
SELECT pg_catalog.set_config('mint19.sleep_task', ${escaped.task}, true);
SET LOCAL ROLE authenticated;
SELECT public.complete_sop_task_step(${escaped.org}, ${escaped.task}, 'first', ${escaped.user1}, 'panel');
COMMIT;
`,
    app1,
  );

  const firstSleeping = await pollSql(
    `SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name=${escapeSql(app1)} AND wait_event='PgSleep'`,
    "1",
  );
  if (!firstSleeping) throw new Error("MINT19_FIRST_SESSION_NEVER_HELD_TASK_LOCK");

  const secondCall = startPsql(
    `BEGIN;
SET LOCAL application_name = ${escapeSql(app2)};
SELECT pg_catalog.set_config('request.jwt.claim.sub', ${escaped.user2}, true);
SET LOCAL ROLE authenticated;
SELECT public.complete_sop_task_step(${escaped.org}, ${escaped.task}, 'second', ${escaped.user2}, 'panel');
COMMIT;
`,
    app2,
  );

  const secondWaitingForLock = await pollSql(
    `SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name=${escapeSql(app2)} AND wait_event_type='Lock'`,
    "1",
  );
  if (!secondWaitingForLock) throw new Error("MINT19_SECOND_SESSION_DID_NOT_WAIT_ON_TASK_LOCK");

  await Promise.all([waitForExit(firstCall), waitForExit(secondCall)]);

  const persisted = runPsql(`
SELECT (t.status = 'completed'
        AND t.completed_date IS NOT NULL
        AND pg_catalog.bool_and(s.step ->> 'isCompleted' = 'true')
        AND count(DISTINCT a.id) = 2)::text
  FROM public.tasks AS t
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(t.sop_content) AS s(step)
  LEFT JOIN public.audit_log AS a ON a.entity_id = t.id AND a.org_id = t.org_id
 WHERE t.id = ${escaped.task}
 GROUP BY t.status, t.completed_date;
`).trim();
  if (persisted !== "true") throw new Error(`MINT19_CONCURRENT_STEPS_NOT_PRESERVED:${persisted}`);

  process.stdout.write("MINT19|CONCURRENCY|PASS|two-step row-lock serialization\n");
} finally {
  if (setupStarted) runPsql(cleanup);
}

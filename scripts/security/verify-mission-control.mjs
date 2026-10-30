// Mission Control M1 regressions in a new synthetic-only PostgreSQL container:
// platform-admin authorization, the admin audit ledger, the four additive
// metadata policies, and platform_metrics(). No existing database, network,
// data mount, hosted credentials, or image pull.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.MISSION_CONTROL_DOCKER_CONTEXT || "default";
const container = `minted-mission-control-${randomUUID()}`;
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);
const options = { env, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 };
const emit = (message) => process.stdout.write(`${message}\n`);
const fail = (message) => {
  throw new Error(message);
};
const inspect = JSON.parse(execFileSync("docker", ["context", "inspect", context], options))[0];
const endpoint = inspect?.Endpoints?.docker?.Host;
if (typeof endpoint !== "string" || !endpoint.startsWith("unix://")) fail("LOCAL_DOCKER_REQUIRED");
const docker = (args, input) =>
  execFileSync("docker", ["--host", endpoint, ...args], {
    ...options,
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
const sql = (input) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-XqAt",
      "-h",
      "/tmp",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    input,
  );
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Leak modes: each prepends one regression inside the packet's transaction
// and must turn the packet red on the named label. Nothing is committed.
const leaks = [
  {
    name: "tenant table widened for platform admins",
    sql: "CREATE POLICY mc_leak_providers ON public.providers FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));",
    label: "admin.nonmember_org_providers_zero",
  },
  {
    name: "ledger UPDATE granted to authenticated",
    sql: "GRANT UPDATE ON public.admin_audit_log TO authenticated;",
    label: "ledger.update_denied_42501",
  },
  {
    name: "platform_admins readable by every member",
    sql: "CREATE POLICY mc_leak_platform_admins ON public.platform_admins FOR SELECT TO authenticated USING (true);",
    label: "member.platform_admins_zero_rows",
  },
];

let started = false;
try {
  const image = docker(["image", "inspect", "postgres:16", "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) fail("CACHED_POSTGRES_IMAGE_REQUIRED");
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "postgres",
    "--tmpfs",
    "/tmp:rw,mode=1777",
    "--entrypoint",
    "/bin/sh",
    image,
    "-c",
    "initdb -D /tmp/mc-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/mc-data -k /tmp -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic",
  ]);
  started = true;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await pause(100);
    }
  }
  if (!ready) fail("LOCAL_POSTGRES_NOT_READY");
  sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      email_confirmed_at timestamptz,
      banned_until timestamptz,
      deleted_at timestamptz,
      is_anonymous boolean NOT NULL DEFAULT false,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), ''); $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb); $$;
    CREATE EXTENSION pgcrypto WITH SCHEMA public; CREATE EXTENSION "uuid-ossp" WITH SCHEMA public;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  const migrations = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations) {
    try {
      sql(readFileSync(`${root}supabase/migrations/${name}`, "utf8"));
    } catch {
      fail(`MIGRATION_FAILED:${name}`);
    }
  }
  emit(`PASS: ${migrations.length} repository migrations applied`);

  const packet = readFileSync(`${root}supabase/tests/mission-control-security.sql`, "utf8");
  const output = sql(packet);
  if (!output.includes("MISSION_CONTROL_SECURITY|PASS")) fail("MISSION_CONTROL_PACKET_FAILED");
  const labels = output
    .split("\n")
    .filter((line) => line.endsWith("|PASS") && line !== "MISSION_CONTROL_SECURITY|PASS");
  emit(`PASS: ${labels.length} mission control assertions`);
  for (const line of labels) emit(`  ${line}`);

  for (const leak of leaks) {
    let caught = false;
    try {
      sql(`BEGIN;\n${leak.sql}\n${packet}`);
    } catch (error) {
      const detail = String(error.stderr);
      caught =
        detail.includes("MISSION_CONTROL_SECURITY_TEST_FAILED") && detail.includes(leak.label);
    }
    if (!caught) fail(`LEAK_NOT_DETECTED:${leak.name}`);
    emit(`PASS: leak mode "${leak.name}" turns ${leak.label} red`);
  }
  const persisted = sql(
    "SELECT (SELECT count(*) FROM pg_policies WHERE policyname LIKE 'mc\\_leak%') + (has_table_privilege('authenticated', 'public.admin_audit_log', 'UPDATE'))::int;",
  ).trim();
  if (persisted !== "0") fail("LEAK_MODE_PERSISTED");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "MISSION_CONTROL_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  if (started) {
    docker(["rm", "--force", container]);
    emit("PASS: owned synthetic test container removed");
  }
}

// Real V1/V2 fill-session authorization and integrity checks in an owned,
// disposable PostgreSQL container only. This script accepts no DB URL and
// never connects to an existing database or container.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(new URL(path, `file://${root}`), "utf8");
const context = process.env.FILLER_OUTCOMES_DOCKER_CONTEXT || "colima-minted-staging-recovery";
const image = process.env.FILLER_OUTCOMES_POSTGRES_IMAGE || "postgres:16";
const container = `minted-fill-outcomes-${randomUUID()}`;
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((name) =>
    process.env[name] ? [[name, process.env[name]]] : [],
  ),
);
const fail = (code) => {
  throw new Error(code);
};
const emit = (message) => process.stdout.write(`${message}\n`);

const docker = (args, input) => {
  try {
    return execFileSync("docker", ["--context", context, ...args], {
      env,
      input,
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const state = String(error.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5})\s*(?:\n|$)/)?.[1];
    if (state) emit(`FILLER|SQLSTATE|${state}`);
    fail("FILLER_CONTAINER_COMMAND_FAILED");
  }
};

const sql = (input) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-h",
      "/tmp",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=sqlstate",
    ],
    input,
  );

const bootstrap = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
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
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
      'role', nullif(current_setting('request.jwt.claim.role', true), '')
    )
  );
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
`;

let started = false;
try {
  const contextInfo = JSON.parse(docker(["context", "inspect", context]));
  const endpoint = contextInfo?.[0]?.Endpoints?.docker?.Host;
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://")) {
    fail("FILLER_LOCAL_DOCKER_CONTEXT_REQUIRED");
  }

  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("FILLER_LOCAL_POSTGRES_IMAGE_REQUIRED");

  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--memory",
    "512m",
    "--label",
    "com.minted.filler-outcomes=synthetic-only",
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
    imageId,
    "-c",
    "initdb -D /tmp/filler-outcomes-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/filler-outcomes-data -k /tmp -c shared_buffers=32MB -c max_connections=20 -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
  ]);
  started = true;

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) fail("FILLER_DATABASE_NOT_READY");

  const migrations = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (!migrations.includes("20260926052400_filler_outcome_v2_contract.sql")) {
    fail("FILLER_MIGRATION_REQUIRED");
  }

  sql(bootstrap);
  for (const migration of migrations) {
    try {
      sql(read(`supabase/migrations/${migration}`));
    } catch {
      // Migration filenames are repository-controlled and safe to emit; SQL
      // contents and driver diagnostics can contain sensitive fixture data.
      emit(`FILLER|MIGRATION|${migration}`);
      fail("FILLER_MIGRATION_REPLAY_FAILED");
    }
  }
  // Supabase's service role bypasses RLS. Keep CI's role bootstrap during
  // migration replay, then set that production-equivalent attribute for tests.
  sql("ALTER ROLE service_role BYPASSRLS;");

  const output = sql(read("supabase/tests/filler-outcomes-security.sql"));
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  if (
    !lines.every(
      (line) =>
        /^FILLER\|(PASS|FAIL)\|[a-z0-9_.-]+$/.test(line) || /^FILLER\|COUNT\|[0-9]+$/.test(line),
    )
  ) {
    fail("FILLER_UNEXPECTED_TEST_OUTPUT");
  }
  const assertions = lines.filter((line) => /^FILLER\|(PASS|FAIL)\|/.test(line));
  const failures = assertions.filter((line) => line.startsWith("FILLER|FAIL|"));
  if (assertions.length < 25 || lines.at(-1) !== `FILLER|COUNT|${assertions.length}`) {
    fail("FILLER_INCOMPLETE_TEST_OUTPUT");
  }

  emit(`FILLER|IMAGE|${imageId}`);
  emit(`FILLER|POSTGRES|${sql("SHOW server_version;").trim()}`);
  for (const line of assertions) emit(line);
  emit(`FILLER|COUNT|${assertions.length}`);
  if (failures.length) fail("FILLER_ASSERTIONS_FAILED");
} catch (error) {
  const code =
    error instanceof Error && /^FILLER_[A-Z_]+$/.test(error.message)
      ? error.message
      : "FILLER_RUN_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
      emit("FILLER|CLEANUP|PASS");
    } catch {
      process.stderr.write("FILLER_CLEANUP_FAILED\n");
      process.exitCode = 1;
    }
  }
}

// WP13: real SQL tests in a newly owned PostgreSQL container only.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(new URL(path, "file://" + root), "utf8");
const context = process.env.P01_DOCKER_CONTEXT || "default";
const image = process.env.WP13_POSTGRES_IMAGE || "postgres:16";
const container = "minted-roster-wp13-" + randomUUID();
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((name) =>
    process.env[name] ? [[name, process.env[name]]] : [],
  ),
);
const fail = (code) => {
  throw new Error(code);
};
const emit = (message) => process.stdout.write(message + "\n");
const docker = (args, input) => {
  try {
    return execFileSync("docker", ["--context", context, ...args], {
      env,
      input,
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const state = String(error.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5})\s*(?:\n|$)/)?.[1];
    if (state) process.stderr.write("WP13|SQLSTATE|" + state + "\n");
    fail("WP13_CONTAINER_COMMAND_FAILED");
  }
};
const sql = (database, input) =>
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
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=sqlstate",
    ],
    input,
  );

let started = false;
try {
  const endpoint = JSON.parse(docker(["context", "inspect", context]))[0]?.Endpoints?.docker?.Host;
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://"))
    fail("WP13_LOCAL_DOCKER_REQUIRED");
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("WP13_LOCAL_IMAGE_REQUIRED");
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
    "com.minted.wp13=synthetic-only",
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
    "initdb -D /tmp/wp13-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/wp13-data -k /tmp -c shared_buffers=32MB -c max_connections=20 -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
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
  if (!ready) fail("WP13_DATABASE_NOT_READY");

  sql(
    "postgres",
    [
      "CREATE ROLE anon NOLOGIN;",
      "CREATE ROLE authenticated NOLOGIN;",
      "CREATE ROLE service_role NOLOGIN BYPASSRLS;",
      "CREATE SCHEMA auth;",
      "CREATE SCHEMA extensions;",
      "CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb);",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;",
      "GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;",
    ].join("\n"),
  );
  sql("postgres", read("supabase/migrations/20260704210000_baseline_live_schema.sql"));
  sql("postgres", read("supabase/migrations/20260712120000_provider_group_assignments.sql"));
  sql("postgres", read("supabase/migrations/20260712150000_pfa_start_date_check.sql"));
  sql(
    "postgres",
    [
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;",
    ].join("\n"),
  );
  sql("postgres", read("supabase/migrations/20260925203025_wp13_roster_engine_tables.sql"));
  const output = sql("postgres", read("supabase/tests/roster-engine-security.sql"));
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  if (
    !lines.every(
      (line) =>
        /^WP13\|(PASS|FAIL)\|[a-z0-9_.-]+$/.test(line) || /^WP13\|COUNT\|[0-9]+$/.test(line),
    )
  ) {
    fail("WP13_UNEXPECTED_TEST_OUTPUT");
  }
  const assertions = lines.filter((line) => /^WP13\|(PASS|FAIL)\|/.test(line));
  const failures = assertions.filter((line) => line.startsWith("WP13|FAIL|"));
  if (assertions.length < 20 || lines.at(-1) !== "WP13|COUNT|" + assertions.length)
    fail("WP13_INCOMPLETE_TEST_OUTPUT");
  emit("WP13|IMAGE|" + imageId);
  emit("WP13|POSTGRES|" + sql("postgres", "SHOW server_version;").trim());
  for (const line of assertions) emit(line);
  emit("WP13|COUNT|" + assertions.length);
  if (failures.length) fail("WP13_ASSERTIONS_FAILED");
} catch (error) {
  const code =
    error instanceof Error && /^WP13_[A-Z_]+$/.test(error.message)
      ? error.message
      : "WP13_RUN_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
      emit("WP13|CLEANUP|PASS");
    } catch {
      process.stderr.write("WP13_CLEANUP_FAILED\n");
      process.exitCode = 1;
    }
  }
}

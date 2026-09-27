// P01 / DB-01: real SQL authorization tests, only in a newly owned container.
// No database URL, existing container, hosted credentials or data mounts accepted.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(new URL(path, `file://${root}`), "utf8");
const fail = (code) => {
  throw new Error(code);
};
const options = process.argv.slice(2);
const baselineOnly = options.includes("--baseline-only");
const context = process.env.P01_DOCKER_CONTEXT || "default";
const image = process.env.P01_POSTGRES_IMAGE || "postgres:16";
if (options.some((arg) => arg !== "--baseline-only")) fail("P01_UNKNOWN_ARGUMENT");
const container = `minted-p01-${randomUUID()}`;
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((name) =>
    process.env[name] ? [[name, process.env[name]]] : [],
  ),
);
const docker = (args, input) => {
  try {
    return execFileSync("docker", ["--context", context, ...args], {
      env,
      input,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    // Never relay SQL, container logs, command inputs or raw provider errors.
    const state = String(error.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5})\s*(?:\n|$)/)?.[1];
    if (state) process.stderr.write(`P01|SQLSTATE|${state}\n`);
    fail("P01_CONTAINER_COMMAND_FAILED");
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
const emit = (message) => process.stdout.write(`${message}\n`);

const bootstrap = `
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
`;
const originalSources = [
  "20260704210000_baseline_live_schema.sql",
  "20260710130000_public_rpc_rate_limiting.sql",
  "20260712150200_audit_log_delete_action_type.sql",
  "20260717120000_ssn_vault.sql",
  "20260717120100_ssn_intake_links.sql",
  "20260718020000_ssn_vault_key_via_supabase_vault.sql",
];
const migrations = readdirSync(`${root}supabase/migrations`)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const repair = migrations.filter((name) => name.endsWith("_p01_vault_authorization.sql"));
if (!baselineOnly && repair.length !== 1) fail("P01_REPAIR_MIGRATION_REQUIRED");

// Fail if another migration changes this boundary without updating the fixture.
const boundary =
  /(?:FUNCTION|ON)\s+(?:public\.)?(?:store_ssn|reveal_ssn|create_ssn_intake_link|release_ssn_for_fill|validate_ssn_intake_token|submit_ssn_intake|_ssn_\w+|user_role|user_org_ids|check_rpc_throttle|mark_rpc_attempt_valid|provider_ssn_vault|provider_ssn_intake_links)\b/i;
for (const name of migrations) {
  if (
    !originalSources.includes(name) &&
    !repair.includes(name) &&
    boundary.test(read(`supabase/migrations/${name}`))
  ) {
    fail("P01_BOUNDARY_SOURCE_SET_CHANGED");
  }
}
const fixtureSource = originalSources
  .map((name) => {
    const source = read(`supabase/migrations/${name}`);
    if (!name.includes("public_rpc_rate_limiting")) return source;
    // Include the actual attempt table and both private helpers, not unrelated RPCs.
    const marker = "-- 4a. Redefine validate_capture_token with throttle";
    if (source.split(marker).length !== 2) fail("P01_THROTTLE_SOURCE_CHANGED");
    const prefix = source.slice(0, source.indexOf(marker));
    if (
      !prefix.includes(
        "REVOKE ALL ON FUNCTION public.mark_rpc_attempt_valid(text) FROM public, anon, authenticated;",
      )
    ) {
      fail("P01_THROTTLE_REVOKE_MISSING");
    }
    return prefix;
  })
  .join("\n");
const suite = read("supabase/tests/p01-vault-authorization.sql");

function runSuite(database, repaired) {
  emit(`P01|PHASE|${database}`);
  sql("postgres", `CREATE DATABASE ${database};`);
  sql(database, `${bootstrap}\n${fixtureSource}\nSET check_function_bodies = true;`);
  if (repaired) sql(database, read(`supabase/migrations/${repair[0]}`));
  const output = sql(database, suite);
  const lines = output.trim().split(/\r?\n/);
  if (
    !lines.every(
      (line) => /^P01\|(PASS|FAIL)\|[a-z0-9_.-]+$/.test(line) || /^P01\|COUNT\|[0-9]+$/.test(line),
    )
  ) {
    fail("P01_UNEXPECTED_TEST_OUTPUT");
  }
  const assertions = lines.filter((line) => /^P01\|(PASS|FAIL)\|/.test(line));
  if (lines.at(-1) !== `P01|COUNT|${assertions.length}` || assertions.length < 50) {
    fail("P01_INCOMPLETE_TEST_OUTPUT");
  }
  for (const line of lines) emit(`${repaired ? "after" : "before"}|${line}`);
  return assertions.filter((line) => line.startsWith("P01|FAIL|")).map((line) => line.slice(9));
}

let started = false;
try {
  const endpoint = JSON.parse(docker(["context", "inspect", context]))[0]?.Endpoints?.docker?.Host;
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://"))
    fail("P01_LOCAL_DOCKER_REQUIRED");
  // Pin the locally present image ID for this run; never pull implicitly.
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("P01_LOCAL_IMAGE_REQUIRED");
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--label",
    "com.minted.p01=synthetic-only",
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
    "initdb -D /tmp/p01-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/p01-data -k /tmp -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) fail("P01_DATABASE_NOT_READY");
  emit(`P01|IMAGE|${imageId}`);
  emit(`P01|POSTGRES|${sql("postgres", "SHOW server_version;").trim()}`);
  sql(
    "postgres",
    "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;",
  );
  const before = runSuite("p01_before", false);
  if (baselineOnly) {
    process.exitCode = before.length ? 1 : 0;
  } else {
    // Expected failures are filled from the fixed regression labels, never inferred
    // from whichever assertions happened to fail during this invocation.
    const expected = [
      "deny.nonmember.store",
      "deny.nonmember.reveal",
      "deny.nonmember.issue",
      "deny.wrong_org.store",
      "deny.wrong_org.reveal",
      "deny.wrong_org.issue",
    ];
    if (JSON.stringify(before.toSorted()) !== JSON.stringify(expected.toSorted()))
      fail("P01_BASELINE_FAILURE_SET_CHANGED");
    const after = runSuite("p01_after", true);
    if (after.length) fail("P01_REPAIRED_ASSERTIONS_FAILED");
    emit("P01|REGRESSION|PASS");
  }
} catch (error) {
  const code =
    error instanceof Error && /^P01_[A-Z_]+$/.test(error.message)
      ? error.message
      : "P01_RUN_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
      emit("P01|CLEANUP|PASS");
    } catch {
      process.stderr.write("P01_CLEANUP_FAILED\n");
      process.exitCode = 1;
    }
  }
}

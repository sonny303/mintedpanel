// MINT-8 actor integrity, exercised against a new local PostgreSQL container.
// This verifier accepts no database URL, has no network, and mounts no data.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.MINT8_DOCKER_CONTEXT || "default";
const image = process.env.MINT8_POSTGRES_IMAGE || "postgres:16";
const container = `minted-mint8-audit-${randomUUID()}`;
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
    if (state) emit(`MINT8|SQLSTATE|${state}`);
    fail("MINT8_CONTAINER_COMMAND_FAILED");
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
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA private;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
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
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth, extensions, private TO anon, authenticated, service_role;
`;

let started = false;
try {
  const contextInfo = JSON.parse(docker(["context", "inspect", context]));
  const endpoint = contextInfo?.[0]?.Endpoints?.docker?.Host;
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://")) {
    fail("MINT8_LOCAL_DOCKER_CONTEXT_REQUIRED");
  }

  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"])
    .trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("MINT8_CACHED_POSTGRES_IMAGE_REQUIRED");

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
    "initdb -D /tmp/mint8-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/mint8-data -k /tmp -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
  ]);
  started = true;

  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ready) fail("MINT8_LOCAL_POSTGRES_NOT_READY");

  sql(bootstrap);
  const baseline = "20260704210000_baseline_live_schema.sql";
  try {
    sql(readFileSync(`${root}supabase/migrations/${baseline}`, "utf8"));
  } catch {
    fail(`MINT8_MIGRATION_FAILED:${baseline}`);
  }

  emit(
    sql(
      readFileSync(
        `${root}supabase/tests/mint8-audit-actor-integrity-pre-migration.sql`,
        "utf8",
      ),
    ).trim(),
  );

  const actorMigration = "20261006140000_mint8_audit_actor_integrity.sql";
  try {
    sql(readFileSync(`${root}supabase/migrations/${actorMigration}`, "utf8"));
  } catch {
    fail(`MINT8_MIGRATION_FAILED:${actorMigration}`);
  }

  emit(sql(readFileSync(`${root}supabase/tests/mint8-audit-actor-integrity.sql`, "utf8")).trim());
  emit("MINT8|RESULT|PASS");
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
    } catch {
      emit("MINT8|CLEANUP|FAILED");
    }
  }
}

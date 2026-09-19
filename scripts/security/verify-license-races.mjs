// P03: production service predicates against a fresh, synthetic-only PostgreSQL.
// This runner accepts no database URL, data mount, existing container, or secrets.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.P03_DOCKER_CONTEXT || "default";
const image = process.env.P03_POSTGRES_IMAGE || "postgres:16";
const runId = randomUUID();
const container = `minted-p03-${runId}`;
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);
const emit = (line) => process.stdout.write(`${line}\n`);
const fail = (code) => {
  throw new Error(code);
};
const docker = (args, input) =>
  execFileSync("docker", ["--context", context, ...args], {
    env,
    input,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
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

if (process.argv.length !== 2) fail("P03_UNKNOWN_ARGUMENT");
let started = false;
try {
  const endpoint = JSON.parse(docker(["context", "inspect", context]))[0]?.Endpoints?.docker?.Host;
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://"))
    fail("P03_LOCAL_DOCKER_REQUIRED");
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("P03_LOCAL_IMAGE_REQUIRED");
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--label",
    `com.minted.p03=${runId}`,
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
    "initdb -D /tmp/p03-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/p03-data -k /tmp -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) fail("P03_DATABASE_NOT_READY");

  // Load the actual table definitions and license constraints. RLS/hosted
  // authorization is deliberately outside this concurrency fixture's evidence.
  const baseline = readFileSync(
    `${root}supabase/migrations/20260704210000_baseline_live_schema.sql`,
    "utf8",
  );
  for (const table of ["providers", "state_licenses"]) {
    const definition = baseline.match(
      new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`),
    );
    if (!definition) fail("P03_TABLE_SOURCE_CHANGED");
    sql(definition[0]);
  }
  const constraints = baseline
    .split("\n")
    .filter(
      (line) =>
        /^ALTER TABLE ONLY public\.state_licenses ADD CONSTRAINT (state_licenses_pkey|state_licenses_license_type_check)\b/.test(
          line,
        ) || /^CREATE UNIQUE INDEX uq_state_licenses_provider_state_number\b/.test(line),
    );
  if (constraints.length !== 3) fail("P03_LICENSE_SOURCE_CHANGED");
  sql(constraints.join("\n"));
  sql(readFileSync(`${root}supabase/migrations/20260712120100_state_license_psv.sql`, "utf8"));
  emit(`P03|IMAGE|${imageId}`);
  emit(`P03|POSTGRES|${sql("SHOW server_version;").trim()}`);
  emit(`P03|ISOLATION|${sql("SHOW default_transaction_isolation;").trim()}`);
  execFileSync(
    process.execPath,
    [
      `${root}node_modules/vitest/vitest.mjs`,
      "run",
      "--config",
      "scripts/security/vitest-license-races.config.ts",
    ],
    {
      cwd: root,
      env: {
        ...env,
        P03_DOCKER_CONTEXT: context,
        P03_OWNED_CONTAINER: container,
        P03_RUN_ID: runId,
      },
      stdio: "inherit",
      timeout: 180_000,
    },
  );
  emit("P03|SERVICE_DATABASE_RACES|PASS");
} catch (error) {
  emit(
    error instanceof Error && /^P03_[A-Z_]+$/.test(error.message)
      ? error.message
      : "P03_DATABASE_RACE_RUN_FAILED",
  );
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
      emit("P03|CLEANUP|PASS");
    } catch {
      emit("P03_CLEANUP_FAILED");
      process.exitCode = 1;
    }
  }
}

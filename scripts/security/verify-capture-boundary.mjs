// Native capture RPC regressions in a new synthetic-only PostgreSQL container.
// No existing database, network, data mount, hosted credentials, or image pull.
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.CAPTURE_DOCKER_CONTEXT || "default";
const container = `minted-capture-${randomUUID()}`;
const repair = "20260923214607_repair_party_capture_link_org_guard.sql";
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
const psqlArgs = [
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
];
const sql = (input) => docker(psqlArgs, input);
const sqlAsync = async (input) => {
  const child = promisify(execFile)("docker", ["--host", endpoint, ...psqlArgs], options);
  child.child.stdin.end(input);
  return (await child).stdout;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let started = false;
let gate;
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
    "initdb -D /tmp/capture-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/capture-data -k /tmp -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic",
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
    CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    CREATE EXTENSION pgcrypto WITH SCHEMA public; CREATE EXTENSION "uuid-ossp" WITH SCHEMA public;`);
  const migrations = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations.filter((name) => name !== repair)) {
    try {
      sql(readFileSync(`${root}supabase/migrations/${name}`, "utf8"));
    } catch {
      fail(`MIGRATION_FAILED:${name}`);
    }
  }
  const regression = readFileSync(
    `${root}supabase/tests/capture-boundary-org-security.sql`,
    "utf8",
  );
  let reproduced = false;
  try {
    sql(regression);
  } catch (error) {
    const detail = String(error.stderr);
    reproduced = [
      "CAPTURE_BOUNDARY_SECURITY_TEST_FAILED",
      "used_cross_org.validate_exact_invalid",
      "active_cross_org.submit_exact_invalid",
    ].every((label) => detail.includes(label));
  }
  if (!reproduced) fail("BASELINE_DEFECT_NOT_REPRODUCED");
  emit("PASS: prior RPCs reproduce the cross-organization regression");
  sql(readFileSync(`${root}supabase/migrations/${repair}`, "utf8"));
  if (!sql(regression).includes("CAPTURE_BOUNDARY_SECURITY|PASS"))
    fail("CAPTURE_REGRESSION_FAILED");
  emit(
    "PASS: real anon/authenticated calls deny cross-org links; same-org success, replay, expiry and ACLs preserved",
  );

  // Competing callers must reach the lock wait before either may finish.
  const ids = { org: randomUUID(), party: randomUUID(), link: randomUUID(), actor: randomUUID() };
  const token = `capture-race-${randomUUID()}`;
  sql(`INSERT INTO public.organizations(id, name) VALUES ('${ids.org}', 'Synthetic capture race');
    INSERT INTO public.parties(id, org_id, party_type, name, email, created_by)
      VALUES ('${ids.party}', '${ids.org}', 'person', 'Before race', 'before@example.test', '${ids.actor}');
    INSERT INTO public.party_capture_links(id, org_id, party_id, recipient_email, token_hash, state, expires_at, created_by)
      VALUES ('${ids.link}', '${ids.org}', '${ids.party}', 'before@example.test', encode(sha256(convert_to('${token}', 'UTF8')), 'hex'), 'active', now() + interval '1 hour', '${ids.actor}');`);
  gate = spawn("docker", ["--host", endpoint, ...psqlArgs], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  gate.stderr.resume();
  const locked = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("RACE_GATE_TIMEOUT")), 5000);
    gate.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    gate.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("RACE_GATE_EXITED"));
    });
    gate.stdout.on("data", (chunk) => {
      if (String(chunk).includes("LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  gate.stdin.write(
    `BEGIN; SELECT id FROM public.parties WHERE id = '${ids.party}' FOR UPDATE; SELECT 'LOCKED';\n`,
  );
  await locked;
  const payload = JSON.stringify({
    name: "Race winner",
    email: "winner@example.test",
    phone_office: "303-555-0100",
    address_line1: "1 Test Way",
    city: "Denver",
    state: "CO",
    postal_code: "80202",
  });
  const request = `SET ROLE anon; SELECT public.submit_capture('${token}', '${payload}'::jsonb);`;
  const both = Promise.all([sqlAsync(request), sqlAsync(request)]);
  // Attach rejection handling immediately while the gate is intentionally held.
  both.catch(() => {});
  let waiting = false;
  for (let i = 0; i < 40; i++) {
    const count = Number(
      sql(
        "SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres' AND wait_event_type = 'Lock' AND query LIKE '%public.submit_capture%';",
      ).trim(),
    );
    if (count === 2) {
      waiting = true;
      break;
    }
    await pause(50);
  }
  if (!waiting) fail("TWO_CONCURRENT_CALLERS_NOT_OBSERVED");
  gate.stdin.end("COMMIT;\n");
  const results = (await both).map((output) => JSON.parse(output.trim()));
  if (
    results.filter((r) => r.ok === true && r.state === "used").length !== 1 ||
    results.filter((r) => r.ok === false && r.state === "used").length !== 1
  )
    fail("TOKEN_CONSUMED_MORE_THAN_ONCE");
  if (sql(`SELECT count(*) FROM public.audit_log WHERE entity_id = '${ids.party}';`).trim() !== "1")
    fail("RACE_AUDIT_COUNT_WRONG");
  emit(
    "PASS: two concurrent submissions produce one success, one used response, and one audit row",
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "CAPTURE_VERIFICATION_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  if (gate && gate.exitCode === null) gate.kill("SIGTERM");
  if (started) {
    docker(["rm", "--force", container]);
    emit("PASS: owned synthetic test container removed");
  }
}

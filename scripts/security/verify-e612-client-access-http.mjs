// E6.12 real HTTP evidence.
//
// This verifier owns a fresh internal Docker topology: Supabase Postgres,
// GoTrue, PostgREST, Storage API, a small in-network gateway, and the built
// Nitro node server. Every credential and fixture is synthetic and scoped to
// this run. The gateway is only transport glue so the app can use one local
// Supabase URL while Auth, REST, and Storage remain separate containers.
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { E612, baseFixtureSql, restrictedFixtureSql, sqlLiteral } from "./e612-fixtures.mjs";
import { buildManifest } from "./e612-build-manifest.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.E612_DOCKER_CONTEXT || "default";
const runId = randomUUID().replaceAll("-", "").slice(0, 16);
const label = `com.minted.e612=${runId}`;
const network = `minted-e612-http-${runId}`;
const names = Object.fromEntries(
  ["db", "auth", "rest", "storage", "gateway", "app"].map((kind) => [kind, `${network}-${kind}`]),
);
const images = {
  db:
    process.env.E612_HTTP_DB_IMAGE ||
    "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca",
  auth:
    process.env.E612_HTTP_AUTH_IMAGE ||
    "supabase/gotrue@sha256:3439d5affb9e96395d1348521f4c675eea7096d8d76d18d4e31fcc08df802116",
  rest:
    process.env.E612_HTTP_REST_IMAGE ||
    "postgrest/postgrest@sha256:ba586907588f4c03fc1d7e5c57732cec80c396a164199ceeddfc8a89b24412f0",
  storage:
    process.env.E612_HTTP_STORAGE_IMAGE ||
    "supabase/storage-api@sha256:f1546fac6d1c7e345428ac904bfaa7be7cecd50a1f549fe1cf38c628a7b15c85",
  node:
    process.env.E612_HTTP_NODE_IMAGE ||
    "node@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e",
};
const authPassword = `e612-auth-${randomBytes(18).toString("hex")}`;
const restPassword = `e612-rest-${randomBytes(18).toString("hex")}`;
const storagePassword = `e612-storage-${randomBytes(18).toString("hex")}`;
const jwtSecret = `e612-jwt-${randomBytes(48).toString("base64url")}`;
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((name) =>
    process.env[name] ? [[name, process.env[name]]] : [],
  ),
);
const options = {
  env,
  encoding: "utf8",
  timeout: 120_000,
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
};
const emit = (line) => process.stdout.write(`${line}\n`);
const fail = (code) => {
  throw new Error(code);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (args, input) =>
  execFileSync("docker", ["--context", context, ...args], { ...options, input });
function dockerProcess(args) {
  const child = spawn("docker", ["--context", context, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = [];
  let output = "";
  let buffer = "";
  const notify = (chunk) => {
    output += chunk;
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      lines.push(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
    }
  };
  child.stdout.on("data", (chunk) => notify(String(chunk)));
  child.stderr.on("data", (chunk) => notify(String(chunk)));
  let childFailure;
  let childClosed = false;
  const completion = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      childFailure ??= error;
      reject(error);
    });
    child.once("close", (code, signal) => {
      childClosed = true;
      if (buffer) lines.push(buffer);
      if (code === 0 && !childFailure) {
        resolve({ code, signal, output, lines });
        return;
      }
      const error = childFailure ?? new Error(`E612_HTTP_CHILD_EXIT_${code ?? "signal"}`);
      childFailure ??= error;
      reject(error);
    });
  });
  // Keep `completion` unchanged for callers that await it, while observing a
  // rejection immediately so a child that exits before its marker cannot cause
  // an unhandled-rejection crash before waitFor() or finally() handles it.
  void completion.catch(() => undefined);
  const waitFor = (pattern, timeoutMs = 20_000) => {
    const match = () => lines.find((line) => pattern.test(line));
    const existing = match();
    if (existing) return Promise.resolve(existing);
    if (childFailure) return Promise.reject(childFailure);
    if (childClosed) return Promise.reject(new Error("E612_HTTP_CHILD_MARKER_MISSING"));
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let timer;
      let settled = false;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        child.off("error", onError);
        child.off("close", onClose);
      };
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onError = (error) => finishReject(error);
      const onClose = (code, signal) => {
        const found = match();
        if (found) return finishResolve(found);
        finishReject(
          childFailure ??
            new Error(
              code === 0
                ? "E612_HTTP_CHILD_MARKER_MISSING"
                : `E612_HTTP_CHILD_EXIT_${code ?? signal ?? "signal"}`,
            ),
        );
      };
      child.once("error", onError);
      child.once("close", onClose);
      const poll = () => {
        const found = match();
        if (found) return finishResolve(found);
        if (childFailure) return finishReject(childFailure);
        if (childClosed) return finishReject(new Error("E612_HTTP_CHILD_MARKER_MISSING"));
        if (Date.now() - started >= timeoutMs)
          return finishReject(new Error("E612_HTTP_CHILD_MARKER_TIMEOUT"));
        timer = setTimeout(poll, 25);
      };
      poll();
    });
  };
  const stop = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  return { child, completion, lines, waitFor, stop };
}
function validateDockerContext() {
  let inspected;
  try {
    inspected = JSON.parse(docker(["context", "inspect", context]));
  } catch {
    fail("E612_HTTP_DOCKER_CONTEXT_UNAVAILABLE");
  }
  const host = inspected?.[0]?.Endpoints?.docker?.Host;
  if (typeof host !== "string" || !host.startsWith("unix://"))
    fail("E612_HTTP_DOCKER_CONTEXT_NOT_LOCAL");
  const server = docker(["info", "--format", "{{.ServerVersion}}"]).trim();
  if (!server) fail("E612_HTTP_DOCKER_DAEMON_UNAVAILABLE");
  emit(`E612|HTTP|DOCKER|context=${context}|endpoint=unix|server=${server}`);
}
const imageId = (image) => {
  const id = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) fail("E612_HTTP_IMAGE_NOT_CACHED");
  return id;
};
const imagePlatform = (image) => {
  const platform = docker([
    "image",
    "inspect",
    image,
    "--format",
    "{{.Os}}/{{.Architecture}}",
  ]).trim();
  if (!/^linux\/(amd64|arm64)$/.test(platform)) fail("E612_HTTP_IMAGE_PLATFORM_UNKNOWN");
  return platform;
};
let ids;
let platforms;

function dbExec(input) {
  return docker(
    [
      "exec",
      "-i",
      names.db,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=sqlstate",
    ],
    input,
  );
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({
    iss: "minted-e612-http",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  });
  const data = `${head}.${body}`;
  return `${data}.${createHmac("sha256", jwtSecret).update(data).digest("base64url")}`;
}
const adminToken = jwt({ role: "service_role", aud: "authenticated" });
const anonKey = jwt({ role: "anon", aud: "authenticated" });
const serviceKey = adminToken;
function start(kind, args, image, command = [], hardened = true) {
  const hardening =
    hardened && !["gateway"].includes(kind)
      ? [
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp:rw,mode=1777",
        ]
      : hardened
        ? ["--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
        : [];
  docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    names[kind],
    "--label",
    label,
    "--network",
    network,
    "--network-alias",
    kind,
    ...hardening,
    ...args,
    image,
    ...command,
  ]);
}

async function internalReady(base, path, expectedStatus = 200) {
  const code = `fetch(${JSON.stringify(`${base}${path}`)}, {signal:AbortSignal.timeout(10000)}).then((r)=>process.exitCode=r.status===${expectedStatus}?0:1).catch(()=>process.exitCode=1)`;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      docker(["exec", names.gateway, "node", "-e", code]);
      return;
    } catch {
      if (attempt === 119)
        fail(`E612_HTTP_INTERNAL_SERVICE_NOT_READY_${base.replaceAll(/[^A-Za-z0-9]+/g, "_")}`);
    }
    await pause(250);
  }
}

function runInternalDriver() {
  docker([
    "cp",
    `${root}scripts/security/e612-http-driver.mjs`,
    `${names.gateway}:/tmp/e612-http-driver.mjs`,
  ]);
  docker([
    "cp",
    `${root}scripts/security/e613-http-probes.mjs`,
    `${names.gateway}:/tmp/e613-http-probes.mjs`,
  ]);
  try {
    const expiredToken = jwt({
      sub: E612.clientActive,
      email: "active@e612.test",
      role: "authenticated",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const output = docker([
      "exec",
      "-i",
      "-e",
      `E612_ADMIN_TOKEN=${adminToken}`,
      "-e",
      `E612_ANON_KEY=${anonKey}`,
      "-e",
      "E612_BUCKET_ID=payer-forms",
      "-e",
      `E612_EXPIRED_TOKEN=${expiredToken}`,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
    ]);
    process.stdout.write(output);
    if (!output.includes("E612|HTTP|PASS")) fail("E612_HTTP_DRIVER_PASS_MARKER_MISSING");
    if (!output.includes("E613|HTTP|PASS")) fail("E613_HTTP_PROBE_PASS_MARKER_MISSING");
  } catch (error) {
    if (error.stdout) process.stdout.write(String(error.stdout));
    fail("E612_HTTP_DRIVER_FAILED");
  }
}

async function runInternalAuthorityReadRace() {
  const driverEnv = [
    "-e",
    `E612_ADMIN_TOKEN=${adminToken}`,
    "-e",
    `E612_ANON_KEY=${anonKey}`,
    "-e",
    "E612_BUCKET_ID=payer-forms",
  ];
  const lockSql = `
\\set ON_ERROR_STOP on
BEGIN;
LOCK TABLE public.portals IN ACCESS EXCLUSIVE MODE;
SELECT 'E612|RACE|LOCK_READY|pid=' || pg_backend_pid();
`;
  let lock;
  let read;
  let released = false;
  try {
    read = dockerProcess([
      "exec",
      "-i",
      ...driverEnv,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
      "--race-read",
    ]);
    await read.waitFor(/^E612\|RACE\|POSITIVE_COMPLETE$/);

    lock = dockerProcess([
      "exec",
      "-i",
      names.db,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    lock.child.stdin.write(lockSql);
    const readyLine = await lock.waitFor(/^E612\|RACE\|LOCK_READY\|pid=\d+$/);
    const holder = Number(readyLine.split("pid=")[1]);
    if (!Number.isInteger(holder) || holder <= 0) fail("E612_HTTP_RACE_HOLDER_INVALID");

    read.child.stdin.write("START\n");
    await read.waitFor(/^E612\|RACE\|GET_STARTED$/);

    let barrier = "";
    for (let attempt = 0; attempt < 120; attempt++) {
      barrier = dbExec(
        `SELECT pid || '|' || pg_blocking_pids(pid)::text
           FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND ${holder} = ANY(pg_blocking_pids(pid))
            AND query ILIKE '%portals%';`,
      ).trim();
      if (barrier) break;
      if (attempt === 119) fail("E612_HTTP_RACE_READ_NOT_BLOCKED");
      await pause(100);
    }
    const [waiter, blockers] = barrier.split("|", 2);
    emit(`E612|HTTP|RACE|BARRIER|holder=${holder}|waiter=${waiter}|blockers=${blockers}`);

    const changed = docker([
      "exec",
      "-i",
      ...driverEnv,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
      "--race-mutate",
    ]);
    process.stdout.write(changed);
    if (!changed.includes("E612|RACE|AUTHORITY_CHANGED"))
      fail("E612_HTTP_RACE_AUTHORITY_MUTATION_MARKER_MISSING");

    lock.child.stdin.write("COMMIT;\n");
    lock.child.stdin.end();
    released = true;
    emit("E612|HTTP|RACE|RELEASED");
    await lock.completion;
    const readResult = await read.completion;
    process.stdout.write(readResult.output);
  } finally {
    if (!released) {
      try {
        if (lock?.child.stdin.writable) {
          lock.child.stdin.write("ROLLBACK;\n");
          lock.child.stdin.end();
        }
      } catch {
        /* container cleanup below still owns the session */
      }
    }
    if (read) {
      try {
        if (!released) read.stop();
        await read.completion;
      } catch {
        read.stop();
      }
    }
    if (lock) {
      try {
        if (!released && lock.child.stdin.writable) {
          lock.child.stdin.write("ROLLBACK;\n");
          lock.child.stdin.end();
        }
        await lock.completion;
      } catch {
        lock.stop();
      }
    }
  }
}

function runAuthBootstrap() {
  docker([
    "cp",
    `${root}scripts/security/e612-http-driver.mjs`,
    `${names.gateway}:/tmp/e612-http-driver.mjs`,
  ]);
  try {
    const output = docker([
      "exec",
      "-i",
      "-e",
      `E612_ADMIN_TOKEN=${adminToken}`,
      "-e",
      `E612_ANON_KEY=${anonKey}`,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
      "--bootstrap",
    ]);
    process.stdout.write(output);
    if (!output.includes("E612|HTTP|PASS|auth.admin_create_all"))
      fail("E612_HTTP_AUTH_BOOTSTRAP_MARKER_MISSING");
  } catch (error) {
    if (error.stdout) process.stdout.write(String(error.stdout));
    fail("E612_HTTP_AUTH_BOOTSTRAP_FAILED");
  }
}

function sqlBootstrap() {
  const statements = [
    `
ALTER ROLE supabase_auth_admin PASSWORD ${sqlLiteral(authPassword)};
ALTER ROLE authenticator PASSWORD ${sqlLiteral(restPassword)};
ALTER ROLE supabase_storage_admin PASSWORD ${sqlLiteral(storagePassword)};
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
`,
    `
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
`,
  ];
  for (const [index, statement] of statements.entries()) {
    emit(`E612|HTTP|BOOTSTRAP|${index + 1}`);
    try {
      dbExec(statement);
    } catch (error) {
      const diagnostic = String(error?.stderr ?? error?.message ?? "");
      const sqlState =
        diagnostic.match(/(?:SQL state: |\[)([0-9A-Z]{5})(?:\]|\b)/)?.[1] ?? "unknown";
      emit(`E612|HTTP|BOOTSTRAP_FAILED|step=${index + 1}|sqlstate=${sqlState}`);
      throw new Error(`E612_HTTP_SQL_BOOTSTRAP_FAILED_${index + 1}`);
    }
  }
}

function applyMigrations() {
  const files = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (!files.some((name) => name === "20260925035408_e612_client_access_context.sql"))
    fail("E612_HTTP_MIGRATION_MISSING");
  for (const name of files) {
    try {
      dbExec(readFileSync(`${root}supabase/migrations/${name}`, "utf8"));
    } catch {
      fail(`E612_HTTP_MIGRATION_FAILED_${name}`);
    }
  }
  emit(`E612|HTTP|MIGRATIONS|${files.length}`);
}

function seedFixtures() {
  try {
    dbExec(baseFixtureSql());
  } catch {
    fail("E612_HTTP_SEED_FAILED_base");
  }
  try {
    dbExec(restrictedFixtureSql());
  } catch {
    fail("E612_HTTP_SEED_FAILED_restricted");
  }
  try {
    dbExec(`
INSERT INTO public.payers (id, org_id, payer_slug, name)
VALUES ('60000000-0000-4000-8000-000000000001', NULL, 'e612-global-payer', 'E612 Global Payer'),
       ('60000000-0000-4000-8000-000000000002', '${E612.orgA}', 'e612-private-payer', 'E612 Private Payer')
ON CONFLICT DO NOTHING;
INSERT INTO public.payer_catalog_changes
  (id, payer_id, field, old_value, new_value, source, review_state)
VALUES
  ('90000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001',
   'name', 'E612 Global Payer (old)', 'E612 Global Payer', 'manual', 'unreviewed')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.portals
  (id, org_id, portal_key, name, payer_id, form_url)
VALUES
  ('${E612.orgPortal}', '${E612.orgA}', 'e612-org-portal', 'E612 Org Portal',
   '60000000-0000-4000-8000-000000000001', 'https://org.e612.test/form')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.facilities
  (id, org_id, group_id, name, city, state, zip, is_active)
VALUES
  ('70000000-0000-4000-8000-000000000002', '${E612.orgA}', '${E612.groupA1}',
   'E613 Synthetic Facility', 'Topeka', 'KS', '66603', TRUE)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.provider_group_assignments
  (org_id, provider_id, group_id, is_primary, start_date)
VALUES ('${E612.orgA}', '${E612.provider}', '${E612.groupA1}', TRUE, DATE '2026-01-01')
ON CONFLICT (provider_id, group_id) DO NOTHING;
INSERT INTO public.provider_facility_assignments
  (org_id, provider_id, facility_id, is_primary, start_date)
VALUES ('${E612.orgA}', '${E612.provider}', '70000000-0000-4000-8000-000000000002', FALSE, DATE '2026-01-01')
ON CONFLICT (provider_id, facility_id) DO NOTHING;
INSERT INTO public.inbound_leads
  (id, org_name, contact_name, contact_email, contact_phone, city, state, postal_code, country, status)
VALUES
  ('61000000-0000-4000-8000-000000000001', 'E612 Lead Org', 'E612 Contact', 'e612-lead@e612.test', '303-555-0161', 'Denver', 'CO', '80202', 'US', 'new')
ON CONFLICT (id) DO NOTHING;
`);
  } catch {
    fail("E612_HTTP_SEED_FAILED_post");
  }
}

const created = new Set();
let networkCreated = false;
let stage = "docker_context";
try {
  validateDockerContext();
  stage = "pinned_images";
  ids = Object.fromEntries(Object.entries(images).map(([kind, image]) => [kind, imageId(image)]));
  platforms = Object.fromEntries(
    Object.entries(images).map(([kind, image]) => [kind, imagePlatform(image)]),
  );
  emit(
    `E612|HTTP|IMAGES|db=${ids.db}|auth=${ids.auth}|rest=${ids.rest}|storage=${ids.storage}|node=${ids.node}`,
  );
  emit(
    `E612|HTTP|PLATFORM|db=${platforms.db}|auth=${platforms.auth}|rest=${platforms.rest}|storage=${platforms.storage}|node=${platforms.node}`,
  );
  stage = "build_manifest";
  const manifestPath = `${root}.output/server/.e612-build-manifest.json`;
  if (!existsSync(manifestPath)) fail("E612_HTTP_BUILD_MANIFEST_MISSING");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const currentManifest = buildManifest();
  if (
    manifest.sourceSha256 !== currentManifest.sourceSha256 ||
    manifest.bundleSha256 !== currentManifest.bundleSha256 ||
    !Array.isArray(manifest.sourceFiles) ||
    !Array.isArray(manifest.bundleFiles) ||
    manifest.format !== 2
  )
    fail("E612_HTTP_BUILD_MANIFEST_MISMATCH");
  emit(
    `E612|HTTP|BUILD|git=${manifest.gitHead}|source=${manifest.sourceSha256}|bundle=${manifest.bundleSha256}`,
  );
  docker(["network", "create", "--internal", "--label", label, network]);
  networkCreated = true;
  stage = "isolated_database";
  start(
    "db",
    [
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_USER=supabase_admin",
      "--env",
      "POSTGRES_DB=postgres",
      "--health-cmd",
      "pg_isready -U supabase_admin -d postgres",
    ],
    ids.db,
    [],
    false,
  );
  created.add("db");
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      docker(["exec", names.db, "pg_isready", "-q", "-U", "supabase_admin", "-d", "postgres"]);
      break;
    } catch {
      if (attempt === 79) fail("E612_HTTP_DB_NOT_READY");
      await pause(250);
    }
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const roles = dbExec(
        "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_auth_admin','supabase_storage_admin','authenticator','anon','authenticated','service_role');",
      );
      if (roles.trim() === "6") break;
    } catch {
      /* Supabase's post-bootstrap role migration is still running. */
    }
    if (attempt === 119) fail("E612_HTTP_DB_ROLES_NOT_READY");
    await pause(500);
  }
  let stablePostmaster = "";
  let stableReads = 0;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const current = dbExec("SELECT pg_postmaster_start_time()::text;").trim();
      stableReads = current === stablePostmaster ? stableReads + 1 : 1;
      stablePostmaster = current;
      if (stableReads >= 4) break;
    } catch {
      stablePostmaster = "";
      stableReads = 0;
    }
    if (attempt === 119) fail("E612_HTTP_DB_RESTART_NOT_STABLE");
    await pause(500);
  }
  stage = "sql_bootstrap";
  sqlBootstrap();

  stage = "supabase_http_services";
  start("gateway", [], ids.node, [
    "node",
    "-e",
    "const http=require('http');const routes=[['/auth/v1/','http://auth:9999'],['/rest/v1/','http://rest:3000'],['/storage/v1/','http://storage:5000']];http.createServer(async(req,res)=>{const r=routes.find(([p])=>req.url.startsWith(p));if(!r){res.statusCode=404;return res.end('not found')}const u=r[1]+req.url.slice(r[0].length-1);const body=['GET','HEAD'].includes(req.method)?undefined:await new Promise(x=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>x(b))});const out=await fetch(u,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>k!=='host')),body});res.statusCode=out.status;out.headers.forEach((v,k)=>res.setHeader(k,v));res.end(Buffer.from(await out.arrayBuffer()))}).listen(8787,'0.0.0.0')",
  ]);
  created.add("gateway");
  start(
    "storage",
    [
      "--env",
      `DATABASE_URL=postgres://supabase_storage_admin:${storagePassword}@db:5432/postgres`,
      "--env",
      `ANON_KEY=${anonKey}`,
      "--env",
      `SERVICE_KEY=${serviceKey}`,
      "--env",
      `PGRST_JWT_SECRET=${jwtSecret}`,
      "--env",
      "STORAGE_BACKEND=file",
      "--env",
      "FILE_STORAGE_BACKEND_PATH=/var/lib/storage",
      "--env",
      "SERVER_PORT=5000",
      "--env",
      "TENANT_ID=e612",
      "--env",
      "REGION=local",
      "--env",
      "GLOBAL_S3_BUCKET=e612-local",
      "--tmpfs",
      "/var/lib/storage:rw,mode=1777",
    ],
    ids.storage,
  );
  created.add("storage");
  await internalReady("http://storage:5000", "/status");

  start(
    "auth",
    [
      "--env",
      "GOTRUE_DB_DRIVER=postgres",
      "--env",
      `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${authPassword}@db:5432/postgres`,
      "--env",
      "GOTRUE_DB_AUTOMIGRATE=true",
      "--env",
      "GOTRUE_LOG_LEVEL=info",
      "--env",
      "GOTRUE_API_HOST=0.0.0.0",
      "--env",
      "GOTRUE_API_PORT=9999",
      "--env",
      "API_EXTERNAL_URL=http://auth:9999",
      "--env",
      "GOTRUE_SITE_URL=http://fixture.invalid",
      "--env",
      `GOTRUE_JWT_SECRET=${jwtSecret}`,
      "--env",
      "GOTRUE_JWT_ADMIN_ROLES=service_role",
      "--env",
      "GOTRUE_JWT_EXP=3600",
      "--env",
      "GOTRUE_JWT_AUD=authenticated",
      "--env",
      "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
      "--env",
      "GOTRUE_DISABLE_SIGNUP=true",
      "--env",
      "GOTRUE_DB_NAMESPACE=auth",
    ],
    ids.auth,
  );
  created.add("auth");
  await internalReady("http://auth:9999", "/health");
  runAuthBootstrap();
  applyMigrations();
  seedFixtures();

  start(
    "rest",
    [
      "--env",
      `PGRST_DB_URI=postgres://authenticator:${restPassword}@db:5432/postgres`,
      "--env",
      `PGRST_JWT_SECRET=${jwtSecret}`,
      "--env",
      "PGRST_SERVER_PORT=3000",
      "--env",
      "PGRST_DB_SCHEMAS=public",
      "--env",
      "PGRST_DB_ANON_ROLE=anon",
      "--env",
      "PGRST_DB_EXTRA_SEARCH_PATH=public,extensions",
      "--env",
      "PGRST_DB_CONFIG=false",
    ],
    ids.rest,
    ["postgrest"],
  );
  created.add("rest");
  await internalReady("http://rest:3000", "/");
  const appEnv = [
    "--env",
    "NITRO_HOST=0.0.0.0",
    "--env",
    "NITRO_PORT=3000",
    "--env",
    "SUPABASE_URL=http://gateway:8787",
    "--env",
    `VITE_SUPABASE_URL=http://gateway:8787`,
    "--env",
    `SUPABASE_ANON_KEY=${anonKey}`,
    "--env",
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    "--env",
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
  ];
  const output = `${root}.output/server`;
  if (!existsSync(`${output}/index.mjs`)) fail("E612_HTTP_APP_BUILD_REQUIRED");
  docker([
    "create",
    "--name",
    names.app,
    "--label",
    label,
    "--network",
    network,
    "--network-alias",
    "app",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...appEnv,
    ids.node,
    "node",
    "/tmp/server/index.mjs",
  ]);
  created.add("app");
  docker(["cp", output, `${names.app}:/tmp`]);
  docker(["start", names.app]);
  await internalReady("http://app:3000", "/api/health");
  stage = "e612_e613_http_driver";
  runInternalDriver();
  stage = "authority_read_race";
  await runInternalAuthorityReadRace();
} catch (error) {
  const code =
    error instanceof Error && /^E612_[A-Z0-9_-]+$/.test(error.message)
      ? error.message
      : "E612_HTTP_VERIFICATION_FAILED";
  process.stderr.write(`${code}\n`);
  if (code === "E612_HTTP_VERIFICATION_FAILED") {
    process.stderr.write(`E612|HTTP|STAGE_FAILED|${stage}\n`);
  }
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  for (const kind of ["app", "gateway", "storage", "rest", "auth", "db"]) {
    if (!created.has(kind)) continue;
    try {
      const observed = JSON.parse(docker(["container", "inspect", names[kind]]))[0];
      if (observed.Config?.Labels?.[`com.minted.e612`] !== runId)
        fail("E612_HTTP_CLEANUP_LABEL_MISMATCH");
      docker(["rm", "--force", names[kind]]);
    } catch {
      cleanupFailed = true;
      process.exitCode = 1;
    }
  }
  if (networkCreated) {
    try {
      const observed = JSON.parse(docker(["network", "inspect", network]))[0];
      if (observed.Labels?.[`com.minted.e612`] !== runId) fail("E612_HTTP_NETWORK_LABEL_MISMATCH");
      docker(["network", "rm", network]);
    } catch {
      cleanupFailed = true;
      process.exitCode = 1;
    }
  }
  if (cleanupFailed) emit("E612|HTTP|CLEANUP|FAIL");
  else emit("E612|HTTP|CLEANUP|PASS");
}

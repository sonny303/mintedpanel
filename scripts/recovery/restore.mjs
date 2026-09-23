import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { canonicalDigest } from "../release/contract.mjs";
import { PROFILE, POSTGRES_IMAGE, RecoveryError, STAGING } from "./contract.mjs";
import { verifySealed } from "./encrypted-stream.mjs";
import { collectLocalTarget, LOCAL_SOCKET } from "./local-target.mjs";

const executeFile = promisify(execFile);
const DOCKER = "/opt/homebrew/bin/docker";
const AGE = "/opt/homebrew/bin/age";
const CONTEXT = `colima-${PROFILE}`;
const OWNER = "com.minted.recovery.owner";
const RUN = "com.minted.recovery.run-id";
const DATABASE = "minted_recovery";
const PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const MAX_JSON = 256 * 1024 * 1024;
const VERIFIED_BACKUP = Symbol("verified-backup");
// The current verifier proves bounded public/application and role/catalog
// facets, but not every category promised by the complete recovery scopes.
// Emit no qualified scope until the follow-on qualifier reconciles all of it.
const QUALIFIED_RECOVERY_SCOPES = Object.freeze([]);
const QUALIFIER_PREREQUISITES = Object.freeze([
  "RELEASE_CONTEXT_BINDING",
  "REPOSITORY_MIGRATION_INVENTORY_RECONCILIATION",
  "AUTH_REST_INSTALLED_VERIFICATION",
  "COMPLETE_RECOVERY_SCOPE_VERIFICATION",
]);
const fail = () => new RecoveryError("RECOVERY_RESTORE_REJECTED");
const check = (condition) => {
  if (!condition) throw fail();
};
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const identifier = (value) => {
  check(typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value));
  return `"${value}"`;
};
const qualified = (schema, table) => `${identifier(schema)}.${identifier(table)}`;
const dockerArgs = (...args) => ["--host", LOCAL_SOCKET, ...args];

async function docker(args, input, timeout = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      DOCKER,
      args,
      {
        encoding: "utf8",
        timeout,
        maxBuffer: MAX_JSON,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: "/Users/ar",
          DOCKER_CONFIG: "/Users/ar/.docker",
          LANG: "C",
        },
      },
      (error, stdout) => {
        if (error) reject(fail());
        else resolvePromise(stdout);
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function context(execute) {
  const values = JSON.parse(await execute(["context", "inspect", CONTEXT]));
  check(
    Array.isArray(values) &&
      values.length === 1 &&
      values[0]?.Name === CONTEXT &&
      values[0]?.Endpoints?.docker?.Host === LOCAL_SOCKET,
  );
}

const ownership = (labels, runId) => labels && labels[OWNER] === PROFILE && labels[RUN] === runId;

function jsonOne(value) {
  const parsed = JSON.parse(value);
  check(Array.isArray(parsed) && parsed.length === 1);
  return parsed[0];
}

function listed(value) {
  const rows = value
    .trim()
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean);
  check(rows.length <= 1 && rows.every((row) => /^[a-f0-9]{12,64}$/.test(row)));
  return rows[0] ?? null;
}

// Discover every owned resource independently. Exact-name listing distinguishes
// absence from an inspect failure; labels are checked before any removal.
export async function discoverOwnedRecoveryResources(runId, { execute = docker } = {}) {
  try {
    check(/^[a-f0-9]{16}$/.test(runId));
    await context(execute);
    const name = `${PROFILE}-${runId}`;
    const containerId = listed(
      await execute(
        dockerArgs(
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--filter",
          `name=^/${name}$`,
          "--format",
          "{{.ID}}",
        ),
      ),
    );
    const networkId = listed(
      await execute(
        dockerArgs(
          "network",
          "ls",
          "--no-trunc",
          "--filter",
          `name=^${name}$`,
          "--format",
          "{{.ID}}",
        ),
      ),
    );
    const volumeName = (
      await execute(
        dockerArgs("volume", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}"),
      )
    ).trim();
    check(volumeName === "" || volumeName === name);
    const resources = { container: null, network: null, volume: null };
    if (containerId) {
      const item = jsonOne(await execute(dockerArgs("container", "inspect", containerId)));
      check(
        item.Id === containerId &&
          item.Name === `/${name}` &&
          ownership(item.Config?.Labels, runId),
      );
      resources.container = { ref: containerId };
    }
    if (networkId) {
      const item = jsonOne(await execute(dockerArgs("network", "inspect", networkId)));
      check(item.Id === networkId && item.Name === name && ownership(item.Labels, runId));
      resources.network = { ref: networkId };
    }
    if (volumeName) {
      const item = jsonOne(await execute(dockerArgs("volume", "inspect", volumeName)));
      check(item.Name === name && ownership(item.Labels, runId));
      resources.volume = { ref: volumeName };
    }
    return resources;
  } catch {
    throw fail();
  }
}

export async function prepareIsolatedTarget(
  runId,
  {
    execute = docker,
    inspect = collectLocalTarget,
    password = randomBytes(32).toString("base64url"),
    cleanup = destroyIsolatedTarget,
  } = {},
) {
  let mutationStarted = false;
  try {
    check(/^[a-f0-9]{16}$/.test(runId));
    check(typeof password === "string" && password.length >= 32 && !/[\0\r\n]/.test(password));
    await context(execute);
    const name = `${PROFILE}-${runId}`;
    const labels = ["--label", `${OWNER}=${PROFILE}`, "--label", `${RUN}=${runId}`];
    try {
      await execute(dockerArgs("image", "inspect", POSTGRES_IMAGE));
    } catch {
      await execute(dockerArgs("image", "pull", POSTGRES_IMAGE), undefined, 10 * 60 * 1000);
    }
    // Cleanup is eligible before the first named-resource mutation attempt.
    // A transport error does not prove Docker rejected the create.
    mutationStarted = true;
    await execute(
      dockerArgs("network", "create", "--internal", "--driver", "bridge", ...labels, name),
    );
    await execute(dockerArgs("volume", "create", "--driver", "local", ...labels, name));
    await execute(
      dockerArgs(
        "container",
        "run",
        "--detach",
        "--name",
        name,
        "--network",
        name,
        ...labels,
        "--security-opt",
        "no-new-privileges:true",
        "--mount",
        `type=volume,source=${name},target=/var/lib/postgresql/data`,
        "--env",
        `POSTGRES_PASSWORD=${password}`,
        "--env",
        "POSTGRES_DB=postgres",
        "--env",
        "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8",
        POSTGRES_IMAGE,
        "postgres",
        "-c",
        "cron.launch_active_jobs=off",
      ),
    );
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        await execute(
          dockerArgs(
            "exec",
            name,
            "/nix/var/nix/profiles/default/bin/pg_isready",
            "-h",
            "/var/run/postgresql",
            "-p",
            "5432",
            "-U",
            "supabase_admin",
            "-d",
            "postgres",
          ),
        );
        ready = true;
        break;
      } catch {
        await sleep(1000);
      }
    }
    check(ready);
    return await inspect(runId);
  } catch {
    if (mutationStarted) {
      try {
        await cleanup(runId);
      } catch {
        // The outer coordinator journals the run ID and performs an idempotent
        // second cleanup attempt with a sanitized receipt.
      }
    }
    throw fail();
  }
}

function psqlArgs(containerId, database, readOnly = true, username = "postgres") {
  return dockerArgs(
    "exec",
    "--interactive",
    "--user",
    "postgres",
    containerId,
    "/usr/bin/env",
    "-i",
    `PATH=${PATH}`,
    `PGOPTIONS=-c default_transaction_read_only=${readOnly ? "on" : "off"} -c statement_timeout=120000 -c lock_timeout=5000`,
    "/nix/var/nix/profiles/default/bin/psql",
    "-X",
    "-w",
    "--quiet",
    "-A",
    "-t",
    "-h",
    "/var/run/postgresql",
    "-p",
    "5432",
    "-U",
    username,
    "-d",
    database,
    "--set",
    "ON_ERROR_STOP=1",
  );
}

async function query(
  target,
  sql,
  database = DATABASE,
  readOnly = true,
  execute = docker,
  username = "postgres",
) {
  return execute(psqlArgs(target.containerId, database, readOnly, username), `${sql}\n`, 180_000);
}

async function privateFile(path, maximumBytes = MAX_JSON) {
  check(typeof path === "string" && isAbsolute(path) && (await realpath(path)) === path);
  let current = path;
  while (current !== parse(current).root) {
    const currentStat = await lstat(current);
    check(!currentStat.isSymbolicLink());
    let git;
    try {
      git = await lstat(join(current, ".git"));
    } catch (error) {
      check(error?.code === "ENOENT" || error?.code === "ENOTDIR");
    }
    check(!git);
    current = dirname(current);
  }
  const stat = await lstat(path);
  check(
    stat.isFile() &&
      stat.uid === process.getuid() &&
      stat.nlink === 1 &&
      (stat.mode & 0o077) === 0 &&
      stat.size > 0 &&
      stat.size <= maximumBytes,
  );
}

async function decryptJson(workspace, name, identityPath, execute = executeFile) {
  await privateFile(join(workspace, `${name}.age`), 1024 * 1024 * 1024);
  await privateFile(identityPath, 2048);
  try {
    const { stdout } = await execute(
      AGE,
      ["--decrypt", "--identity", identityPath, join(workspace, `${name}.age`)],
      {
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: MAX_JSON,
        env: { PATH: "/usr/bin:/bin", LANG: "C" },
      },
    );
    const value = JSON.parse(stdout);
    check(value !== null && typeof value === "object");
    return value;
  } catch {
    throw fail();
  }
}

export function filterRestoreTableOfContents(text, schemas) {
  check(typeof text === "string" && text.length <= 8 * 1024 * 1024 && Array.isArray(schemas));
  const counts = new Map(schemas.map((schema) => [schema.name, 0]));
  const result = text.split("\n").map((line) => {
    const match = line.match(/^\d+; \d+ \d+ SCHEMA - (\S+) (\S+)$/);
    if (!match || !counts.has(match[1])) return line;
    const expected = schemas.find((schema) => schema.name === match[1]);
    check(match[2] === expected.owner);
    counts.set(match[1], counts.get(match[1]) + 1);
    return `; source-owned schema precreated: ${line}`;
  });
  check([...counts.values()].every((count) => count === 1));
  return result.join("\n");
}

async function archiveTableOfContents(target, workspace, identityPath, launch) {
  const age = launch(
    AGE,
    ["--decrypt", "--identity", identityPath, join(workspace, "backup.age")],
    { stdio: ["ignore", "pipe", "ignore"], env: { PATH: "/usr/bin:/bin", LANG: "C" } },
  );
  const listing = launch(
    DOCKER,
    dockerArgs(
      "exec",
      "--interactive",
      "--user",
      "postgres",
      target.containerId,
      "/nix/var/nix/profiles/default/bin/pg_restore",
      "--list",
    ),
    {
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/ar",
        DOCKER_CONFIG: "/Users/ar/.docker",
        LANG: "C",
      },
    },
  );
  let text = "",
    overflow = false;
  listing.stdout.on("data", (chunk) => {
    if (text.length + chunk.length > 8 * 1024 * 1024) {
      overflow = true;
      listing.kill("SIGKILL");
      age.kill("SIGKILL");
    } else text += chunk.toString("utf8");
  });
  const closed = (child) =>
    new Promise((resolve) => {
      child.once("error", () => resolve(-1));
      child.once("close", (code) => resolve(code));
    });
  const listDone = closed(listing),
    ageDone = closed(age);
  const transfer = pipeline(age.stdout, listing.stdin).catch((error) => {
    if (error.code !== "EPIPE") throw error;
  });
  transfer.catch(() => {});
  const timer = setTimeout(() => {
    age.kill("SIGKILL");
    listing.kill("SIGKILL");
  }, 60000);
  try {
    check((await listDone) === 0 && !overflow);
    // --list can stop reading once the archive header is complete. Integrity
    // authentication of the full ciphertext already preceded this operation.
    age.kill("SIGKILL");
    await Promise.allSettled([ageDone, transfer]);
    return text;
  } finally {
    clearTimeout(timer);
    age.kill("SIGKILL");
    listing.kill("SIGKILL");
    await Promise.allSettled([ageDone, listDone, transfer]);
  }
}

export async function streamArchive(target, workspace, identityPath, options = {}, launch = spawn) {
  const tocPath = "/tmp/minted-recovery-restore.list";
  const useList = Array.isArray(options.precreatedSchemas) && options.precreatedSchemas.length > 0;
  if (useList) {
    const list = filterRestoreTableOfContents(
      await archiveTableOfContents(target, workspace, identityPath, launch),
      options.precreatedSchemas,
    );
    await docker(
      dockerArgs(
        "exec",
        "--interactive",
        "--user",
        "postgres",
        target.containerId,
        "/bin/sh",
        "-c",
        "umask 077; set -C; cat > /tmp/minted-recovery-restore.list",
      ),
      list,
    );
  }
  const age = launch(
    AGE,
    ["--decrypt", "--identity", identityPath, join(workspace, "backup.age")],
    { stdio: ["ignore", "pipe", "ignore"], env: { PATH: "/usr/bin:/bin", LANG: "C" } },
  );
  const restore = launch(
    DOCKER,
    dockerArgs(
      "exec",
      "--interactive",
      "--user",
      "postgres",
      target.containerId,
      "/usr/bin/env",
      "-i",
      `PATH=${PATH}`,
      "/nix/var/nix/profiles/default/bin/pg_restore",
      "--exit-on-error",
      "--single-transaction",
      "--no-password",
      "--host=/var/run/postgresql",
      "--port=5432",
      // The local Supabase image's postgres role cannot SET ROLE to every
      // managed schema owner. Restore as the isolated image's administrator
      // so archive ownership/ACLs remain intact; verification still uses postgres.
      "--username=supabase_admin",
      "--role=postgres",
      ...(useList ? [`--use-list=${tocPath}`] : []),
      `--dbname=${DATABASE}`,
    ),
    {
      stdio: ["pipe", "ignore", "ignore"],
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/ar",
        DOCKER_CONFIG: "/Users/ar/.docker",
        LANG: "C",
      },
    },
  );
  restore.stdin.on("error", () => {});
  age.stdout.on("error", () => {});
  const transfer = pipeline(age.stdout, restore.stdin);
  transfer.catch(() => {});
  const completion = (child) =>
    new Promise((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        code === 0 && !signal ? resolvePromise() : reject(fail()),
      );
    });
  const timeout = setTimeout(
    () => {
      age.kill("SIGKILL");
      restore.kill("SIGKILL");
    },
    15 * 60 * 1000,
  );
  try {
    await Promise.all([completion(age), completion(restore), transfer]);
  } catch {
    age.kill("SIGKILL");
    restore.kill("SIGKILL");
    throw fail();
  } finally {
    clearTimeout(timeout);
    if (useList)
      await docker(
        dockerArgs("exec", "--user", "postgres", target.containerId, "/bin/rm", "--", tocPath),
      );
  }
}

export async function inspectSealedBackup(
  { workspace, identityPath } = {},
  { verify = verifySealed, decrypt = decryptJson, clock = () => new Date().toISOString() } = {},
) {
  try {
    check(isAbsolute(workspace) && isAbsolute(identityPath));
    const capturePath = join(workspace, "capture.json");
    await privateFile(capturePath, 4 * 1024 * 1024);
    const capture = JSON.parse(await readFile(capturePath, "utf8"));
    check(
      capture?.version === 1 &&
        capture.status === "CAPTURED_ONLY" &&
        hash(capture.providerDigest) &&
        capture.captured?.version === 1 &&
        capture.captured.status === "CAPTURED_ONLY",
    );
    const lifecycle = capture.loginRoleLifecycle;
    const maintenance = lifecycle?.cleanupMode === "exclusive-staging-maintenance";
    const lifecycleKeys =
      "cleanupReceivedAt,cleanupRequestedAt,exactRoleAbsent,loginReceivedAt,loginRequestedAt,poststateInventoryDigest,poststateRoleCount,prestateInventoryDigest,prestateReceivedAt,prestateRequestedAt,roleDigest,verifiedAt".split(
        ",",
      );
    if (maintenance) lifecycleKeys.push("cleanupMode");
    check(
      lifecycle &&
        Object.keys(lifecycle).sort().join(",") === lifecycleKeys.sort().join(",") &&
        (!maintenance ||
          (lifecycle.poststateRoleCount === 0 &&
            lifecycle.poststateInventoryDigest === canonicalDigest([]))) &&
        [
          lifecycle.prestateRequestedAt,
          lifecycle.prestateReceivedAt,
          lifecycle.loginRequestedAt,
          lifecycle.loginReceivedAt,
          lifecycle.cleanupRequestedAt,
          lifecycle.cleanupReceivedAt,
          lifecycle.verifiedAt,
        ].every(timestamp) &&
        Date.parse(lifecycle.prestateReceivedAt) >= Date.parse(lifecycle.prestateRequestedAt) &&
        Date.parse(lifecycle.loginRequestedAt) >= Date.parse(lifecycle.prestateReceivedAt) &&
        Date.parse(lifecycle.loginReceivedAt) >= Date.parse(lifecycle.loginRequestedAt) &&
        Date.parse(lifecycle.cleanupRequestedAt) >= Date.parse(lifecycle.loginReceivedAt) &&
        Date.parse(lifecycle.cleanupReceivedAt) >= Date.parse(lifecycle.cleanupRequestedAt) &&
        Date.parse(lifecycle.verifiedAt) >= Date.parse(lifecycle.cleanupReceivedAt) &&
        lifecycle.prestateInventoryDigest === canonicalDigest([]) &&
        hash(lifecycle.poststateInventoryDigest) &&
        Number.isSafeInteger(lifecycle.poststateRoleCount) &&
        lifecycle.poststateRoleCount >= 0 &&
        lifecycle.poststateRoleCount <= 32 &&
        lifecycle.exactRoleAbsent === true &&
        hash(lifecycle.roleDigest),
    );
    const source = capture.captured.source;
    check(
      source?.ref === STAGING.ref &&
        source.host === STAGING.host &&
        source.port === STAGING.port &&
        source.database === STAGING.database &&
        source.serverVersion === STAGING.serverVersion &&
        hash(source.schemaDigest) &&
        hash(source.lineageDigest) &&
        timestamp(capture.captured.capturedAt) &&
        Date.parse(lifecycle.cleanupRequestedAt) >= Date.parse(capture.captured.capturedAt),
    );
    check(
      capture.captured.snapshot?.method === "single-data-snapshot-catalog-bracketed" &&
        capture.captured.snapshot.sourceEvidence === "OWNED_SNAPSHOT_COLLECTOR" &&
        capture.captured.snapshot.declaredSchemaMatch === "NOT_CLAIMED" &&
        capture.captured.snapshot.lineageMeaning === "OBSERVED_DATABASE_LEDGERS_ONLY",
    );
    const prerequisites = capture.captured.remainingPrerequisites;
    check(
      Array.isArray(prerequisites) &&
        prerequisites.length > 0 &&
        prerequisites.length === new Set(prerequisites).size &&
        prerequisites.every(
          (item) => typeof item === "string" && /^[A-Z][A-Z0-9_]{2,99}$/.test(item),
        ) &&
        prerequisites.includes("REPOSITORY_MIGRATION_INVENTORY"),
    );
    const expectedNames = ["backup", "roles", "schema", "integrity", "migration-lineage"];
    check(
      Array.isArray(capture.captured.artifacts) &&
        capture.captured.artifacts.length === expectedNames.length &&
        capture.captured.artifacts.every(
          (artifact) =>
            artifact &&
            expectedNames.includes(artifact.name) &&
            hash(artifact.sha256) &&
            Number.isSafeInteger(artifact.bytes) &&
            artifact.bytes > 0,
        ) &&
        new Set(capture.captured.artifacts.map(({ name }) => name)).size === expectedNames.length,
    );
    const sealed = [];
    for (const name of expectedNames) {
      const actual = await verify({ workspace, name, identityPath, ageBinary: AGE });
      const expected = capture.captured.artifacts.find((artifact) => artifact.name === name);
      check(
        actual?.name === name &&
          actual.sha256 === expected.sha256 &&
          actual.bytes === expected.bytes,
      );
      sealed.push(actual);
    }
    const [schema, integrity, lineage] = await Promise.all([
      decrypt(workspace, "schema", identityPath),
      decrypt(workspace, "integrity", identityPath),
      decrypt(workspace, "migration-lineage", identityPath),
    ]);
    check(
      canonicalDigest(schema.before) === source.schemaDigest &&
        canonicalDigest(schema.before) === canonicalDigest(schema.after) &&
        integrity.catalogDigest === canonicalDigest(schema.before) &&
        canonicalDigest(lineage) === source.lineageDigest,
    );
    const verifiedAt = clock();
    check(timestamp(verifiedAt));
    const captureDigest = canonicalDigest(capture);
    const artifactDigest = canonicalDigest(sealed);
    const result = {
      status: "SEALED_VERIFIED",
      workspaceDigest: canonicalDigest(resolve(workspace)),
      captureDigest,
      artifactDigest,
      verifiedAt,
      observedBackup: {
        provider: "supabase",
        supabaseRef: STAGING.ref,
        schemaDigest: source.schemaDigest,
        lineageDigest: source.lineageDigest,
        createdAt: capture.captured.capturedAt,
        verifiedAt,
        available: true,
        artifactDigest,
      },
      remainingPrerequisites: [...new Set([...prerequisites, ...QUALIFIER_PREREQUISITES])],
      capture,
      sealed,
      schema,
      integrity,
      lineage,
      [VERIFIED_BACKUP]: true,
    };
    return Object.freeze(result);
  } catch {
    throw fail();
  }
}

const ROLE_FIELDS = Object.freeze({
  rolsuper: "SUPERUSER",
  rolinherit: "INHERIT",
  rolcreaterole: "CREATEROLE",
  rolcreatedb: "CREATEDB",
  rolcanlogin: "LOGIN",
  rolreplication: "REPLICATION",
  rolbypassrls: "BYPASSRLS",
});
const roleIdentifier = (value) => {
  check(
    typeof value === "string" &&
      value.length > 0 &&
      Buffer.byteLength(value) <= 63 &&
      !value.includes("\0"),
  );
  return `"${value.replaceAll('"', '""')}"`;
};
const sqlLiteral = (value) => {
  check(typeof value === "string" && !value.includes("\0"));
  return `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
};
const roleAttributes = (role) => {
  const options = Object.entries(ROLE_FIELDS).map(([key, option]) => {
    check(typeof role[key] === "boolean");
    return `${role[key] ? "" : "NO"}${option}`;
  });
  check(Number.isSafeInteger(role.rolconnlimit) && role.rolconnlimit >= -1);
  check(role.rolvaliduntil === null || typeof role.rolvaliduntil === "string");
  return `${options.join(" ")} CONNECTION LIMIT ${role.rolconnlimit}${role.rolvaliduntil === null ? "" : ` VALID UNTIL ${sqlLiteral(role.rolvaliduntil)}`}`;
};
const roleConfig = (role, setting, database = null) => {
  check(typeof setting === "string" && setting.includes("="));
  const split = setting.indexOf("=");
  const key = setting.slice(0, split);
  check(/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key));
  const scope =
    role === null
      ? `ALTER DATABASE ${identifier(DATABASE)}`
      : `ALTER ROLE ${roleIdentifier(role)}${database ? ` IN DATABASE ${identifier(DATABASE)}` : ""}`;
  // SET ... TO a single SQL literal changes list-valued GUC semantics (for
  // example search_path). Use the raw GUC parser, store FROM CURRENT, then
  // restore the operator session value without emitting configuration contents.
  const ddl = `${scope} SET ${roleIdentifier(key)} FROM CURRENT`;
  let delimiter = "$minted_config$";
  while (setting.includes(delimiter) || ddl.includes(delimiter))
    delimiter = delimiter.slice(0, -1) + "_$";
  return `DO ${delimiter} DECLARE prior text := pg_catalog.current_setting(${sqlLiteral(key)}, true); BEGIN PERFORM pg_catalog.set_config(${sqlLiteral(key)}, ${sqlLiteral(setting.slice(split + 1))}, true); EXECUTE ${sqlLiteral(ddl)}; IF prior IS NULL THEN EXECUTE ${sqlLiteral(`RESET ${roleIdentifier(key)}`)}; ELSE PERFORM pg_catalog.set_config(${sqlLiteral(key)}, prior, true); END IF; END ${delimiter};`;
};

// Pure planner for the already authenticated encrypted catalog. SQL is sent only
// to the owned isolated container, never persisted or logged. No passwords appear.
export function planLocalRoles(source, local) {
  check(
    Array.isArray(source?.roles) &&
      Array.isArray(local?.roles) &&
      Array.isArray(source.memberships) &&
      Array.isArray(local.memberships) &&
      Array.isArray(source.roleDatabaseSettings),
  );
  const retained = (roles) => roles.filter((role) => !/^cli_login_/.test(role.rolname));
  const wanted = retained(source.roles),
    existing = retained(local.roles);
  const wantedByName = new Map(wanted.map((role) => [role.rolname, role]));
  const localByName = new Map(existing.map((role) => [role.rolname, role]));
  check(wantedByName.size === wanted.length && localByName.size === existing.length);
  check(
    wantedByName.get("supabase_admin")?.rolsuper === true &&
      localByName.get("supabase_admin")?.rolsuper === true,
  );
  check(existing.every((role) => wantedByName.has(role.rolname)));
  const statements = ["BEGIN;"];
  for (const role of wanted) {
    const name = roleIdentifier(role.rolname);
    const attributes = roleAttributes(role);
    const old = localByName.get(role.rolname);
    check(!old || role.rolvaliduntil !== null || old.rolvaliduntil === null);
    check(role.rolconfig === null || Array.isArray(role.rolconfig));
    if (role.rolname.startsWith("pg_")) {
      check(
        old &&
          roleAttributes(old) === attributes &&
          canonicalDigest(old.rolconfig) === canonicalDigest(role.rolconfig),
      );
      continue;
    }
    if (!old) statements.push(`CREATE ROLE ${name} WITH ${attributes};`);
    else if (roleAttributes(old) !== attributes)
      statements.push(`ALTER ROLE ${name} WITH ${attributes};`);
    if (!old || canonicalDigest(old.rolconfig) !== canonicalDigest(role.rolconfig)) {
      statements.push(`ALTER ROLE ${name} RESET ALL;`);
      for (const setting of role.rolconfig ?? [])
        statements.push(roleConfig(role.rolname, setting));
    }
  }
  const memberships = (catalog) => {
    const names = new Map(catalog.roles.map((role) => [String(role.oid), role.rolname]));
    return catalog.memberships
      .map((row) => {
        const named = {
          role: names.get(String(row.roleid)),
          member: names.get(String(row.member)),
          grantor: names.get(String(row.grantor)),
          admin: row.admin_option,
          inherit: row.inherit_option,
          set: row.set_option,
        };
        check(
          named.role &&
            named.member &&
            named.grantor &&
            [named.admin, named.inherit, named.set].every((value) => typeof value === "boolean"),
        );
        return named;
      })
      .filter(
        (row) => ![row.role, row.member, row.grantor].some((name) => /^cli_login_/.test(name)),
      );
  };
  const desiredMemberships = memberships(source),
    currentMemberships = memberships(local);
  const identity = (row) => JSON.stringify([row.role, row.member, row.grantor]);
  check(
    currentMemberships.every((row) =>
      desiredMemberships.some((want) => identity(row) === identity(want)),
    ),
  );
  const ready = currentMemberships.filter((row) =>
    desiredMemberships.some((want) => canonicalDigest(row) === canonicalDigest(want)),
  );
  const pending = desiredMemberships.filter(
    (row) => !ready.some((done) => canonicalDigest(row) === canonicalDigest(done)),
  );
  while (pending.length) {
    const index = pending.findIndex(
      (row) =>
        wantedByName.get(row.grantor)?.rolsuper ||
        ready.some(
          (grant) => grant.role === row.role && grant.member === row.grantor && grant.admin,
        ),
    );
    check(index >= 0);
    const [row] = pending.splice(index, 1);
    statements.push(
      `GRANT ${roleIdentifier(row.role)} TO ${roleIdentifier(row.member)} WITH ADMIN ${row.admin}, INHERIT ${row.inherit}, SET ${row.set} GRANTED BY ${roleIdentifier(row.grantor)};`,
    );
    ready.push(row);
  }
  statements.push("COMMIT;");
  const databaseStatements = ["BEGIN;"];
  const names = new Map(source.roles.map((role) => [String(role.oid), role.rolname]));
  for (const setting of source.roleDatabaseSettings) {
    check(
      /^(0|[1-9][0-9]{0,9})$/.test(String(setting.setdatabase)) &&
        /^(0|[1-9][0-9]{0,9})$/.test(String(setting.setrole)) &&
        Array.isArray(setting.setconfig),
    );
    if (String(setting.setdatabase) === "0") continue; // rolconfig above is the global per-role setting.
    const role = String(setting.setrole) === "0" ? null : names.get(String(setting.setrole));
    check(role !== undefined);
    if (role?.startsWith("cli_login_")) continue;
    check(!role?.startsWith("pg_"));
    for (const config of setting.setconfig)
      databaseStatements.push(roleConfig(role, config, DATABASE));
  }
  databaseStatements.push("COMMIT;");
  return { rolesSql: statements.join("\n"), databaseSettingsSql: databaseStatements.join("\n") };
}

async function prepareArchiveExtensions(target, catalog, execute) {
  check(Array.isArray(catalog.extensions) && Array.isArray(catalog.schemas));
  const desired = catalog.extensions.map((extension) => {
    check(typeof extension.version === "string" && /^[A-Za-z0-9_.-]+$/.test(extension.version));
    roleIdentifier(extension.name);
    roleIdentifier(extension.owner);
    roleIdentifier(extension.schema);
    return extension;
  });
  const current = JSON.parse(
    await query(
      target,
      "SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'owner',pg_catalog.pg_get_userbyid(e.extowner),'schema',n.nspname)),'[]') FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace;",
      DATABASE,
      true,
      execute,
      "supabase_admin",
    ),
  );
  check(
    Array.isArray(current) &&
      current.every((row) =>
        desired.some((extension) =>
          ["name", "version", "owner", "schema"].every((key) => extension[key] === row[key]),
        ),
      ),
  );
  const available = JSON.parse(
    await query(
      target,
      "SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'version',version)),'[]') FROM pg_catalog.pg_available_extension_versions;",
      DATABASE,
      true,
      execute,
      "supabase_admin",
    ),
  );
  check(
    desired.every((extension) =>
      available.some((row) => row.name === extension.name && row.version === extension.version),
    ),
  );
  const precreate = desired.filter(
    (extension) =>
      extension.owner !== "postgres" && !current.some((row) => row.name === extension.name),
  );
  // The reviewed staging archive has one exceptional extension owner/schema.
  // Reject a future topology change instead of silently expanding TOC omissions.
  check(
    precreate.every(
      (extension) =>
        extension.name === "supabase_vault" &&
        extension.schema === "vault" &&
        extension.owner === "supabase_admin",
    ),
  );
  const schemas = precreate.map((extension) => {
    const schema = catalog.schemas.find((row) => row.name === extension.schema);
    check(schema?.owner === extension.owner);
    return { name: schema.name, owner: schema.owner };
  });
  for (const extension of precreate)
    await query(
      target,
      `BEGIN; CREATE SCHEMA ${roleIdentifier(extension.schema)} AUTHORIZATION ${roleIdentifier(extension.owner)}; SET LOCAL ROLE ${roleIdentifier(extension.owner)}; CREATE EXTENSION ${roleIdentifier(extension.name)} WITH SCHEMA ${roleIdentifier(extension.schema)} VERSION ${sqlLiteral(extension.version)}; COMMIT;`,
      DATABASE,
      false,
      execute,
      "supabase_admin",
    );
  return schemas;
}

// PostgreSQL requires an event trigger's new owner to be a superuser. Hosted
// Supabase can retain managed event triggers owned by its non-superuser postgres
// role. Reproduce that ownership only inside the owned isolated restore target,
// then remove every temporary elevation before any verification can succeed.
export async function restoreArchiveWithEventOwners(
  { target, workspace, identityPath, catalog },
  {
    execute = docker,
    restoreStream = streamArchive,
    prepareExtensions = prepareArchiveExtensions,
  } = {},
) {
  check(Array.isArray(catalog?.roles) && Array.isArray(catalog.eventTriggers));
  const roles = new Map(catalog.roles.map((role) => [String(role.oid), role]));
  const expected = catalog.eventTriggers
    .map((trigger) => {
      const owner = roles.get(String(trigger.evtowner));
      check(owner && !owner.rolname.startsWith("cli_login_") && !owner.rolname.startsWith("pg_"));
      roleIdentifier(owner.rolname);
      roleIdentifier(trigger.evtname);
      check(typeof owner.rolsuper === "boolean");
      return { name: trigger.evtname, owner: owner.rolname };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const elevated = [
    ...new Set(
      expected
        .filter((event) => !catalog.roles.find((role) => role.rolname === event.owner).rolsuper)
        .map((event) => event.owner),
    ),
  ];
  try {
    if (elevated.length)
      await query(
        target,
        "BEGIN;\n" +
          elevated.map((name) => `ALTER ROLE ${roleIdentifier(name)} SUPERUSER;`).join("\n") +
          "\nCOMMIT;",
        "postgres",
        false,
        execute,
        "supabase_admin",
      );
    const precreatedSchemas = await prepareExtensions(target, catalog, execute);
    await restoreStream(target, workspace, identityPath, { precreatedSchemas });
    if (precreatedSchemas.length) {
      const actualSchemas = JSON.parse(
        await query(
          target,
          `SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_catalog.pg_get_userbyid(nspowner),'acl',nspacl)) FROM pg_catalog.pg_namespace WHERE nspname IN (${precreatedSchemas.map((schema) => sqlLiteral(schema.name)).join(",")});`,
          DATABASE,
          true,
          execute,
          "supabase_admin",
        ),
      );
      const expectedSchemas = catalog.schemas
        .filter((schema) => precreatedSchemas.some((item) => item.name === schema.name))
        .map((schema) => ({
          name: schema.name,
          owner: schema.owner,
          acl: normalizeAcl(schema.acl),
        }));
      check(Array.isArray(actualSchemas));
      actualSchemas.forEach((schema) => (schema.acl = normalizeAcl(schema.acl)));
      actualSchemas.sort((a, b) => a.name.localeCompare(b.name));
      expectedSchemas.sort((a, b) => a.name.localeCompare(b.name));
      check(canonicalDigest(actualSchemas) === canonicalDigest(expectedSchemas));
    }
  } finally {
    if (elevated.length)
      await query(
        target,
        "BEGIN;\n" +
          elevated.map((name) => `ALTER ROLE ${roleIdentifier(name)} NOSUPERUSER;`).join("\n") +
          "\nCOMMIT;",
        "postgres",
        false,
        execute,
        "supabase_admin",
      );
  }
  const actual = JSON.parse(
    await query(
      target,
      "SELECT coalesce(jsonb_agg(jsonb_build_object('name',evtname,'owner',pg_catalog.pg_get_userbyid(evtowner)) ORDER BY evtname),'[]') FROM pg_catalog.pg_event_trigger;",
      DATABASE,
      true,
      execute,
      "supabase_admin",
    ),
  );
  check(Array.isArray(actual));
  actual.sort((a, b) => a.name.localeCompare(b.name));
  check(canonicalDigest(actual) === canonicalDigest(expected));
  if (elevated.length) {
    const restoredRoles = JSON.parse(
      await query(
        target,
        `SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper) ORDER BY rolname),'[]') FROM pg_catalog.pg_roles WHERE rolname IN (${elevated.map(sqlLiteral).join(",")});`,
        "postgres",
        true,
        execute,
        "supabase_admin",
      ),
    );
    check(
      Array.isArray(restoredRoles) &&
        restoredRoles.length === elevated.length &&
        restoredRoles.every((role) => elevated.includes(role.name) && role.superuser === false),
    );
  }
}

export async function restoreEncryptedBackup(
  { target, workspace, identityPath, verifiedBackup } = {},
  { execute = docker, restoreStream = streamArchive } = {},
) {
  try {
    check(
      target?.containerId &&
        isAbsolute(workspace) &&
        isAbsolute(identityPath) &&
        verifiedBackup?.[VERIFIED_BACKUP] === true &&
        verifiedBackup.status === "SEALED_VERIFIED" &&
        verifiedBackup.workspaceDigest === canonicalDigest(resolve(workspace)),
    );
    const localRoles = JSON.parse(
      await query(
        target,
        "SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword') FROM pg_catalog.pg_roles r),'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM pg_catalog.pg_auth_members m));",
        "postgres",
        true,
        execute,
        "supabase_admin",
      ),
    );
    const rolePlan = planLocalRoles(verifiedBackup.schema.before, localRoles);
    await query(target, rolePlan.rolesSql, "postgres", false, execute, "supabase_admin");
    await query(
      target,
      `CREATE DATABASE ${identifier(DATABASE)} OWNER postgres TEMPLATE template0;`,
      "postgres",
      false,
      execute,
      "supabase_admin",
    );
    await query(target, rolePlan.databaseSettingsSql, DATABASE, false, execute, "supabase_admin");
    await restoreArchiveWithEventOwners(
      { target, workspace, identityPath, catalog: verifiedBackup.schema.before },
      { execute, restoreStream },
    );
    const restored = JSON.parse(
      await query(
        target,
        "SELECT json_build_object('database',current_database(),'serverVersion',current_setting('server_version'),'readOnly',current_setting('default_transaction_read_only'));",
        DATABASE,
        true,
        execute,
      ),
    );
    check(
      restored.database === DATABASE &&
        restored.serverVersion === STAGING.serverVersion &&
        restored.readOnly === "on",
    );
    return { database: DATABASE, serverVersion: restored.serverVersion };
  } catch {
    throw fail();
  }
}

function normalizeAcl(value) {
  return value === null ? null : [...value].sort();
}

export function sourceAccess(catalog) {
  const roleNames = new Map(catalog.roles.map((role) => [String(role.oid), role.rolname]));
  return {
    relations: catalog.relations
      .filter((item) => item.schema === "public")
      .map((item) => ({
        schema: item.schema,
        name: item.name,
        kind: item.kind,
        owner: item.owner,
        acl: normalizeAcl(item.acl),
        rls: item.rls,
        forceRls: item.forceRls,
      }))
      .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`)),
    columns: catalog.columns
      .filter((item) => item.schema === "public")
      .map((item) => ({
        schema: item.schema,
        table: item.table,
        position: item.position,
        name: item.name,
        acl: normalizeAcl(item.acl),
      }))
      .sort((a, b) =>
        `${a.schema}.${a.table}.${String(a.position).padStart(5, "0")}`.localeCompare(
          `${b.schema}.${b.table}.${String(b.position).padStart(5, "0")}`,
        ),
      ),
    policies: catalog.policies
      .filter((item) => item.schema === "public")
      .map((item) => ({
        schema: item.schema,
        table: item.table,
        name: item.name,
        command: item.command,
        permissive: item.permissive,
        roles: item.roles
          .map((oid) => {
            if (String(oid) === "0") return "public";
            const name = roleNames.get(String(oid));
            check(typeof name === "string");
            return name;
          })
          .sort(),
        using: item.using,
        check: item.check,
      }))
      .sort((a, b) =>
        `${a.schema}.${a.table}.${a.name}`.localeCompare(`${b.schema}.${b.table}.${b.name}`),
      ),
  };
}

function sourceRoles(catalog) {
  const roles = catalog.roles
    .filter((role) => !/^cli_login_/.test(role.rolname))
    .map((role) => {
      const normalized = { ...role };
      delete normalized.oid;
      delete normalized.rolpassword;
      return normalized;
    })
    .sort((a, b) => a.rolname.localeCompare(b.rolname));
  const names = new Map(catalog.roles.map((role) => [String(role.oid), role.rolname]));
  const memberships = catalog.memberships
    .map((membership) => ({
      role: names.get(String(membership.roleid)),
      member: names.get(String(membership.member)),
      grantor: names.get(String(membership.grantor)),
      adminOption: membership.admin_option,
      inheritOption: membership.inherit_option,
      setOption: membership.set_option,
    }))
    .filter(
      (membership) =>
        membership.role &&
        membership.member &&
        membership.grantor &&
        ![membership.role, membership.member, membership.grantor].some((name) =>
          /^cli_login_/.test(name),
        ),
    )
    .sort((a, b) =>
      `${a.role}.${a.member}.${a.grantor}`.localeCompare(`${b.role}.${b.member}.${b.grantor}`),
    );
  return { roles, memberships };
}

const ACCESS_SQL = `SET search_path=pg_catalog;
SELECT jsonb_build_object(
 'relations',(SELECT coalesce(jsonb_agg(v ORDER BY v->>'schema',v->>'name'),'[]') FROM (
   SELECT jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
     'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) v
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') q),
 'columns',(SELECT coalesce(jsonb_agg(v ORDER BY v->>'schema',v->>'table',(v->>'position')::int),'[]') FROM (
   SELECT jsonb_build_object('schema',n.nspname,'table',c.relname,'position',a.attnum,'name',a.attname,'acl',a.attacl) v
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped) q),
 'policies',(SELECT coalesce(jsonb_agg(v ORDER BY v->>'schema',v->>'table',v->>'name'),'[]') FROM (
   SELECT jsonb_build_object('schema',n.nspname,'table',c.relname,'name',p.polname,'command',p.polcmd,
     'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'public' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'public' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r),
     'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) v
   FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') q)
);`;

const ROLES_SQL = `SELECT jsonb_build_object(
 'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'oid'-'rolpassword' ORDER BY rolname),'[]')
   FROM pg_catalog.pg_roles r WHERE rolname !~ '^cli_login_'),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'role',role.rolname,'member',member.rolname,'grantor',grantor.rolname,
   'adminOption',m.admin_option,'inheritOption',m.inherit_option,'setOption',m.set_option)
   ORDER BY role.rolname,member.rolname,grantor.rolname),'[]')
   FROM pg_catalog.pg_auth_members m
   JOIN pg_catalog.pg_roles role ON role.oid=m.roleid
   JOIN pg_catalog.pg_roles member ON member.oid=m.member
   JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor
   WHERE role.rolname !~ '^cli_login_' AND member.rolname !~ '^cli_login_' AND grantor.rolname !~ '^cli_login_')
);`;

function sourceStructure(catalog) {
  const normalize = (values, filter, map, key) =>
    values
      .filter(filter)
      .map(map)
      .sort((a, b) => key(a).localeCompare(key(b)));
  return {
    constraints: normalize(
      catalog.constraints,
      (item) => item.schema === "public",
      (item) => ({ ...item }),
      (item) => `${item.schema}.${item.relation}.${item.name}`,
    ),
    indexes: normalize(
      catalog.indexes,
      (item) => item.schema === "public",
      (item) => ({ ...item }),
      (item) => `${item.schema}.${item.name}`,
    ),
    functions: catalog.functions
      .filter((item) => {
        const identity = item.identity.replace(/^"?/, "");
        return identity.startsWith("public.") || !identity.includes(".");
      })
      .map((item) => ({ ...item, acl: normalizeAcl(item.acl) }))
      .sort((a, b) => a.identity.localeCompare(b.identity)),
    triggers: normalize(
      catalog.triggers,
      (item) => item.schema === "public",
      (item) => ({ ...item }),
      (item) => `${item.schema}.${item.table}.${item.name}`,
    ),
    extensions: catalog.extensions
      .map((item) => ({
        name: item.name,
        version: item.version,
        owner: item.owner,
        schema: item.schema,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const STRUCTURE_SQL = `SET search_path=pg_catalog;
SELECT jsonb_build_object(
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.conname,
   'relation',c.conrelid::regclass::text,'definition',pg_get_constraintdef(c.oid,true),
   'validated',c.convalidated,'type',c.contype) ORDER BY n.nspname,c.conrelid::regclass::text,c.conname),'[]')
   FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
   'definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY n.nspname,c.relname),'[]')
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid WHERE n.nspname='public'),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text),'[]')
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind<>'a'),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
   'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid,true))
   ORDER BY n.nspname,c.relname,t.tgname),'[]') FROM pg_catalog.pg_trigger t
   JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,
   'owner',pg_get_userbyid(e.extowner),'schema',n.nspname) ORDER BY e.extname),'[]')
   FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace)
);`;

async function dataProof(target, integrity, execute) {
  let rows = 0;
  for (const table of integrity.tables) {
    const relation = qualified(table.schema, table.name);
    const sql = `SELECT json_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(h,E'\\n' ORDER BY h),'') || CASE WHEN count(*)>0 THEN E'\\n' ELSE '' END,'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM ONLY ${relation} t) q;`;
    const actual = JSON.parse(await query(target, sql, DATABASE, true, execute));
    check(actual.rows === table.rows && actual.sha256 === table.sha256);
    rows += actual.rows;
  }
  let sequenceDrift = 0;
  for (const sequence of integrity.sequences) {
    const actual = JSON.parse(
      await query(
        target,
        `SELECT json_build_object('lastValue',last_value::text,'isCalled',is_called) FROM ${qualified(sequence.schema, sequence.name)};`,
        DATABASE,
        true,
        execute,
      ),
    );
    check(/^\-?[0-9]+$/.test(actual.lastValue) && typeof actual.isCalled === "boolean");
    check(BigInt(actual.lastValue) >= BigInt(sequence.lastValue));
    if (actual.lastValue !== sequence.lastValue || actual.isCalled !== sequence.isCalled)
      sequenceDrift++;
  }
  return {
    physicalTableCount: integrity.tables.length,
    rowCount: rows,
    sequenceCount: integrity.sequences.length,
    nonMvccSequenceDriftCount: sequenceDrift,
    digest: canonicalDigest({ tables: integrity.tables, sequences: integrity.sequences }),
  };
}

export function normalizeRestoredAccess(access) {
  const normalized = structuredClone(access);
  normalized.relations.forEach((item) => (item.acl = normalizeAcl(item.acl)));
  normalized.columns.forEach((item) => (item.acl = normalizeAcl(item.acl)));
  normalized.policies.forEach((item) => (item.roles = [...item.roles].sort()));
  normalized.relations.sort((a, b) =>
    `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
  );
  normalized.columns.sort((a, b) =>
    `${a.schema}.${a.table}.${String(a.position).padStart(5, "0")}`.localeCompare(
      `${b.schema}.${b.table}.${String(b.position).padStart(5, "0")}`,
    ),
  );
  normalized.policies.sort((a, b) =>
    `${a.schema}.${a.table}.${a.name}`.localeCompare(`${b.schema}.${b.table}.${b.name}`),
  );
  return normalized;
}

export function normalizeCatalogProof(kind, value) {
  const keys = {
    roles: {
      roles: (row) => row.rolname,
      memberships: (row) => `${row.role}.${row.member}.${row.grantor}`,
    },
    structure: {
      constraints: (row) => `${row.schema}.${row.relation}.${row.name}`,
      indexes: (row) => `${row.schema}.${row.name}`,
      functions: (row) => row.identity,
      triggers: (row) => `${row.schema}.${row.table}.${row.name}.${row.definition}`,
      extensions: (row) => row.name,
    },
  }[kind];
  check(
    keys && value && Object.keys(value).sort().join(",") === Object.keys(keys).sort().join(","),
  );
  const result = structuredClone(value);
  if (kind === "structure") {
    for (const trigger of result.triggers) {
      if (!trigger.internal || !/^RI_ConstraintTrigger_[ac]_[0-9]+$/.test(trigger.name)) continue;
      const prefix = `CREATE CONSTRAINT TRIGGER "${trigger.name}" `;
      check(typeof trigger.definition === "string" && trigger.definition.startsWith(prefix));
      trigger.name = trigger.name.replace(/_[0-9]+$/, "_OID");
      trigger.definition =
        `CREATE CONSTRAINT TRIGGER "${trigger.name}" ` + trigger.definition.slice(prefix.length);
    }
  }
  for (const [category, identity] of Object.entries(keys)) {
    check(
      Array.isArray(result[category]) &&
        result[category].every(
          (row) =>
            row &&
            typeof row === "object" &&
            !Array.isArray(row) &&
            typeof identity(row) === "string",
        ),
    );
    result[category].sort((a, b) => identity(a).localeCompare(identity(b)));
  }
  if (kind === "structure") result.functions.forEach((row) => (row.acl = normalizeAcl(row.acl)));
  return result;
}

export async function verifyRestoredBackup(
  { target, verifiedBackup } = {},
  { execute = docker, clock = () => new Date().toISOString() } = {},
) {
  try {
    check(
      target?.containerId &&
        verifiedBackup?.[VERIFIED_BACKUP] === true &&
        verifiedBackup.status === "SEALED_VERIFIED",
    );
    const { sealed, schema, integrity, lineage } = verifiedBackup;
    const actualAccess = normalizeRestoredAccess(
      JSON.parse(await query(target, ACCESS_SQL, DATABASE, true, execute)),
    );
    check(canonicalDigest(actualAccess) === canonicalDigest(sourceAccess(schema.before)));
    const actualRoles = JSON.parse(await query(target, ROLES_SQL, DATABASE, true, execute));
    check(
      canonicalDigest(normalizeCatalogProof("roles", actualRoles)) ===
        canonicalDigest(normalizeCatalogProof("roles", sourceRoles(schema.before))),
    );
    const actualStructure = JSON.parse(await query(target, STRUCTURE_SQL, DATABASE, true, execute));
    check(
      canonicalDigest(normalizeCatalogProof("structure", actualStructure)) ===
        canonicalDigest(normalizeCatalogProof("structure", sourceStructure(schema.before))),
    );
    const data = await dataProof(target, integrity, execute);
    const outbound = JSON.parse(
      await query(
        target,
        "SELECT json_build_object('subscriptions',(SELECT count(*) FROM pg_subscription),'foreignServers',(SELECT count(*) FROM pg_foreign_server),'foreignTables',(SELECT count(*) FROM pg_foreign_table),'largeObjects',(SELECT count(*) FROM pg_largeobject_metadata));",
        DATABASE,
        true,
        execute,
      ),
    );
    check(
      outbound.subscriptions === schema.before.outbound.subscriptions &&
        outbound.foreignServers === schema.before.outbound.foreignServers &&
        outbound.foreignTables === schema.before.outbound.foreignTables &&
        outbound.largeObjects === schema.before.largeObjects,
    );
    const verifiedAt = clock();
    check(timestamp(verifiedAt));
    return {
      version: 1,
      status: "RESTORE_VERIFIED_ONLY",
      releaseAdmission: "BLOCKED",
      ref: STAGING.ref,
      verifiedAt,
      contextDigest: null,
      captureDigest: verifiedBackup.captureDigest,
      observedBackup: verifiedBackup.observedBackup,
      targetDigest: canonicalDigest(target),
      sealedArtifacts: sealed,
      qualifiedRecoveryScopes: [...QUALIFIED_RECOVERY_SCOPES],
      remainingPrerequisites: [...verifiedBackup.remainingPrerequisites],
      data,
      accessDigest: canonicalDigest(actualAccess),
      rolesDigest: canonicalDigest(actualRoles),
      structureDigest: canonicalDigest(actualStructure),
      lineageDigest: canonicalDigest(lineage),
      outbound,
    };
  } catch {
    throw fail();
  }
}

export async function rehearseStagingRestore({ workspace, identityPath } = {}, dependencies = {}) {
  let runId;
  let journaled = false;
  try {
    const clock = dependencies.clock ?? (() => new Date().toISOString());
    const monotonic = dependencies.monotonic ?? (() => performance.now());
    const detectedAt = clock();
    const startedAt = clock();
    const began = monotonic();
    check(
      timestamp(detectedAt) &&
        timestamp(startedAt) &&
        Date.parse(startedAt) >= Date.parse(detectedAt) &&
        Number.isFinite(began),
    );
    runId = (dependencies.randomBytes ?? randomBytes)(8).toString("hex");
    check(/^[a-f0-9]{16}$/.test(runId));
    const verifiedBackup = await (dependencies.inspect ?? inspectSealedBackup)({
      workspace,
      identityPath,
    });
    const journal = {
      version: 1,
      status: "CLEANUP_REQUIRED",
      runId,
      resourceName: `${PROFILE}-${runId}`,
      recordedAt: clock(),
    };
    check(timestamp(journal.recordedAt));
    await (dependencies.saveJournal ?? writeFile)(
      join(workspace, `restore-${runId}-journal.json`),
      `${JSON.stringify(journal, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    journaled = true;
    const target = await (dependencies.prepare ?? prepareIsolatedTarget)(runId);
    const restored = await (dependencies.restore ?? restoreEncryptedBackup)({
      target,
      workspace,
      identityPath,
      verifiedBackup,
    });
    const proof = await (dependencies.verify ?? verifyRestoredBackup)({
      target,
      verifiedBackup,
    });
    const finishedAt = clock();
    const finished = monotonic();
    check(
      timestamp(finishedAt) &&
        Date.parse(finishedAt) >= Date.parse(startedAt) &&
        Number.isFinite(finished) &&
        finished >= began,
    );
    const result = {
      version: 1,
      status: "REHEARSED_ONLY",
      releaseAdmission: "BLOCKED",
      runId,
      detectedAt,
      startedAt,
      finishedAt,
      durationMs: Math.round(finished - began),
      contextDigest: null,
      observedBackup: verifiedBackup.observedBackup,
      qualifiedRecoveryScopes: [...QUALIFIED_RECOVERY_SCOPES],
      remainingPrerequisites: [...verifiedBackup.remainingPrerequisites],
      target,
      restored,
      proof,
    };
    await (dependencies.save ?? writeFile)(
      join(workspace, "restore.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return result;
  } catch {
    if (journaled && runId) {
      let receipt;
      try {
        receipt = await (dependencies.cleanup ?? destroyIsolatedTarget)(runId);
      } catch {
        receipt = {
          version: 1,
          runId,
          status: "CLEANUP_BLOCKED",
          attempted: [],
          removed: [],
          remaining: ["unknown"],
          failureKinds: ["inspection"],
          verifiedAt: (dependencies.clock ?? (() => new Date().toISOString()))(),
        };
      }
      try {
        check(
          receipt?.runId === runId &&
            ["DESTROYED", "CLEANUP_BLOCKED"].includes(receipt.status) &&
            timestamp(receipt.verifiedAt),
        );
        await (dependencies.saveCleanup ?? writeFile)(
          join(workspace, `restore-${runId}-cleanup.json`),
          `${JSON.stringify(receipt, null, 2)}\n`,
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
      } catch {
        // The stable run ID remains in the pre-mutation journal for the
        // operator's idempotent destroy command.
      }
    }
    throw fail();
  }
}

export async function destroyIsolatedTarget(
  runId,
  {
    execute = docker,
    discover = discoverOwnedRecoveryResources,
    clock = () => new Date().toISOString(),
  } = {},
) {
  try {
    check(/^[a-f0-9]{16}$/.test(runId));
    const before = await discover(runId, { execute });
    const attempted = [];
    const failureKinds = [];
    for (const [kind, args] of [
      [
        "container",
        before.container ? dockerArgs("container", "rm", "--force", before.container.ref) : null,
      ],
      ["network", before.network ? dockerArgs("network", "rm", before.network.ref) : null],
      ["volume", before.volume ? dockerArgs("volume", "rm", before.volume.ref) : null],
    ]) {
      if (!args) continue;
      attempted.push(kind);
      try {
        await execute(args);
      } catch {
        failureKinds.push(kind);
      }
    }
    const after = await discover(runId, { execute });
    const remaining = ["container", "network", "volume"].filter((kind) => after[kind]);
    const removed = ["container", "network", "volume"].filter(
      (kind) => before[kind] && !after[kind],
    );
    const verifiedAt = clock();
    check(timestamp(verifiedAt));
    return {
      version: 1,
      runId,
      status: remaining.length === 0 ? "DESTROYED" : "CLEANUP_BLOCKED",
      attempted,
      removed,
      remaining,
      failureKinds,
      verifiedAt,
    };
  } catch {
    throw fail();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [operation, firstFlag, first, secondFlag, second, ...extra] = process.argv.slice(2);
    if (
      operation === "restore" &&
      firstFlag === "--workspace" &&
      secondFlag === "--identity" &&
      extra.length === 0
    ) {
      process.stdout.write(
        `${JSON.stringify(await rehearseStagingRestore({ workspace: first, identityPath: second }))}\n`,
      );
    } else if (operation === "destroy" && firstFlag === "--run-id" && secondFlag === undefined) {
      const receipt = await destroyIsolatedTarget(first);
      process.stdout.write(`${JSON.stringify(receipt)}\n`);
      if (receipt.status !== "DESTROYED") process.exitCode = 2;
    } else throw fail();
  } catch {
    process.stdout.write('{"ok":false,"code":"RECOVERY_RESTORE_REJECTED"}\n');
    process.exitCode = 2;
  }
}

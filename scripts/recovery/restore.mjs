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

function psqlArgs(containerId, database, readOnly = true) {
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
    "postgres",
    "-d",
    database,
    "--set",
    "ON_ERROR_STOP=1",
  );
}

async function query(target, sql, database = DATABASE, readOnly = true, execute = docker) {
  return execute(psqlArgs(target.containerId, database, readOnly), `${sql}\n`, 180_000);
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

async function streamArchive(target, workspace, identityPath, launch = spawn) {
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
      "--username=postgres",
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
    check(
      lifecycle &&
        Object.keys(lifecycle).sort().join(",") ===
          "cleanupReceivedAt,cleanupRequestedAt,exactRoleAbsent,loginReceivedAt,loginRequestedAt,poststateInventoryDigest,poststateRoleCount,prestateInventoryDigest,prestateReceivedAt,prestateRequestedAt,roleDigest,verifiedAt" &&
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
    await query(
      target,
      `CREATE DATABASE ${identifier(DATABASE)} OWNER postgres TEMPLATE template0;`,
      "postgres",
      false,
      execute,
    );
    await restoreStream(target, workspace, identityPath);
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

function sourceAccess(catalog) {
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
        roles: item.roles.map((oid) => (oid === 0 ? "public" : roleNames.get(String(oid)))).sort(),
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
    const actualAccess = JSON.parse(await query(target, ACCESS_SQL, DATABASE, true, execute));
    actualAccess.relations.forEach((item) => (item.acl = normalizeAcl(item.acl)));
    actualAccess.columns.forEach((item) => (item.acl = normalizeAcl(item.acl)));
    actualAccess.policies.forEach((item) => (item.roles = [...item.roles].sort()));
    check(canonicalDigest(actualAccess) === canonicalDigest(sourceAccess(schema.before)));
    const actualRoles = JSON.parse(await query(target, ROLES_SQL, DATABASE, true, execute));
    check(canonicalDigest(actualRoles) === canonicalDigest(sourceRoles(schema.before)));
    const actualStructure = JSON.parse(await query(target, STRUCTURE_SQL, DATABASE, true, execute));
    actualStructure.functions.forEach((item) => (item.acl = normalizeAcl(item.acl)));
    check(canonicalDigest(actualStructure) === canonicalDigest(sourceStructure(schema.before)));
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

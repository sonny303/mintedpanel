import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { canonicalDigest } from "../release/contract.mjs";
import { RecoveryError, STAGING } from "./contract.mjs";

const executeFile = promisify(execFile);
const API = "https://api.supabase.com";
const TOKEN = /^sbp_(?:oauth_)?[a-f0-9]{40}$/;
const CLI_ROLE = /^cli_login_[A-Za-z0-9_]{1,80}$/;
const MAX_PROVIDER_TTL_SECONDS = 3_600;
const CLI_ROLE_QUERY =
  "SELECT r.rolname FROM pg_catalog.pg_roles AS r WHERE r.rolname LIKE 'cli\\_login\\_%' ESCAPE '\\' ORDER BY r.rolname";
const fail = () => new RecoveryError("RECOVERY_PROVIDER_REJECTED");
const check = (condition) => {
  if (!condition) throw fail();
};
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

async function privateTokenFile(path, files) {
  check((await files.realpath(path)) === path);
  const stat = await files.lstat(path);
  check(
    stat.isFile() &&
      stat.uid === process.getuid() &&
      stat.nlink === 1 &&
      (stat.mode & 0o077) === 0 &&
      stat.size > 0 &&
      stat.size <= 256,
  );
  return (await files.readFile(path, "utf8")).trim();
}

async function keychainToken(run) {
  const { stdout } = await run(
    "/usr/bin/security",
    ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"],
    {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin", HOME: homedir(), LANG: "C" },
    },
  );
  return decodeKeychainToken(stdout.trim());
}

// Supabase CLI uses go-keyring, which wraps macOS passwords before storage.
// Decode only its canonical encodings, then retain the token format check below.
export function decodeKeychainToken(value) {
  for (const [prefix, encoding, pattern] of [
    [
      "go-keyring-base64:",
      "base64",
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    ],
    ["go-keyring-encoded:", "hex", /^(?:[a-fA-F0-9]{2})+$/],
  ]) {
    if (!value.startsWith(prefix)) continue;
    const encoded = value.slice(prefix.length);
    check(pattern.test(encoded));
    return Buffer.from(encoded, encoding).toString("utf8");
  }
  return value;
}

// Match Supabase CLI's precedence without ever logging or serializing the token.
// The injected seams exist only for tests; the CLI exposes no token argument.
export async function loadSupabaseAccessToken({
  environment = process.env,
  run = executeFile,
  files = { lstat, readFile, realpath },
  home = homedir(),
} = {}) {
  try {
    let token = environment.SUPABASE_ACCESS_TOKEN;
    if (!token && process.platform === "darwin") {
      try {
        token = await keychainToken(run);
      } catch {
        // The official CLI falls through to its protected legacy token file.
      }
    }
    if (!token) token = await privateTokenFile(join(home, ".supabase", "access-token"), files);
    check(TOKEN.test(token));
    return token;
  } catch {
    throw fail();
  }
}

async function request(fetchImpl, token, path, options = {}, ignoreResponseBody = false) {
  const response = await fetchImpl(`${API}${path}`, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  check(response.status >= 200 && response.status < 300);
  if (ignoreResponseBody) return null;
  return response.json();
}

async function jsonRequest(fetchImpl, token, path, options = {}) {
  const body = await request(fetchImpl, token, path, options);
  check(plainObject(body));
  return body;
}

function exactTimestamp(value) {
  check(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );
  return value;
}

// The Management API returns database-specific endpoint records, not the
// two-field configuration object. Select one unambiguous, pinned primary and
// discard connection strings before producing evidence.
function normalizePooler(rows) {
  check(Array.isArray(rows) && rows.length > 0);
  check(rows.every((row) => plainObject(row) && row.identifier === STAGING.ref));
  const primary = rows.filter((row) => row.database_type === "PRIMARY");
  check(primary.length === 1);
  const row = primary[0];
  check(
    row.db_host === STAGING.host &&
      row.db_user === `postgres.${STAGING.ref}` &&
      row.db_name === STAGING.database &&
      row.is_using_scram_auth === true &&
      ((row.pool_mode === "transaction" && row.db_port === 6543) ||
        (row.pool_mode === "session" && row.db_port === 5432)) &&
      (row.default_pool_size === null ||
        (Number.isSafeInteger(row.default_pool_size) && row.default_pool_size > 0)),
  );
  return { default_pool_size: row.default_pool_size, pool_mode: row.pool_mode };
}

function projectObservation(project, pooler, capturedAt) {
  check(
    project.id === STAGING.ref &&
      project.ref === STAGING.ref &&
      project.name === "mintedpanel-staging" &&
      project.region === "ca-central-1" &&
      project.status === "ACTIVE_HEALTHY" &&
      plainObject(project.database) &&
      project.database.host === `db.${STAGING.ref}.supabase.co` &&
      project.database.postgres_engine === "17" &&
      project.database.release_channel === "ga" &&
      project.database.version === "17.6.1.147",
  );
  check(
    Object.keys(pooler).every((key) => ["default_pool_size", "pool_mode"].includes(key)) &&
      (pooler.default_pool_size === null || Number.isSafeInteger(pooler.default_pool_size)) &&
      ["session", "transaction"].includes(pooler.pool_mode),
  );
  const provider = {
    project: {
      id: project.id,
      ref: project.ref,
      name: project.name,
      region: project.region,
      status: project.status,
      database: {
        host: project.database.host,
        version: project.database.version,
        postgresEngine: project.database.postgres_engine,
        releaseChannel: project.database.release_channel,
      },
    },
    pooler: {
      defaultPoolSize: pooler.default_pool_size,
      configuredMode: pooler.pool_mode,
      recoveryEndpoint: {
        host: STAGING.host,
        port: STAGING.port,
        database: STAGING.database,
        mode: "session",
      },
    },
  };
  return {
    capturedAt,
    source: {
      ...STAGING,
      schemaDigest: canonicalDigest(provider),
      lineageDigest: canonicalDigest({
        projectRef: project.ref,
        projectVersion: project.database.version,
        endpointMode: "session",
      }),
    },
    providerDigest: canonicalDigest(provider),
  };
}

export async function observeStagingProvider({
  token,
  fetchImpl = fetch,
  clock = () => new Date().toISOString(),
} = {}) {
  try {
    check(TOKEN.test(token));
    const capturedAt = clock();
    check(new Date(capturedAt).toISOString() === capturedAt);
    const [project, pooler] = await Promise.all([
      jsonRequest(fetchImpl, token, `/v1/projects/${STAGING.ref}`),
      request(fetchImpl, token, `/v1/projects/${STAGING.ref}/config/database/pooler`),
    ]);
    return projectObservation(project, normalizePooler(pooler), capturedAt);
  } catch {
    throw fail();
  }
}

export async function readStagingCliRoleInventory({
  token,
  fetchImpl = fetch,
  clock = () => new Date().toISOString(),
} = {}) {
  try {
    check(TOKEN.test(token));
    const requestedAt = exactTimestamp(clock());
    const rows = await request(
      fetchImpl,
      token,
      `/v1/projects/${STAGING.ref}/database/query/read-only`,
      { method: "POST", body: JSON.stringify({ query: CLI_ROLE_QUERY }) },
    );
    const receivedAt = exactTimestamp(clock());
    check(
      Date.parse(receivedAt) >= Date.parse(requestedAt) &&
        Array.isArray(rows) &&
        rows.length <= 32 &&
        rows.every(
          (row) => plainObject(row) && Object.keys(row).length === 1 && CLI_ROLE.test(row.rolname),
        ),
    );
    const roleNames = rows.map(({ rolname }) => rolname);
    check(roleNames.length === new Set(roleNames).size);
    return {
      requestedAt,
      receivedAt,
      roleCount: roleNames.length,
      roleNames,
      inventoryDigest: canonicalDigest(roleNames),
      queryDigest: canonicalDigest(CLI_ROLE_QUERY),
    };
  } catch {
    throw fail();
  }
}

// One mutating request, with no retry. The password stays in this return value
// and is passed directly to the in-memory exporter by the owned coordinator.
async function createStagingLoginRole({
  token,
  fetchImpl = fetch,
  clock = () => new Date().toISOString(),
} = {}) {
  let requestedAt;
  try {
    check(TOKEN.test(token));
    requestedAt = exactTimestamp(clock());
  } catch {
    throw fail();
  }
  const response = await request(fetchImpl, token, `/v1/projects/${STAGING.ref}/cli/login-role`, {
    method: "POST",
    body: JSON.stringify({ read_only: false }),
  });
  let receivedAt;
  try {
    receivedAt = exactTimestamp(clock());
  } catch {
    receivedAt = null;
  }
  const cleanupRole = plainObject(response) && CLI_ROLE.test(response.role) ? response.role : null;
  const ttlAccepted =
    plainObject(response) &&
    Number.isSafeInteger(response.ttl_seconds) &&
    response.ttl_seconds > 0 &&
    response.ttl_seconds <= MAX_PROVIDER_TTL_SECONDS;
  const responseAccepted =
    receivedAt !== null &&
    Date.parse(receivedAt) >= Date.parse(requestedAt) &&
    plainObject(response) &&
    Object.keys(response).sort().join(",") === "password,role,ttl_seconds" &&
    cleanupRole !== null &&
    typeof response.password === "string" &&
    response.password.length >= 16 &&
    response.password.length <= 1024 &&
    !/[\0\r\n]/.test(response.password) &&
    ttlAccepted;
  Object.freeze(response);
  return Object.freeze({
    requestedAt,
    receivedAt,
    response,
    cleanupRole,
    ttlAccepted,
    responseAccepted,
  });
}

function exactRoleCleanupSql(role) {
  check(CLI_ROLE.test(role));
  return `SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE usename = '${role}' AND pid <> pg_catalog.pg_backend_pid();\nALTER ROLE "${role}" NOLOGIN VALID UNTIL 'epoch';\nDROP ROLE "${role}";`;
}

async function removeAndVerifyStagingLoginRole({
  token,
  role,
  fetchImpl = fetch,
  clock = () => new Date().toISOString(),
} = {}) {
  let cleanupFailed = false;
  let cleanupRequestedAt;
  let cleanupReceivedAt;
  try {
    check(TOKEN.test(token) && CLI_ROLE.test(role));
    cleanupRequestedAt = exactTimestamp(clock());
    const response = await request(fetchImpl, token, `/v1/projects/${STAGING.ref}/database/query`, {
      method: "POST",
      body: JSON.stringify({ query: exactRoleCleanupSql(role) }),
    });
    cleanupReceivedAt = exactTimestamp(clock());
    check(
      Date.parse(cleanupReceivedAt) >= Date.parse(cleanupRequestedAt) &&
        Array.isArray(response) &&
        response.length <= 32,
    );
  } catch {
    cleanupFailed = true;
  }
  let verified;
  try {
    verified = await readStagingCliRoleInventory({ token, fetchImpl, clock });
  } catch {
    throw fail();
  }
  const exactRoleAbsent = !verified.roleNames.includes(role);
  check(!cleanupFailed && exactRoleAbsent);
  return {
    cleanupRequestedAt,
    cleanupReceivedAt,
    verifiedAt: verified.receivedAt,
    roleDigest: canonicalDigest(role),
    poststateInventoryDigest: verified.inventoryDigest,
    poststateRoleCount: verified.roleCount,
    exactRoleAbsent,
  };
}

export const EXCLUSIVE_STAGING_MAINTENANCE = "exclusive-staging-maintenance";

// The provider DELETE is project-wide. This opt-in is valid only while the
// operator holds the explicitly authorized exclusive staging CLI window.
// Inventory checks cannot eliminate a concurrent actor racing that window.
async function removeExclusiveStagingLoginRole({ token, role, fetchImpl, clock }) {
  check(TOKEN.test(token) && CLI_ROLE.test(role));
  const soleOwnedRole = async () => {
    const inventory = await readStagingCliRoleInventory({ token, fetchImpl, clock });
    check(inventory.roleCount === 1 && inventory.roleNames[0] === role);
  };
  const sessions = async () => {
    const rows = await request(
      fetchImpl,
      token,
      `/v1/projects/${STAGING.ref}/database/query/read-only`,
      {
        method: "POST",
        body: JSON.stringify({
          query:
            "SELECT pid, usename FROM pg_catalog.pg_stat_activity WHERE usename LIKE 'cli\\_login\\_%' ESCAPE '\\' ORDER BY pid",
        }),
      },
    );
    check(
      Array.isArray(rows) &&
        rows.every(
          (row) =>
            plainObject(row) &&
            Number.isSafeInteger(row.pid) &&
            row.pid > 0 &&
            row.usename === role,
        ),
    );
    return rows;
  };
  await soleOwnedRole();
  if ((await sessions()).length) {
    // Never terminate another role, even in the exclusive window.
    const rows = await request(fetchImpl, token, `/v1/projects/${STAGING.ref}/database/query`, {
      method: "POST",
      body: JSON.stringify({
        query: `SELECT pg_catalog.pg_terminate_backend(pid) AS terminated FROM pg_catalog.pg_stat_activity WHERE usename = '${role}' AND pid <> pg_catalog.pg_backend_pid()`,
      }),
    });
    check(Array.isArray(rows) && rows.every((row) => row?.terminated === true));
  }
  await soleOwnedRole();
  check((await sessions()).length === 0);
  const cleanupRequestedAt = exactTimestamp(clock());
  let cleanupFailed = false;
  try {
    // Successful DELETE responses may have no JSON even when status is 200.
    // The SQL inventory below, not the response body, proves removal.
    await request(
      fetchImpl,
      token,
      `/v1/projects/${STAGING.ref}/cli/login-role`,
      {
        method: "DELETE",
      },
      true,
    );
  } catch {
    cleanupFailed = true;
  }
  const cleanupReceivedAt = exactTimestamp(clock());
  const verified = await readStagingCliRoleInventory({ token, fetchImpl, clock });
  check(!cleanupFailed && verified.roleCount === 0 && verified.roleNames.length === 0);
  return {
    cleanupRequestedAt,
    cleanupReceivedAt,
    verifiedAt: verified.receivedAt,
    roleDigest: canonicalDigest(role),
    poststateInventoryDigest: verified.inventoryDigest,
    poststateRoleCount: 0,
    exactRoleAbsent: true,
  };
}

// Default cleanup remains exact-role SQL. The explicit maintenance mode is a
// separate operator-authorized path; unknown POST outcomes never invoke DELETE.
export async function withStagingLoginRole(
  { token, operation, cleanupMode = "exact-role" } = {},
  {
    fetchImpl = fetch,
    clock = () => new Date().toISOString(),
    readInventory = readStagingCliRoleInventory,
    create = createStagingLoginRole,
    cleanup,
  } = {},
) {
  try {
    check(
      TOKEN.test(token) &&
        typeof operation === "function" &&
        ["exact-role", EXCLUSIVE_STAGING_MAINTENANCE].includes(cleanupMode),
    );
    const cleanupOwnedRole =
      cleanup ??
      (cleanupMode === EXCLUSIVE_STAGING_MAINTENANCE
        ? removeExclusiveStagingLoginRole
        : removeAndVerifyStagingLoginRole);
    const prestate = await readInventory({ token, fetchImpl, clock });
    check(
      prestate?.roleCount === 0 &&
        Array.isArray(prestate.roleNames) &&
        prestate.roleNames.length === 0 &&
        typeof prestate.inventoryDigest === "string" &&
        /^[a-f0-9]{64}$/.test(prestate.inventoryDigest),
    );
    let credentials;
    let output;
    let postAttempted = false;
    let cleanupEvidence;
    let createdRole;
    let createFailed = false;
    try {
      postAttempted = true;
      try {
        credentials = await create({ token, fetchImpl, clock });
      } catch {
        createFailed = true;
      }
      if (createFailed) throw fail();
      createdRole = credentials.cleanupRole;
      check(
        credentials.responseAccepted === true &&
          Date.parse(credentials.requestedAt) >= Date.parse(prestate.receivedAt) &&
          Date.parse(credentials.requestedAt) - Date.parse(prestate.receivedAt) <= 5000,
      );
      output = await operation(
        Object.freeze({
          requestedAt: credentials.requestedAt,
          receivedAt: credentials.receivedAt,
          response: credentials.response,
        }),
      );
    } finally {
      if (postAttempted && createdRole) {
        cleanupEvidence = await cleanupOwnedRole({
          token,
          role: createdRole,
          fetchImpl,
          clock,
        });
      } else if (postAttempted) {
        await readInventory({ token, fetchImpl, clock });
      }
    }
    check(cleanupEvidence);
    return {
      output,
      lifecycle: {
        ...(cleanupMode === EXCLUSIVE_STAGING_MAINTENANCE ? { cleanupMode } : {}),
        prestateRequestedAt: prestate.requestedAt,
        prestateReceivedAt: prestate.receivedAt,
        prestateInventoryDigest: prestate.inventoryDigest,
        loginRequestedAt: credentials.requestedAt,
        loginReceivedAt: credentials.receivedAt,
        cleanupRequestedAt: cleanupEvidence.cleanupRequestedAt,
        cleanupReceivedAt: cleanupEvidence.cleanupReceivedAt,
        verifiedAt: cleanupEvidence.verifiedAt,
        roleDigest: cleanupEvidence.roleDigest,
        poststateInventoryDigest: cleanupEvidence.poststateInventoryDigest,
        poststateRoleCount: cleanupEvidence.poststateRoleCount,
        exactRoleAbsent: cleanupEvidence.exactRoleAbsent,
      },
    };
  } catch {
    throw fail();
  }
}

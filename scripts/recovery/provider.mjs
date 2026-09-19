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
  return stdout.trim();
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

async function request(fetchImpl, token, path, options = {}) {
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
      jsonRequest(fetchImpl, token, `/v1/projects/${STAGING.ref}/config/database/pooler`),
    ]);
    return projectObservation(project, pooler, capturedAt);
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
          (row) =>
            plainObject(row) &&
            Object.keys(row).length === 1 &&
            /^cli_login_[A-Za-z0-9_]{1,80}$/.test(row.rolname),
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
  try {
    check(TOKEN.test(token));
    const requestedAt = exactTimestamp(clock());
    const response = await jsonRequest(
      fetchImpl,
      token,
      `/v1/projects/${STAGING.ref}/cli/login-role`,
      { method: "POST", body: JSON.stringify({ read_only: false }) },
    );
    const receivedAt = exactTimestamp(clock());
    check(
      Date.parse(receivedAt) >= Date.parse(requestedAt) &&
        Object.keys(response).sort().join(",") === "password,role,ttl_seconds" &&
        /^cli_login_[A-Za-z0-9_]{1,80}$/.test(response.role) &&
        typeof response.password === "string" &&
        response.password.length >= 16 &&
        response.password.length <= 1024 &&
        !/[\0\r\n]/.test(response.password) &&
        Number.isSafeInteger(response.ttl_seconds) &&
        response.ttl_seconds > 0,
    );
    return { requestedAt, receivedAt, response };
  } catch {
    throw fail();
  }
}

async function deleteAndVerifyStagingLoginRoles({
  token,
  role,
  fetchImpl = fetch,
  clock = () => new Date().toISOString(),
} = {}) {
  let deletionFailed = false;
  let deleteRequestedAt;
  let deleteReceivedAt;
  try {
    check(TOKEN.test(token) && /^cli_login_[A-Za-z0-9_]{1,80}$/.test(role));
    deleteRequestedAt = exactTimestamp(clock());
    const response = await jsonRequest(
      fetchImpl,
      token,
      `/v1/projects/${STAGING.ref}/cli/login-role`,
      { method: "DELETE" },
    );
    deleteReceivedAt = exactTimestamp(clock());
    check(
      Date.parse(deleteReceivedAt) >= Date.parse(deleteRequestedAt) &&
        Object.keys(response).length === 1 &&
        response.message === "ok",
    );
  } catch {
    deletionFailed = true;
  }
  let verified;
  try {
    verified = await readStagingCliRoleInventory({ token, fetchImpl, clock });
  } catch {
    throw fail();
  }
  check(!deletionFailed && verified.roleCount === 0);
  return {
    deleteRequestedAt,
    deleteReceivedAt,
    verifiedAt: verified.receivedAt,
    roleDigest: canonicalDigest(role),
    poststateInventoryDigest: verified.inventoryDigest,
  };
}

// The bulk-delete endpoint is admissible only because the immediately preceding
// authenticated inventory must be empty. Cleanup and a second inventory check
// run after every POST attempt, including exporter failure.
export async function withStagingLoginRole(
  { token, operation } = {},
  {
    fetchImpl = fetch,
    clock = () => new Date().toISOString(),
    readInventory = readStagingCliRoleInventory,
    create = createStagingLoginRole,
    cleanup = deleteAndVerifyStagingLoginRoles,
  } = {},
) {
  try {
    check(TOKEN.test(token) && typeof operation === "function");
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
    let posted = false;
    let cleanupEvidence;
    try {
      posted = true;
      credentials = await create({ token, fetchImpl, clock });
      check(
        Date.parse(credentials.requestedAt) >= Date.parse(prestate.receivedAt) &&
          Date.parse(credentials.requestedAt) - Date.parse(prestate.receivedAt) <= 5000,
      );
      output = await operation(credentials);
    } finally {
      if (posted) {
        cleanupEvidence = await cleanup({
          token,
          role: credentials?.response?.role ?? "cli_login_unknown",
          fetchImpl,
          clock,
        });
      }
    }
    check(cleanupEvidence);
    return {
      output,
      lifecycle: {
        prestateRequestedAt: prestate.requestedAt,
        prestateReceivedAt: prestate.receivedAt,
        prestateInventoryDigest: prestate.inventoryDigest,
        loginRequestedAt: credentials.requestedAt,
        loginReceivedAt: credentials.receivedAt,
        deleteRequestedAt: cleanupEvidence.deleteRequestedAt,
        deleteReceivedAt: cleanupEvidence.deleteReceivedAt,
        verifiedAt: cleanupEvidence.verifiedAt,
        roleDigest: cleanupEvidence.roleDigest,
        poststateInventoryDigest: cleanupEvidence.poststateInventoryDigest,
      },
    };
  } catch {
    throw fail();
  }
}
